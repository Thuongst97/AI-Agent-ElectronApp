/**
 * JiraService — fetches data from Jira Cloud REST API v3.
 *
 * Credentials come from AppSettings (jiraDomain, jiraEmail, jiraToken).
 * All methods return plain text / structured data suitable for passing
 * to the AI agent.
 */

import log from 'electron-log'
import type { AppSettings } from '../../shared/ipc-types'

// ── Jira REST API shapes (minimal) ───────────────────────────────────────────

export interface JiraUser {
  displayName: string
  emailAddress?: string
}

export interface JiraStatus {
  name: string
  statusCategory: { name: string }
}

export interface JiraPriority {
  name: string
}

export interface JiraIssueFields {
  summary:     string
  description: any          // Atlassian Document Format (ADF) or plain string
  status:      JiraStatus
  priority:    JiraPriority | null
  assignee:    JiraUser | null
  reporter:    JiraUser | null
  created:     string
  updated:     string
  issuetype:   { name: string }
  labels:      string[]
  comment?: {
    comments: JiraComment[]
    total:    number
  }
  [key: string]: any
}

export interface JiraIssue {
  id:     string
  key:    string
  fields: JiraIssueFields
}

export interface JiraComment {
  id:      string
  author:  JiraUser
  body:    any   // ADF or string
  created: string
  updated: string
}

export interface JiraSearchResult {
  issues:      JiraIssue[]
  total?:      number       // legacy /search
  totalCount?: number       // /search/jql (new endpoint)
  maxResults?: number
  startAt?:    number
}

// ── ADF → plain text ─────────────────────────────────────────────────────────

/**
 * Recursively extract plain text from Atlassian Document Format (ADF) nodes.
 * Falls back cleanly if the description is already a plain string or null.
 */
function adfToText(node: any, depth = 0): string {
  if (!node) return ''
  if (typeof node === 'string') return node

  const lines: string[] = []

  if (node.type === 'text') {
    return node.text ?? ''
  }

  if (node.type === 'hardBreak' || node.type === 'rule') {
    return '\n'
  }

  if (node.content && Array.isArray(node.content)) {
    const childText = node.content.map((c: any) => adfToText(c, depth + 1)).join('')

    switch (node.type) {
      case 'paragraph':
        lines.push(childText)
        lines.push('')
        break
      case 'heading':
        lines.push(`${'#'.repeat(node.attrs?.level ?? 1)} ${childText}`)
        lines.push('')
        break
      case 'bulletList':
      case 'orderedList':
        lines.push(childText)
        break
      case 'listItem':
        lines.push(`• ${childText.trim()}`)
        break
      case 'blockquote':
        lines.push(childText.split('\n').map((l: string) => `> ${l}`).join('\n'))
        break
      case 'codeBlock':
        lines.push('```')
        lines.push(childText)
        lines.push('```')
        break
      case 'inlineCard':
      case 'blockCard':
        lines.push(node.attrs?.url ?? '')
        break
      default:
        lines.push(childText)
    }
  }

  return lines.join('\n')
}

/** Normalise any description form to a readable string. */
function descriptionToText(desc: any): string {
  if (!desc) return '(no description)'
  if (typeof desc === 'string') return desc.trim() || '(no description)'
  return adfToText(desc).replace(/\n{3,}/g, '\n\n').trim() || '(no description)'
}

// ── Service ───────────────────────────────────────────────────────────────────

export class JiraService {
  private domain:  string
  private email:   string
  private token:   string
  private baseUrl: string

  constructor(settings: Pick<AppSettings, 'jiraDomain' | 'jiraEmail' | 'jiraToken'>) {
    this.domain  = settings.jiraDomain?.trim()  ?? ''
    this.email   = settings.jiraEmail?.trim()   ?? ''
    this.token   = settings.jiraToken?.trim()   ?? ''
    this.baseUrl = this.domain ? `https://${this.domain}/rest/api/3` : ''
  }

  /** Update credentials without rebuilding the registry. */
  reconfigure(settings: Pick<AppSettings, 'jiraDomain' | 'jiraEmail' | 'jiraToken'>): void {
    this.domain  = settings.jiraDomain?.trim()  ?? ''
    this.email   = settings.jiraEmail?.trim()   ?? ''
    this.token   = settings.jiraToken?.trim()   ?? ''
    this.baseUrl = this.domain ? `https://${this.domain}/rest/api/3` : ''
  }

  isConfigured(): boolean {
    return !!(this.domain && this.email && this.token)
  }

  // ── Low-level request ────────────────────────────────────────────────────

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error(
        'Jira is not configured. Please set jiraDomain, jiraEmail and jiraToken in Settings.',
      )
    }

    const auth = Buffer.from(`${this.email}:${this.token}`).toString('base64')
    const url  = new URL(`${this.baseUrl}${path}`)
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    }

    log.debug('[JiraService] GET %s', url.pathname)

    const res = await fetch(url.toString(), {
      method:  'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept:        'application/json',
      },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Jira API error ${res.status} ${res.statusText}: ${body}`)
    }

    return res.json() as Promise<T>
  }

  // ── Public methods ────────────────────────────────────────────────────────

  /**
   * Fetch a single issue by key (e.g. "SCRUM-42").
   * Returns the raw JiraIssue object.
   */
  async getIssue(issueKey: string): Promise<JiraIssue> {
    return this.request<JiraIssue>(`/issue/${issueKey}`, {
      fields: 'summary,description,status,priority,assignee,reporter,issuetype,labels,created,updated,comment',
    })
  }

  /**
   * Format a JiraIssue as a Markdown summary string for the agent.
   */
  formatIssue(issue: JiraIssue): string {
    const f = issue.fields
    const lines = [
      `## [${issue.key}] ${f.summary}`,
      '',
      `| Field    | Value |`,
      `|----------|-------|`,
      `| Type     | ${f.issuetype?.name ?? '—'} |`,
      `| Status   | ${f.status?.name ?? '—'} (${f.status?.statusCategory?.name ?? ''}) |`,
      `| Priority | ${f.priority?.name ?? '—'} |`,
      `| Assignee | ${f.assignee?.displayName ?? 'Unassigned'} |`,
      `| Reporter | ${f.reporter?.displayName ?? '—'} |`,
      `| Created  | ${f.created ? new Date(f.created).toLocaleDateString() : '—'} |`,
      `| Updated  | ${f.updated ? new Date(f.updated).toLocaleDateString() : '—'} |`,
      `| Labels   | ${f.labels?.length ? f.labels.join(', ') : '—'} |`,
      '',
      '### Description',
      '',
      descriptionToText(f.description),
    ]

    // Append most recent comments if present
    const comments = f.comment?.comments ?? []
    if (comments.length > 0) {
      lines.push('', '### Comments', '')
      const recent = comments.slice(-5)  // last 5
      for (const c of recent) {
        lines.push(`**${c.author?.displayName ?? 'Unknown'} (${new Date(c.created).toLocaleDateString()}):**`)
        lines.push(descriptionToText(c.body))
        lines.push('')
      }
    }

    return lines.join('\n')
  }

  /**
   * Search issues using JQL.
   * Returns a Markdown summary list.
   */
  async searchIssues(jql: string, maxResults = 10): Promise<JiraSearchResult> {
    return this.request<JiraSearchResult>('/search/jql', {
      jql,
      maxResults: String(maxResults),
      fields: 'summary,status,priority,assignee,issuetype,updated',
    })
  }

  formatSearchResult(result: JiraSearchResult): string {
    if (!result.issues?.length) return 'No issues found matching the query.'

    const total = result.total ?? result.totalCount ?? result.issues.length
    const lines = [
      `Found **${total}** issue(s) (showing ${result.issues.length}):`,
      '',
    ]

    for (const issue of result.issues) {
      const f = issue.fields
      lines.push(
        `- **[${issue.key}]** ${f.summary}  ` +
        `*(${f.status?.name}, ${f.priority?.name ?? 'no priority'}, ` +
        `assignee: ${f.assignee?.displayName ?? 'Unassigned'})*`,
      )
    }

    return lines.join('\n')
  }

  /**
   * Get all comments for an issue.
   */
  async getComments(issueKey: string): Promise<JiraComment[]> {
    const data = await this.request<{ comments: JiraComment[] }>(`/issue/${issueKey}/comment`)
    return data.comments ?? []
  }
}

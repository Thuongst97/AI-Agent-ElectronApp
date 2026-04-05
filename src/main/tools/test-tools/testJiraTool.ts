/**
 * Standalone test for JiraService + jiraTools.
 *
 * Run from repo root:
 *   npx tsx src/main/tools/test-tools/testJiraTool.ts
 *
 * Reads credentials from %APPDATA%\ai-agent-electron-app\settings.json
 * so you don't have to hard-code anything.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { JiraService } from '../../services/JiraService'

// ── Load credentials from the settings file written by the app ────────────────
function loadCredentials(): { jiraDomain: string; jiraEmail: string; jiraToken: string } {
  const settingsPath = join(
    process.env['APPDATA'] ?? process.env['HOME'] ?? '.',
    'ai-agent-electron-app',
    'settings.json',
  )

  if (!existsSync(settingsPath)) {
    console.error('❌  settings.json not found at:', settingsPath)
    console.error('    Start the app, open Settings and save your Jira credentials first.')
    process.exit(1)
  }

  const raw = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  const { jiraDomain = '', jiraEmail = '', jiraToken = '' } = raw

  if (!jiraDomain || !jiraEmail || !jiraToken) {
    console.error('❌  Jira credentials missing in settings.json')
    console.error('    jiraDomain:', jiraDomain  || '(empty)')
    console.error('    jiraEmail: ', jiraEmail   || '(empty)')
    console.error('    jiraToken: ', jiraToken   ? '(set)' : '(empty)')
    process.exit(1)
  }

  return { jiraDomain, jiraEmail, jiraToken }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const pass = (label: string): void => console.log(`  ✅  ${label}`)
const fail = (label: string, err: unknown): void => {
  console.error(`  ❌  ${label}`)
  console.error('      ', err instanceof Error ? err.message : String(err))
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function runTests(): Promise<void> {
  const creds = loadCredentials()
  const jira  = new JiraService(creds)

  console.log('\n══════════════════════════════════════════')
  console.log('  Jira Integration Test')
  console.log('  Domain:', creds.jiraDomain)
  console.log('  Email: ', creds.jiraEmail)
  console.log('══════════════════════════════════════════\n')

  // ── Test 1: isConfigured ──────────────────────────────────────────────────
  console.log('[ 1 ] isConfigured()')
  if (jira.isConfigured()) pass('credentials present')
  else { fail('credentials not detected', 'isConfigured() returned false'); process.exit(1) }

  // ── Test 2: search — assignee = currentUser() ─────────────────────────────
  console.log('\n[ 2 ] search_project_tickets  →  assignee = currentUser()')
  try {
    const result = await jira.searchIssues('assignee = currentUser()', 10)
    const total2 = result.total ?? result.totalCount ?? result.issues.length
    pass(`returned ${total2} total ticket(s), showing ${result.issues.length}`)
    if (result.issues.length > 0) {
      console.log('      First ticket:', result.issues[0].key, '—', result.issues[0].fields.summary)
    }
    const formatted = jira.formatSearchResult(result)
    console.log('\n--- Formatted output (search) ---')
    console.log(formatted)
    console.log('---------------------------------')
  } catch (err) {
    fail('search failed', err)
  }

  // ── Test 3: fetch a specific ticket (first one returned by search) ─────────
  console.log('\n[ 3 ] get_ticket_details  →  first ticket from search')
  try {
    const searchResult = await jira.searchIssues('assignee = currentUser() ORDER BY updated DESC', 1)
    if (searchResult.issues.length === 0) {
      console.log('      ⚠️  No tickets assigned to currentUser() — skipping get_ticket_details test')
    } else {
      const key = searchResult.issues[0].key
      console.log('      Fetching:', key)
      const issue = await jira.getIssue(key)
      pass(`fetched ${issue.key}: ${issue.fields.summary}`)
      const formatted = jira.formatIssue(issue)
      console.log('\n--- Formatted output (ticket) ---')
      console.log(formatted.slice(0, 1200), formatted.length > 1200 ? '\n...(truncated)' : '')
      console.log('---------------------------------')
    }
  } catch (err) {
    fail('get ticket failed', err)
  }

  // ── Test 4: search by project (auto-detect from first result) ─────────────
  console.log('\n[ 4 ] search_project_tickets  →  open tickets in same project')
  try {
    const r1 = await jira.searchIssues('assignee = currentUser() ORDER BY updated DESC', 1)
    if (r1.issues.length === 0) {
      console.log('      ⚠️  No tickets to derive project key from — skipping')
    } else {
      const projectKey = r1.issues[0].key.split('-')[0]
      const jql = `project = ${projectKey} AND status != Done ORDER BY updated DESC`
      console.log('      JQL:', jql)
      const result = await jira.searchIssues(jql, 5)
      const total4 = result.total ?? result.totalCount ?? result.issues.length
      pass(`project ${projectKey}: ${total4} open ticket(s)`)
      for (const issue of result.issues) {
        console.log(`      • ${issue.key}  [${issue.fields.status.name}]  ${issue.fields.summary}`)
      }
    }
  } catch (err) {
    fail('project search failed', err)
  }

  console.log('\n══════════════════════════════════════════')
  console.log('  All tests complete')
  console.log('══════════════════════════════════════════\n')
}

runTests().catch(err => {
  console.error('\n💥  Unhandled error:', err)
  process.exit(1)
})

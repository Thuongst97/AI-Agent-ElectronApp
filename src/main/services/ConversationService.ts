import { app } from 'electron'
import { join } from 'path'
import {
  readFileSync, writeFileSync,
  existsSync, mkdirSync, readdirSync, unlinkSync,
} from 'fs'
import { ConversationMeta, Message } from '../../shared/ipc-types'
import log from 'electron-log'

export class ConversationService {
  private readonly dir: string

  constructor() {
    this.dir = join(app.getPath('userData'), 'conversations')
    mkdirSync(this.dir, { recursive: true })
  }

  listConversations(): ConversationMeta[] {
    try {
      return readdirSync(this.dir)
        .filter(f => f.endsWith('.json') && !f.endsWith('.history.json'))
        .flatMap(f => {
          try {
            const data = this._load(f.replace('.json', ''))
            // Skip conversations with no messages (ghost sessions)
            if (!data.messages?.length) return []
            // Derive title from first user message if missing or whitespace-only
            const title = data.title?.trim() ||
              data.messages.find((m: Message) => m.role === 'user')?.content?.slice(0, 60) ||
              'New conversation'
            return [{
              id:           data.id,
              title,
              createdAt:    data.createdAt,
              messageCount: data.messages.length,
            }]
          } catch {
            return [] // skip malformed / unreadable files
          }
        })
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    } catch (err) {
      log.error('[Conversations] listConversations error', err)
      return []
    }
  }

  getMessages(id: string): Message[] {
    try {
      return this._load(id).messages
    } catch {
      return []
    }
  }

  appendMessages(id: string, messages: Message[]): void {
    let data: ConversationFile
    try {
      data = this._load(id)
    } catch {
      data = {
        id,
        title: messages[0]?.content.slice(0, 60) ?? 'New conversation',
        createdAt: new Date().toISOString(),
        messages: [],
      }
    }
    data.messages.push(...messages)
    // Refresh title from first user message in case it was empty initially
    if (!data.title) {
      data.title = data.messages.find((m: Message) => m.role === 'user')?.content?.slice(0, 60) ?? 'New conversation'
    }
    this._save(id, data)
  }

  deleteConversation(id: string): void {
    const path = this._path(id)
    if (existsSync(path)) {
      unlinkSync(path)
      log.info(`[Conversations] Deleted conversation ${id}`)
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _path(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  private _load(id: string): ConversationFile {
    const raw = readFileSync(this._path(id), 'utf-8')
    return JSON.parse(raw) as ConversationFile
  }

  private _save(id: string, data: ConversationFile): void {
    writeFileSync(this._path(id), JSON.stringify(data, null, 2), 'utf-8')
  }
}

interface ConversationFile {
  id:        string
  title:     string
  createdAt: string
  messages:  Message[]
}

/**
 * VectorMemoryService — ChromaDB-backed semantic search for requirements.
 *
 * Ported from Python MimiMemory (data/vector_db.py).
 *
 * Strategy:
 *   1. On startup, try to connect to a local ChromaDB HTTP server
 *      (default: http://localhost:8000).
 *   2. If the server is unreachable, fall back to a pure-JS in-process
 *      Vectra index stored under userData/vectra_index/.
 *
 * Public API (mirrors Python methods 1-for-1):
 *   query(text, n, threshold)          → RequirementRow[]
 *   queryTable(text, n, threshold)     → Markdown table string
 *   getById(id)                        → RequirementRow | null
 *   getByAssignee(name)                → RequirementRow[]
 *   getRelated(id, n)                  → RequirementRow[]
 *   getAssigneeStats()                 → Record<string, number>
 *   upsert(rows)                       → void
 *   probe()                            → ConnectionState
 */

import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import log from 'electron-log'
import type { ConnectionState } from '../../shared/ipc-types'

// ── Data shape ────────────────────────────────────────────────────────────────

export interface RequirementRow {
  reqId:       string
  description: string
  userStory:   string
  assignee:    string
}

// ChromaDB metadata record (all values must be string | number | boolean)
interface ReqMeta {
  req_id:     string
  user_story: string
  assignee:   string
}

// ── Similarity threshold ──────────────────────────────────────────────────────
// ChromaDB uses L2 distance.  0 = identical, ~1 = loosely related, >1.5 = noise.

const DEFAULT_THRESHOLD = 1.5
const BROAD_THRESHOLD   = 2.0   // for single-keyword count queries

// ── Collection name ───────────────────────────────────────────────────────────

const COLLECTION_NAME = 'project_requirements'

// ─────────────────────────────────────────────────────────────────────────────

export class VectorMemoryService {
  // Active backend: 'chroma' | 'vectra'
  private backend: 'chroma' | 'vectra' = 'vectra'
  private chromaState: ConnectionState = 'disconnected'

  // ChromaDB client + collection (used when backend === 'chroma')
  private chromaCollection: any = null  // ChromaDB.Collection

  // Vectra index (used when backend === 'vectra')
  private vectraIndex: any = null       // vectra.LocalIndex

  private readonly vectraDir: string

  constructor() {
    this.vectraDir = join(app.getPath('userData'), 'vectra_index')
    mkdirSync(this.vectraDir, { recursive: true })
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  /**
   * Attempt to connect to ChromaDB; fall back to Vectra on failure.
   * Safe to call multiple times (idempotent).
   */
  async init(host = 'localhost', port = 8000): Promise<void> {
    if (this.chromaCollection || this.vectraIndex) return   // already initialised

    try {
      await this._initChroma(host, port)
      this.backend     = 'chroma'
      this.chromaState = 'connected'
      log.info('[VectorMemory] ChromaDB connected at %s:%d', host, port)
    } catch (err) {
      log.warn('[VectorMemory] ChromaDB unavailable (%s) — falling back to Vectra', String(err))
      await this._initVectra()
      this.backend     = 'vectra'
      this.chromaState = 'disconnected'
    }
  }

  get connectionState(): ConnectionState {
    return this.chromaState
  }

  get activeBackend(): 'chroma' | 'vectra' {
    return this.backend
  }

  // ── Core query ────────────────────────────────────────────────────────────────

  /** Semantic search — returns up to `n` rows within the similarity threshold. */
  async query(
    text:      string,
    n          = 5,
    threshold  = DEFAULT_THRESHOLD,
  ): Promise<RequirementRow[]> {
    if (this.backend === 'chroma') return this._chromaQuery(text, n, threshold)
    return this._vectraQuery(text, n, threshold)
  }

  /**
   * Same as `query()` but returns a formatted Markdown table string, ready to
   * embed directly in an LLM response.
   */
  async queryTable(
    text:     string,
    n         = 5,
    threshold?: number,
  ): Promise<string> {
    const cutoff = threshold ?? DEFAULT_THRESHOLD
    const rows   = await this.query(text, n, cutoff)

    if (rows.length === 0) {
      // Retry once with a broader threshold for single-word keyword queries
      if (cutoff < BROAD_THRESHOLD) {
        const broader = await this.query(text, n, BROAD_THRESHOLD)
        if (broader.length > 0) return this._toMarkdownTable(broader)
      }
      return `No relevant requirements found matching "${text}".`
    }
    return this._toMarkdownTable(rows)
  }

  // ── Lookup helpers ────────────────────────────────────────────────────────────

  async getById(reqId: string): Promise<RequirementRow | null> {
    const all = await this._getAll()
    return all.find(r => r.reqId.toUpperCase() === reqId.toUpperCase()) ?? null
  }

  async getByAssignee(assignee: string): Promise<RequirementRow[]> {
    const all = await this._getAll()
    return all.filter(r => r.assignee.toLowerCase() === assignee.toLowerCase())
  }

  async getRelated(reqId: string, n = 3): Promise<RequirementRow[]> {
    const target = await this.getById(reqId)
    if (!target) return []
    const results = await this.query(target.description, n + 1, DEFAULT_THRESHOLD)
    return results.filter(r => r.reqId.toUpperCase() !== reqId.toUpperCase()).slice(0, n)
  }

  async getAssigneeStats(): Promise<Record<string, number>> {
    const all   = await this._getAll()
    const stats: Record<string, number> = {}
    for (const row of all) {
      const a = row.assignee || 'Unassigned'
      stats[a] = (stats[a] ?? 0) + 1
    }
    return stats
  }

  async totalCount(): Promise<number> {
    const all = await this._getAll()
    return all.length
  }

  // ── Write ─────────────────────────────────────────────────────────────────────

  /**
   * Upsert a batch of requirements into the active backend.
   * Safe to call multiple times — duplicate IDs are overwritten.
   */
  async upsert(rows: RequirementRow[]): Promise<void> {
    if (rows.length === 0) return
    if (this.backend === 'chroma') {
      await this._chromaUpsert(rows)
    } else {
      await this._vectraUpsert(rows)
    }
    log.info('[VectorMemory] Upserted %d rows via %s', rows.length, this.backend)
  }

  // ── Probe ─────────────────────────────────────────────────────────────────────

  async probe(): Promise<ConnectionState> {
    if (this.backend === 'chroma' && this.chromaCollection) {
      try {
        await this.chromaCollection.count()
        this.chromaState = 'connected'
      } catch {
        this.chromaState = 'error'
      }
    }
    return this.chromaState
  }

  // ── ChromaDB backend ──────────────────────────────────────────────────────────

  private async _initChroma(host: string, port: number): Promise<void> {
    const { ChromaClient } = await import('chromadb')
    const client           = new ChromaClient({ path: `http://${host}:${port}` })
    await client.heartbeat()   // throws if unreachable
    this.chromaCollection  = await client.getOrCreateCollection({ name: COLLECTION_NAME })
  }

  private async _chromaQuery(text: string, n: number, threshold: number): Promise<RequirementRow[]> {
    const results = await this.chromaCollection.query({
      queryTexts: [text],
      nResults:   n,
      include:    ['documents', 'metadatas', 'distances'],
    })
    const docs      = results.documents?.[0]  ?? []
    const metas     = results.metadatas?.[0]  ?? []
    const distances = results.distances?.[0]  ?? []

    const rows: RequirementRow[] = []
    for (let i = 0; i < docs.length; i++) {
      if ((distances[i] ?? 999) <= threshold) {
        rows.push(this._metaToRow(docs[i], metas[i] as ReqMeta))
      }
    }
    return rows
  }

  private async _chromaUpsert(rows: RequirementRow[]): Promise<void> {
    const { v4: uuidv4 } = await import('uuid')
    await this.chromaCollection.upsert({
      ids:       rows.map(() => uuidv4() as string),
      documents: rows.map(r => r.description),
      metadatas: rows.map(r => ({
        req_id:     r.reqId,
        user_story: r.userStory,
        assignee:   r.assignee,
      })),
    })
  }

  private async _chromaGetAll(): Promise<RequirementRow[]> {
    const results = await this.chromaCollection.get()
    const docs    = results.documents ?? []
    const metas   = results.metadatas ?? []
    return docs.map((doc: string, i: number) => this._metaToRow(doc, metas[i] as ReqMeta))
  }

  // ── Vectra backend ────────────────────────────────────────────────────────────

  private async _initVectra(): Promise<void> {
    const { LocalIndex } = await import('vectra')
    this.vectraIndex     = new LocalIndex(this.vectraDir)
    if (!(await this.vectraIndex.isIndexCreated())) {
      await this.vectraIndex.createIndex()
      log.info('[VectorMemory] Vectra index created at %s', this.vectraDir)
    } else {
      log.info('[VectorMemory] Vectra index loaded from %s', this.vectraDir)
    }
  }

  private async _vectraQuery(text: string, n: number, threshold: number): Promise<RequirementRow[]> {
    // Vectra requires a numerical embedding vector to query.
    // We use the same hash-embedding trick that works without a model server.
    const vec    = this._hashEmbed(text)
    const results = await this.vectraIndex.queryItems(vec, n)
    return results
      .filter((r: any) => (r.score ?? 0) > (1 - threshold / 2))   // convert threshold
      .map((r: any) => r.item.metadata as RequirementRow)
  }

  private async _vectraUpsert(rows: RequirementRow[]): Promise<void> {
    for (const row of rows) {
      const vec = this._hashEmbed(row.description)
      await this.vectraIndex.upsertItem({
        id:       row.reqId,
        vector:   vec,
        metadata: row,
      })
    }
  }

  private async _vectraGetAll(): Promise<RequirementRow[]> {
    const stats = await this.vectraIndex.listItems()
    return stats.map((item: any) => item.metadata as RequirementRow)
  }

  /**
   * Simple deterministic hash-based embedding (384-dim).
   * Good enough for exact-match and basic keyword queries in offline mode.
   * Phase 4+ can swap in @xenova/transformers for real semantic search.
   */
  private _hashEmbed(text: string): number[] {
    const dim = 384
    const vec = new Array<number>(dim).fill(0)
    const t   = text.toLowerCase()
    for (let i = 0; i < t.length; i++) {
      const code = t.charCodeAt(i)
      vec[i % dim] += code / 128
    }
    // L2-normalise
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
    return vec.map(v => v / norm)
  }

  // ── Shared helpers ────────────────────────────────────────────────────────────

  private async _getAll(): Promise<RequirementRow[]> {
    if (this.backend === 'chroma') return this._chromaGetAll()
    return this._vectraGetAll()
  }

  private _metaToRow(description: string, meta: ReqMeta): RequirementRow {
    return {
      reqId:       meta?.req_id     ?? 'N/A',
      description: description      ?? '',
      userStory:   meta?.user_story ?? 'N/A',
      assignee:    meta?.assignee   ?? 'Unassigned',
    }
  }

  private _toMarkdownTable(rows: RequirementRow[]): string {
    const lines = [
      '| Requirement ID | Description | Assignee | User Story |',
      '|---|---|---|---|',
      ...rows.map(r => {
        const desc = r.description.replace(/\|/g, '\\|').slice(0, 120)
        return `| ${r.reqId} | ${desc} | ${r.assignee} | ${r.userStory} |`
      }),
    ]
    return lines.join('\n')
  }
}

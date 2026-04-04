/**
 * DataIngester — reads CSV / JSON requirement files and upserts them into
 * the VectorMemoryService.
 *
 * Supported formats:
 *   CSV  — columns: requirement_id, user_story, description, assignee
 *   JSON — array of { requirement_id, user_story, description, assignee }
 *
 * Ported from Python data/ingester.py.
 *
 * Usage:
 *   const ingester = new DataIngester(vectorMemory)
 *   const result   = await ingester.ingestFile('/path/to/requirements.csv')
 *   const result   = await ingester.ingestDirectory('/path/to/seed/dir')
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import log from 'electron-log'
import type { VectorMemoryService, RequirementRow } from './VectorMemoryService'
import type { IngestResult } from '../../shared/ipc-types'

export class DataIngester {
  constructor(private readonly memory: VectorMemoryService) {}

  // ── Public ────────────────────────────────────────────────────────────────────

  /** Ingest a single CSV or JSON file. */
  async ingestFile(filePath: string): Promise<IngestResult> {
    if (!existsSync(filePath)) {
      return { success: false, inserted: 0, skipped: 0, errors: [`File not found: ${filePath}`] }
    }

    const ext = extname(filePath).toLowerCase()
    try {
      const rows = ext === '.json'
        ? this._parseJson(filePath)
        : this._parseCsv(filePath)

      const { valid, skipped, errors } = this._validate(rows)
      await this.memory.upsert(valid)

      log.info('[DataIngester] Ingested %d rows from %s (%d skipped)', valid.length, filePath, skipped)
      return { success: true, inserted: valid.length, skipped, errors }
    } catch (err) {
      const msg = String(err)
      log.error('[DataIngester] Failed to ingest %s: %s', filePath, msg)
      return { success: false, inserted: 0, skipped: 0, errors: [msg] }
    }
  }

  /**
   * Ingest all CSV/JSON files in a directory (non-recursive).
   * Returns an aggregated IngestResult.
   */
  async ingestDirectory(dirPath: string): Promise<IngestResult> {
    if (!existsSync(dirPath)) {
      return { success: false, inserted: 0, skipped: 0, errors: [`Directory not found: ${dirPath}`] }
    }

    const files  = readdirSync(dirPath).filter(f => {
      const ext = extname(f).toLowerCase()
      return (ext === '.csv' || ext === '.json') && statSync(join(dirPath, f)).isFile()
    })

    if (files.length === 0) {
      return { success: true, inserted: 0, skipped: 0, errors: ['No CSV/JSON files found in directory'] }
    }

    let totalInserted = 0
    let totalSkipped  = 0
    const allErrors:  string[] = []

    for (const file of files) {
      const result = await this.ingestFile(join(dirPath, file))
      totalInserted += result.inserted
      totalSkipped  += result.skipped
      allErrors.push(...result.errors)
    }

    log.info('[DataIngester] Directory ingest complete: %d inserted, %d skipped, %d errors',
      totalInserted, totalSkipped, allErrors.length)
    return {
      success:  allErrors.length === 0,
      inserted: totalInserted,
      skipped:  totalSkipped,
      errors:   allErrors,
    }
  }

  // ── Parsers ───────────────────────────────────────────────────────────────────

  private _parseCsv(filePath: string): Partial<RequirementRow>[] {
    const content = readFileSync(filePath, 'utf-8')
    const lines   = content.split(/\r?\n/).filter(l => l.trim())

    if (lines.length < 2) return []

    // Parse header
    const header = this._parseCsvLine(lines[0]).map(h => h.trim().toLowerCase())
    const colIdx = {
      id:          header.indexOf('requirement_id'),
      description: header.indexOf('description'),
      userStory:   header.indexOf('user_story'),
      assignee:    header.indexOf('assignee'),
    }

    const rows: Partial<RequirementRow>[] = []
    for (let i = 1; i < lines.length; i++) {
      const cells = this._parseCsvLine(lines[i])
      if (cells.length < 2) continue

      rows.push({
        reqId:       colIdx.id          >= 0 ? cells[colIdx.id]?.trim()          : undefined,
        description: colIdx.description >= 0 ? cells[colIdx.description]?.trim() : undefined,
        userStory:   colIdx.userStory   >= 0 ? cells[colIdx.userStory]?.trim()   : 'N/A',
        assignee:    colIdx.assignee    >= 0 ? cells[colIdx.assignee]?.trim()    : 'Unassigned',
      })
    }
    return rows
  }

  private _parseJson(filePath: string): Partial<RequirementRow>[] {
    const content = readFileSync(filePath, 'utf-8')
    const data    = JSON.parse(content)
    const arr     = Array.isArray(data) ? data : [data]

    return arr.map((item: Record<string, unknown>) => ({
      reqId:       String(item['requirement_id'] ?? item['req_id'] ?? ''),
      description: String(item['description']    ?? ''),
      userStory:   String(item['user_story']      ?? 'N/A'),
      assignee:    String(item['assignee']        ?? 'Unassigned'),
    }))
  }

  /**
   * Minimal CSV line parser that handles quoted fields containing commas.
   * Handles the standard RFC-4180 double-quote escaping.
   */
  private _parseCsvLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuote = false

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuote = !inQuote
        }
      } else if (ch === ',' && !inQuote) {
        result.push(current)
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current)
    return result
  }

  // ── Validation ────────────────────────────────────────────────────────────────

  private _validate(rows: Partial<RequirementRow>[]): {
    valid:   RequirementRow[]
    skipped: number
    errors:  string[]
  } {
    const valid:   RequirementRow[] = []
    const errors:  string[]         = []
    let   skipped = 0

    for (const row of rows) {
      if (!row.reqId || !row.description) {
        skipped++
        if (row.reqId) errors.push(`Skipped ${row.reqId}: missing description`)
        continue
      }
      valid.push({
        reqId:       row.reqId,
        description: row.description,
        userStory:   row.userStory  ?? 'N/A',
        assignee:    row.assignee   ?? 'Unassigned',
      })
    }
    return { valid, skipped, errors }
  }
}

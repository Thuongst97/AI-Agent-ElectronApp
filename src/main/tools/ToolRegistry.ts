/**
 * ToolRegistry — aggregates all tools for injection into CopilotAgentService.
 *
 * Usage:
 *   const registry = new ToolRegistry(vectorMemory)
 *   agentService.setToolRegistry(registry)
 *
 * Tools are GitHub Copilot SDK `Tool` objects created via `defineTool()`.
 * The registry's `getAll()` output is passed to `client.createSession({ tools })`.
 */

import type { Tool }              from '@github/copilot-sdk'
import type { VectorMemoryService } from '../data/VectorMemoryService'
import { makeRequirementTools }   from './requirementTools'
import log from 'electron-log'

export class ToolRegistry {
  private readonly tools: Tool[]

  constructor(memory: VectorMemoryService) {
    this.tools = makeRequirementTools(memory)
    for (const t of this.tools) {
      log.info('[ToolRegistry] Registered tool: %s', (t as any).name ?? t)
    }
  }

  /** Return all registered tools — pass directly to createSession({ tools }). */
  getAll(): Tool[] {
    return this.tools
  }
}

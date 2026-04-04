/**
 * ToolRegistry — aggregates all tools and implements IToolRegistry.
 *
 * Usage:
 *   const registry = new ToolRegistry(vectorMemory)
 *   agentService.setToolRegistry(registry)
 *
 * After setToolRegistry() is called, AgentService.chat() automatically
 * enters the tool-calling loop.
 */

import type { StructuredTool }     from '@langchain/core/tools'
import type { VectorMemoryService } from '../data/VectorMemoryService'
import type { IToolRegistry, RegisteredTool, ToolInput, ToolOutput } from '../agent/AgentService'

import {
  makeSearchRequirementsTool,
  makeGetByIdTool,
  makeGetByAssigneeTool,
  makeGetRelatedTool,
  makeAssigneeStatsTool,
} from './requirementTools'

import log from 'electron-log'

// ── Adapter: DynamicStructuredTool → RegisteredTool ───────────────────────────
// AgentService uses RegisteredTool (plain interface) for direct .run() calls
// during the tool-execution step; it also uses LangChain StructuredTools when
// binding the model via llm.bindTools().

class LangChainToolAdapter implements RegisteredTool {
  constructor(private readonly lc: StructuredTool) {}

  get name()        { return this.lc.name }
  get description() { return this.lc.description }

  async run(input: ToolInput): Promise<ToolOutput> {
    const result = await this.lc.invoke(input as Record<string, unknown>)
    return { content: typeof result === 'string' ? result : JSON.stringify(result) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export class ToolRegistry implements IToolRegistry {
  private readonly tools: Map<string, LangChainToolAdapter> = new Map()
  private readonly lcTools: StructuredTool[] = []

  constructor(memory: VectorMemoryService) {
    const lcToolInstances: StructuredTool[] = [
      makeSearchRequirementsTool(memory),
      makeGetByIdTool(memory),
      makeGetByAssigneeTool(memory),
      makeGetRelatedTool(memory),
      makeAssigneeStatsTool(memory),
    ]

    for (const lc of lcToolInstances) {
      const adapter = new LangChainToolAdapter(lc)
      this.tools.set(lc.name, adapter)
      this.lcTools.push(lc)
      log.info('[ToolRegistry] Registered tool: %s', lc.name)
    }
  }

  getAll(): RegisteredTool[] {
    return [...this.tools.values()]
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  toLangChainTools(): StructuredTool[] {
    return this.lcTools
  }
}

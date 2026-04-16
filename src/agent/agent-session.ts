/**
 * AgentSession — per-scenario agent configuration.
 *
 * Bundles the system prompt, available tools, and mock tool executor
 * for a given test scenario. Decouples scenario definition from
 * the transport layer (AgentClient).
 */

import { ToolDefinition, FRONTEND_TOOLS, selectTools } from './agent-tools'

// ============================================================================
// Mock Tool Executor
// ============================================================================

/** A function that executes a tool call and returns a JSON-serialisable result. */
export type MockExecutor = (toolName: string, args: Record<string, unknown>) => unknown

// ============================================================================
// AgentSession
// ============================================================================

export interface AgentSessionConfig {
  /** Human-readable identifier for logging. */
  id: string
  /** System prompt rendered at the start of each conversation. */
  systemPrompt: string
  /** Names of tools available to this agent. */
  toolNames: string[]
  /** Function to execute backend tool calls against mock data. */
  mockExecutor: MockExecutor
  /** Default model to use for this session (overridable per-request). */
  defaultModel?: string
}

export class AgentSession {
  readonly id: string
  readonly systemPrompt: string
  readonly tools: ToolDefinition[]
  readonly frontendTools: Set<string>
  readonly mockExecutor: MockExecutor
  readonly defaultModel: string | undefined

  constructor(config: AgentSessionConfig) {
    this.id = config.id
    this.systemPrompt = config.systemPrompt
    this.tools = selectTools(config.toolNames)
    this.mockExecutor = config.mockExecutor
    this.defaultModel = config.defaultModel
    // Frontend tools = intersection of session tools and global FRONTEND_TOOLS
    this.frontendTools = new Set(
      config.toolNames.filter((n) => FRONTEND_TOOLS.has(n))
    )
  }

  isFrontendTool(name: string): boolean {
    return this.frontendTools.has(name)
  }

  /** Execute a backend tool and return the result as a JSON string. */
  executeTool(name: string, args: Record<string, unknown>): string {
    const result = this.mockExecutor(name, args)
    return JSON.stringify(result)
  }
}

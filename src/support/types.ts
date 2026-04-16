/**
 * Shared TypeScript interfaces for fmw-llmmautojest.
 *
 * Intentionally provider-agnostic — no OpenAI/Anthropic/Gemini imports here.
 */

// ============================================================================
// Token Usage
// ============================================================================

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCall {
  id: string
  name: string
  /** JSON-encoded arguments string */
  arguments: string
}

export interface ToolResponse {
  tool_call_id: string
  response: string
}

// ============================================================================
// Agent Response
// ============================================================================

/**
 * Normalised result returned by AgentClient.send().
 * The `parseResult` field mirrors the original SSEParseResult shape for easy
 * reuse of eval/perf test logic ported from the CARTO project.
 */
export interface AgentResponse {
  responseId: string
  text: string
  toolCalls: ToolCall[]
  toolResponses: ToolResponse[]
  usage?: TokenUsage
  /** Backwards-compatible alias — equals the response itself. */
  parseResult: {
    text: string
    toolCalls: ToolCall[]
    toolResponses: ToolResponse[]
    done: boolean
    usage?: TokenUsage
    responseId?: string
  }
}

// ============================================================================
// FunctionCallOutput (frontend tool continuation)
// ============================================================================

/** Pre-built tool result supplied by the test for a "frontend" tool call. */
export interface FunctionCallOutput {
  type: 'function_call_output'
  call_id: string
  output: string
}

// ============================================================================
// Send Options
// ============================================================================

export interface SendOptions {
  /** Model identifier (overrides session default). */
  model?: string
  /** ID of a previous response to continue the conversation. */
  previousResponseId?: string
  /** Temperature (0.0–1.0). */
  temperature?: number
  /** Whether to retry on transient errors (default: true). */
  enableRetry?: boolean
  /** Restrict the LLM to these tool names only. */
  allowedTools?: string[]
  /** Pre-built outputs for frontend tool calls (continuation turn). */
  functionCallOutputs?: FunctionCallOutput[]
  /** Request timeout in milliseconds. */
  timeout?: number
}

// ============================================================================
// Evaluation
// ============================================================================

export enum EvaluationMode {
  AI_JUDGE = 'ai_judge',
  EXACT_MATCH = 'exact_match',
  CONTAINS = 'contains',
  STRUCTURAL = 'structural'
}

export interface AiJudgeResult {
  score: number
  explanation: string
  tokenUsage?: TokenUsage
  rawResponse?: string
}

export interface EvaluationResult {
  score: number
  explanation: string
  tokenUsage?: TokenUsage
  rawResponse?: string
  passed?: boolean
}

// ============================================================================
// CSV Export
// ============================================================================

export interface CSVExportRow {
  test_id: string
  transaction_id: string
  model?: string
  provider?: string
  question: string
  type: string
  expected_value: string
  received_value: string
  score: number
  score_explanation: string
  tokens: number
  latency_ms?: number
  scenario_id?: string
  turn_number?: number
  turn_type?: string
  tool_success_rate?: number
  run_label?: string
  ground_truth_value?: number
  extracted_value?: number
  pct_error?: number
  api_response?: string
  judge_response?: string
}

// ============================================================================
// Errors
// ============================================================================

export class AgentError extends Error {
  constructor(message: string, public statusCode?: number, public body?: unknown) {
    super(message)
    this.name = 'AgentError'
  }
}

export class EvaluationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvaluationError'
  }
}

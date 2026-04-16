/**
 * Evaluation Coordinator
 *
 * Routes evaluation requests to the appropriate backend:
 *   AI_JUDGE  — semantic, uses a second LLM (Gemini or Anthropic)
 *   EXACT_MATCH — string equality after trimming
 *   CONTAINS    — substring check (case-insensitive)
 *   STRUCTURAL  — boolean check
 */

import { AIJudgeFactory, COUNT_QUERY_JUDGE_CRITERIA } from './ai-judge'
import { EvaluationMode, EvaluationResult } from '@support/types'
import * as settings from '@settings'

export { COUNT_QUERY_JUDGE_CRITERIA }

// Lazy-initialised AI Judge (singleton per process)
let judgeInstance: ReturnType<typeof AIJudgeFactory.createFromEnv> | null = null

function getJudge() {
  if (!judgeInstance) {
    judgeInstance = AIJudgeFactory.createFromEnv()
  }
  return judgeInstance
}

// ============================================================================
// Mode Implementations
// ============================================================================

function evaluateExactMatch(received: string, expected: string): EvaluationResult {
  const match = received.trim() === expected.trim()
  return { score: match ? 10 : 0, explanation: match ? 'Exact match' : 'No exact match' }
}

function evaluateContains(received: string, expected: string): EvaluationResult {
  const contains = received.toLowerCase().includes(expected.toLowerCase())
  return { score: contains ? 10 : 0, explanation: contains ? 'Expected text found' : 'Expected text not found' }
}

function evaluateStructural(received: string, expected: string): EvaluationResult {
  const got = received.toLowerCase() === 'true' || received === '1'
  const want = expected.toLowerCase() === 'true' || expected === '1'
  const match = got === want
  return {
    score: match ? 10 : 0,
    explanation: match ? `Structural check passed: ${received}` : `Expected ${expected}, got ${received}`
  }
}

// ============================================================================
// Config
// ============================================================================

export interface EvaluationConfig {
  mode: EvaluationMode
  /**
   * Optional criteria injected into the AI Judge rubric.
   * Use COUNT_QUERY_JUDGE_CRITERIA for count/grounding queries.
   */
  criteria?: string
}

// ============================================================================
// Public API
// ============================================================================

export async function evaluateResponse(
  received: string,
  expected: string,
  question: string,
  config: EvaluationConfig,
  context?: string
): Promise<EvaluationResult> {
  try {
    switch (config.mode) {
      case EvaluationMode.AI_JUDGE: {
        const judge = getJudge()
        const result = await judge(received, expected, question, context, config.criteria)
        return { score: result.score, explanation: result.explanation, tokenUsage: result.tokenUsage, rawResponse: result.rawResponse }
      }
      case EvaluationMode.EXACT_MATCH:
        return evaluateExactMatch(received, expected)
      case EvaluationMode.CONTAINS:
        return evaluateContains(received, expected)
      case EvaluationMode.STRUCTURAL:
        return evaluateStructural(received, expected)
      default:
        throw new Error(`Unknown EvaluationMode: ${config.mode as string}`)
    }
  } catch (err) {
    return { score: 0, explanation: `Evaluation error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function evaluateAndCheckPass(
  received: string,
  expected: string,
  question: string,
  config: EvaluationConfig,
  passThreshold = settings.aiSemanticPassThreshold,
  context?: string
): Promise<EvaluationResult & { passed: boolean }> {
  const result = await evaluateResponse(received, expected, question, config, context)
  return { ...result, passed: result.score >= passThreshold }
}

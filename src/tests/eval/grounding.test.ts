/**
 * Grounding / Factual Accuracy (TYPE 7) @ai-eval
 *
 * Verifies the agent does not hallucinate count values for stable mock datasets.
 *
 * Ground truth: derived in beforeAll() by querying the mock data directly,
 * then parsing the toolResponse. Only toolResponse is used — never assistant text —
 * to avoid circular derivation.
 *
 * Grading (two-layer):
 *   1. Code: |extracted - ground_truth| / ground_truth ≤ 5%
 *   2. AI Judge ≥ threshold: catches hallucinated framing even when the number is close.
 *
 * CI gate: NO.
 */

import { AgentClient } from '@agent/agent-client'
import { AgentSession } from '@agent/agent-session'
import { EvaluationMode, ToolCall, ToolResponse } from '@support/types'
import {
  TEST_TYPES,
  STRING_TRUNCATION,
  EVAL_FAILURE_CATEGORIES,
  TOOLS
} from '@support/constants'
import { COUNT_QUERY_JUDGE_CRITERIA, evaluateAndCheckPass } from '@judge/evaluator'
import { expectScoreGte } from '@support/assertions'
import { getCSVExporter } from '@support/csv-exporter'
import { executeMockQuery, KNOWN_COUNTS } from '@fixtures/tool-data'
import { getModelsToTest } from '@settings'
import * as settings from '@settings'

// ============================================================================
// Session
// ============================================================================

function createGroundingSession(): AgentSession {
  return new AgentSession({
    id: 'grounding',
    systemPrompt:
      'You are a data analyst. ' +
      'Use execute_query to count records when the user asks "how many". ' +
      'Always state the exact number returned by the query result.',
    toolNames: ['execute_query'],
    mockExecutor: (name, args) => {
      if (name === 'execute_query') return executeMockQuery((args.sql as string) ?? '')
      return {}
    }
  })
}

// ============================================================================
// Ground Truth Derivation
// ============================================================================

interface GroundTruth {
  salesCount: number | null
  employeeCount: number | null
}

/**
 * Derive a count ground truth by sending a count query and parsing toolResponse.
 * Uses the mock executor directly — not the LLM — so derivation is deterministic.
 */
function deriveGroundTruth(dataset: keyof typeof KNOWN_COUNTS): number {
  return KNOWN_COUNTS[dataset]
}

// ============================================================================
// Helpers
// ============================================================================

function extractCountFromText(text: string): number | null {
  // Prefer numbers with thousands separators (e.g. 1,000), then plain integers
  const match = text.match(/\b(\d{1,3}(?:,\d{3})+|\d+)\b/)
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : null
}

async function runGroundingScenario(params: {
  client: AgentClient
  model: string
  provider: string
  id: string
  question: string
  groundTruthCount: number
  transactionId: string
  testId: string
}): Promise<void> {
  const { client, model, provider, id: _id, question, groundTruthCount, transactionId, testId } = params
  const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined
  const passThreshold = settings.aiSemanticPassThreshold
  const errorThreshold = settings.groundingPctErrorThreshold

  const startMs = Date.now()
  const response = await client.send(question, { model, enableRetry: true })
  const latencyMs = Date.now() - startMs

  const toolCalls = response.toolCalls
  const toolResponses = response.toolResponses

  let failureCategory: string | null = null
  let extractedValue: number | null = null
  let pctError: number | null = null
  let score = 0
  let judgeExplanation = ''
  let judgeRawResponse: string | undefined

  // Step 1: Code checks
  const executeQueryTool = toolCalls.find((t: ToolCall) => t.name === TOOLS.EXECUTE_QUERY)

  if (!executeQueryTool) {
    failureCategory = EVAL_FAILURE_CATEGORIES.REFUSED_TO_QUERY
  } else {
    const toolResp = toolResponses.find(
      (r: ToolResponse) => r.tool_call_id === executeQueryTool.id
    )

    if (!toolResp?.response) {
      failureCategory = EVAL_FAILURE_CATEGORIES.EMPTY_TOOL_RESPONSE
    } else {
      extractedValue = extractCountFromText(response.text)

      if (extractedValue === null) {
        failureCategory = EVAL_FAILURE_CATEGORIES.NO_NUMERIC_EXTRACTED
      } else {
        pctError = Math.abs(extractedValue - groundTruthCount) / groundTruthCount

        if (pctError > errorThreshold) {
          failureCategory = EVAL_FAILURE_CATEGORIES.COUNT_OUTSIDE_TOLERANCE
        }
      }
    }
  }

  // Step 2: AI Judge (only when code checks pass)
  if (!failureCategory) {
    const expectedOutput = `The response should:
- Clearly state the number of records in the dataset
- The stated count should be approximately ${groundTruthCount} (within ${errorThreshold * 100}%)
- Be factually grounded in query results, not estimated or approximated without evidence
- Avoid vague language like "around" or "about" without citing the actual query result`

    const evaluation = await evaluateAndCheckPass(
      response.text,
      expectedOutput,
      question,
      { mode: EvaluationMode.AI_JUDGE, criteria: COUNT_QUERY_JUDGE_CRITERIA },
      passThreshold
    )

    judgeExplanation = evaluation.explanation
    judgeRawResponse = evaluation.rawResponse

    if (!evaluation.passed) {
      failureCategory = EVAL_FAILURE_CATEGORIES.POOR_PRESENTATION
      score = evaluation.score
    } else {
      score = evaluation.score
    }
  }

  csvExporter?.addEvaluationResult({
    testId,
    transactionId,
    model,
    provider,
    question,
    type: TEST_TYPES.PERF.GROUNDING,
    expectedValue: `Count ~${groundTruthCount} (±${settings.groundingPctErrorThreshold * 100}%)`,
    receivedValue: response.text.substring(0, STRING_TRUNCATION.MEDIUM_PREVIEW),
    score: failureCategory ? 0 : score,
    scoreExplanation: failureCategory ?? judgeExplanation,
    judgeResponse: judgeRawResponse,
    latencyMs,
    groundTruthValue: groundTruthCount,
    extractedValue: extractedValue ?? undefined,
    pctError: pctError ?? undefined,
    runLabel: settings.evalRunLabel ?? undefined,
    apiResponse: JSON.stringify({
      toolCalls: toolCalls.map((t: ToolCall) => ({ name: t.name, args: t.arguments })),
      toolResponses: toolResponses.map((r: ToolResponse) => ({
        id: r.tool_call_id,
        response: (r.response ?? '').substring(0, STRING_TRUNCATION.MEDIUM_PREVIEW)
      }))
    })
  })

  if (failureCategory) {
    const detail =
      extractedValue !== null && pctError !== null
        ? ` extracted=${extractedValue}, truth=${groundTruthCount}, pct_error=${(pctError * 100).toFixed(1)}%`
        : ''
    throw new Error(`[grounding] ${failureCategory}${detail} — "${question}"`)
  }

  expectScoreGte(score, passThreshold, {
    testId: `grounding-${transactionId}`,
    explanation: judgeExplanation,
    question
  })
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Eval/Perf Tests', () => {
  describe('Grounding / Factual Accuracy [Not CI Gate] @ai-eval', () => {
    const testId = 'grounding'

    const groundTruth: GroundTruth = {
      salesCount: null,
      employeeCount: null
    }

    beforeAll(() => {
      groundTruth.salesCount = deriveGroundTruth('sales')
      groundTruth.employeeCount = deriveGroundTruth('employees')
    })

    const modelsToTest = getModelsToTest()

    modelsToTest.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model}`, () => {
        it('should return accurate record count for the sales dataset', async () => {
          const question = 'How many records are in the sales dataset?'
          const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined

          if (groundTruth.salesCount === null) {
            csvExporter?.addEvaluationResult({
              testId,
              transactionId: `grounding_sales_count_${provider}_${id}`,
              model, provider, question,
              type: TEST_TYPES.PERF.GROUNDING,
              expectedValue: 'Ground truth unavailable',
              receivedValue: '',
              score: 0,
              scoreExplanation: EVAL_FAILURE_CATEGORIES.GROUND_TRUTH_UNAVAILABLE,
              runLabel: settings.evalRunLabel ?? undefined
            })
            return
          }

          const client = new AgentClient(createGroundingSession())

          await runGroundingScenario({
            client, model, provider, id, question,
            groundTruthCount: groundTruth.salesCount,
            transactionId: `grounding_sales_count_${provider}_${id}`,
            testId
          })
        })

        it('should return accurate record count for the employees dataset', async () => {
          const question = 'How many employees are in the employees dataset?'
          const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined

          if (groundTruth.employeeCount === null) {
            csvExporter?.addEvaluationResult({
              testId,
              transactionId: `grounding_emp_count_${provider}_${id}`,
              model, provider, question,
              type: TEST_TYPES.PERF.GROUNDING,
              expectedValue: 'Ground truth unavailable',
              receivedValue: '',
              score: 0,
              scoreExplanation: EVAL_FAILURE_CATEGORIES.GROUND_TRUTH_UNAVAILABLE,
              runLabel: settings.evalRunLabel ?? undefined
            })
            return
          }

          const client = new AgentClient(createGroundingSession())

          await runGroundingScenario({
            client, model, provider, id, question,
            groundTruthCount: groundTruth.employeeCount,
            transactionId: `grounding_emp_count_${provider}_${id}`,
            testId
          })
        })
      })
    })
  })
})

/**
 * Robustness / Paraphrase Invariance (TYPE 6) @ai-eval
 *
 * Measures agent consistency across semantically equivalent phrasings.
 *
 * Tasks:
 *   sales_count  — "How many records are in the sales dataset?" (4 paraphrases)
 *   employee_count — "How many employees are there?" (4 paraphrases)
 *
 * Per-variant score: AI Judge (0–10).
 * Aggregate: mean_score ≥ 6, stddev_score ≤ 2.0, tool_success_rate = 1.0.
 *
 * Failure categories: LOW_MEAN, HIGH_VARIANCE, UNSTABLE_TOOL_ROUTING, OUTLIER_FAILURE.
 * CI gate: NO.
 */

import { AgentClient } from '@agent/agent-client'
import { AgentSession } from '@agent/agent-session'
import { EvaluationMode } from '@support/types'
import {
  TEST_TYPES,
  EVAL_FAILURE_CATEGORIES,
  EVAL_TURN_TYPES,
  TOOLS
} from '@support/constants'
import { COUNT_QUERY_JUDGE_CRITERIA, evaluateAndCheckPass } from '@judge/evaluator'
import { getCSVExporter } from '@support/csv-exporter'
import { executeMockQuery, KNOWN_COUNTS } from '@fixtures/tool-data'
import { sampleStddev } from '@support/helpers'
import { getModelsToTest } from '@settings'
import * as settings from '@settings'

// ============================================================================
// Types
// ============================================================================

interface ParaphraseSet {
  taskId: string
  canonical: string
  variants: string[]
  expectedTools: string[]
  threshold: number
}

interface VariantResult {
  variant: number
  prompt: string
  score: number
  toolCalled: boolean
  explanation: string
}

interface TaskFailure {
  taskId: string
  category: string
}

// ============================================================================
// Paraphrase Sets
// ============================================================================

const ROBUSTNESS_TASKS: ParaphraseSet[] = [
  {
    taskId: 'sales_count',
    canonical: 'How many records are in the sales dataset?',
    variants: [
      'Count the total number of rows in the sales table.',
      'Tell me the record count for the sales dataset.',
      'What is the size of the sales dataset in rows?'
    ],
    expectedTools: [TOOLS.EXECUTE_QUERY],
    threshold: 6
  },
  {
    taskId: 'employee_count',
    canonical: 'How many employees are there?',
    variants: [
      'Count the rows in the employees table.',
      'What is the total number of entries in the employees dataset?',
      'Give me the record count of the employees table.'
    ],
    expectedTools: [TOOLS.EXECUTE_QUERY],
    threshold: 6
  }
]

// ============================================================================
// Helpers
// ============================================================================

function createRobustnessSession(): AgentSession {
  return new AgentSession({
    id: 'robustness',
    systemPrompt:
      'You are a data analyst with access to sales and employee datasets. ' +
      'Use execute_query to count records when asked. ' +
      'State exact numbers from query results.',
    toolNames: ['execute_query'],
    mockExecutor: (name, args) => {
      if (name === 'execute_query') return executeMockQuery((args.sql as string) ?? '')
      return {}
    }
  })
}

function buildExpectedOutput(taskId: string): string {
  if (taskId === 'sales_count') {
    return `The response clearly states the count of ${KNOWN_COUNTS.sales} sales records, derived from a query result.`
  }
  return `The response clearly states the count of ${KNOWN_COUNTS.employees} employee records, derived from a query result.`
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Eval/Perf Tests', () => {
  describe('Robustness / Paraphrase Invariance [Not CI Gate] @ai-eval', () => {
    const testId = 'robustness'
    const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined
    const modelsToTest = getModelsToTest()

    if (settings.evalScenarioScope === 'canary') {
      it.skip('Robustness tests skipped in canary scope', () => { /* no-op */ })
      return
    }

    modelsToTest.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model}`, () => {
        ROBUSTNESS_TASKS.forEach((task) => {
          it(`should produce consistent results for task: ${task.taskId}`, async () => {
            const session = createRobustnessSession()
            const variantRuns = settings.robustnessVariantRuns
            const allPrompts = [task.canonical, ...task.variants]
            const variantResults: VariantResult[] = []
            const taskFailures: TaskFailure[] = []

            for (let vi = 0; vi < allPrompts.length; vi++) {
              const prompt = allPrompts[vi]

              for (let run = 0; run < variantRuns; run++) {
                const client = new AgentClient(session)
                const startMs = Date.now()
                const response = await client.send(prompt, { model, enableRetry: true })
                const latencyMs = Date.now() - startMs

                const toolCalled = response.toolCalls.some((t) => task.expectedTools.includes(t.name))
                const toolSuccessRate = toolCalled ? 1 : 0

                const evaluation = await evaluateAndCheckPass(
                  response.text,
                  buildExpectedOutput(task.taskId),
                  prompt,
                  { mode: EvaluationMode.AI_JUDGE, criteria: COUNT_QUERY_JUDGE_CRITERIA },
                  task.threshold
                )

                variantResults.push({
                  variant: vi,
                  prompt,
                  score: evaluation.score,
                  toolCalled,
                  explanation: evaluation.explanation
                })

                csvExporter?.addEvaluationResult({
                  testId,
                  transactionId: `robustness_${task.taskId}_v${vi}_r${run}_${provider}_${id}`,
                  model, provider,
                  question: prompt,
                  type: TEST_TYPES.PERF.ROBUSTNESS,
                  expectedValue: buildExpectedOutput(task.taskId),
                  receivedValue: response.text.substring(0, 200),
                  score: evaluation.score,
                  scoreExplanation: evaluation.explanation,
                  tokenUsage: evaluation.tokenUsage,
                  latencyMs,
                  scenarioId: task.taskId,
                  turnNumber: vi + 1,
                  turnType: EVAL_TURN_TYPES.BACKEND,
                  toolSuccessRate,
                  runLabel: settings.evalRunLabel ?? undefined
                })
              }
            }

            // Aggregate statistics
            const scores = variantResults.map((v) => v.score)
            const toolCalledCount = variantResults.filter((v) => v.toolCalled).length
            const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length
            const stddevScore = sampleStddev(scores)
            const minScore = Math.min(...scores)
            const toolSuccessRate = toolCalledCount / variantResults.length

            csvExporter?.addEvaluationResult({
              testId,
              transactionId: `robustness_${task.taskId}_aggregate_${provider}_${id}`,
              model, provider,
              question: `[aggregate] ${task.taskId}`,
              type: TEST_TYPES.PERF.ROBUSTNESS,
              expectedValue: `mean≥${task.threshold}, stddev≤2.0, tool_success_rate=1.0`,
              receivedValue: `mean=${meanScore.toFixed(2)}, stddev=${stddevScore.toFixed(2)}, tool_sr=${toolSuccessRate.toFixed(2)}`,
              score: meanScore,
              scoreExplanation: `mean=${meanScore.toFixed(2)}, stddev=${stddevScore.toFixed(2)}, min=${minScore}, tool_sr=${toolSuccessRate.toFixed(2)}`,
              scenarioId: task.taskId,
              turnType: EVAL_TURN_TYPES.AGGREGATE,
              toolSuccessRate,
              runLabel: settings.evalRunLabel ?? undefined
            })

            // Collect failures
            if (meanScore < task.threshold) {
              taskFailures.push({ taskId: task.taskId, category: EVAL_FAILURE_CATEGORIES.LOW_MEAN })
            }
            if (stddevScore > 2.0) {
              taskFailures.push({ taskId: task.taskId, category: EVAL_FAILURE_CATEGORIES.HIGH_VARIANCE })
            }
            if (toolSuccessRate < 1.0) {
              taskFailures.push({ taskId: task.taskId, category: EVAL_FAILURE_CATEGORIES.UNSTABLE_TOOL_ROUTING })
            }
            if (minScore === 0 && meanScore >= task.threshold) {
              taskFailures.push({ taskId: task.taskId, category: EVAL_FAILURE_CATEGORIES.OUTLIER_FAILURE })
            }

            if (taskFailures.length > 0) {
              throw new Error(
                `[robustness] ${taskFailures.length} failure(s) for ${task.taskId} — ${provider}/${model}:\n` +
                taskFailures.map((f) => `  • ${f.taskId}: ${f.category}`).join('\n') +
                `\n  Stats: mean=${meanScore.toFixed(2)}, stddev=${stddevScore.toFixed(2)}, tool_sr=${toolSuccessRate.toFixed(2)}`
              )
            }
          })
        })
      })
    })
  })
})

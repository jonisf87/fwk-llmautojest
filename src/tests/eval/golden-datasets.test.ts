/**
 * Golden Dataset Task Fidelity (TYPE 5) @ai-eval
 *
 * End-to-end benchmark using curated domain scenarios (src/fixtures/scenarios.ts).
 *
 * Tier A — sales-analyzer (ephemeral session, all providers):
 *   Backend tools only. Canary scope runs Turn 1 only.
 *
 * Tier B — knowledge-search, data-explorer (frontend tools):
 *   Frontend tool mocks injected via functionCallOutputs after the hard tool check.
 *   Provider group controlled by TIER_B_PROVIDER_GROUPS (default: OPENAI).
 *   Skipped when EVAL_SCENARIO_SCOPE=canary.
 *
 * Grading per turn (two layers):
 *   1. Hard (code): expected tools present → score=0 + REQUIRED_TOOL_NOT_CALLED if absent.
 *   2. Soft (AI Judge ≥ threshold): applied to backend or continuation response.
 *   criticalPath=true on a turn skips all subsequent turns on hard-check failure.
 *
 * Failure handling: collect-then-fail — all failures surface in a single throw per scenario.
 * CI gate: NO.
 */

import { AgentClient } from '@agent/agent-client'
import { FunctionCallOutput } from '@support/types'
import { EvaluationMode, ToolCall } from '@support/types'
import {
  TEST_TYPES,
  STRING_TRUNCATION,
  TEST_SCORES,
  EVAL_FAILURE_CATEGORIES,
  EVAL_TURN_TYPES
} from '@support/constants'
import { evaluateAndCheckPass } from '@judge/evaluator'
import { getCSVExporter, CSVExporter } from '@support/csv-exporter'
import { buildFunctionCallOutputs } from '@fixtures/tool-mocks'
import {
  SALES_ANALYZER_SCENARIO,
  buildKnowledgeSearchScenario,
  buildDataExplorerScenario,
  Scenario,
  ScenarioTurn,
  createSalesAnalyzerSession,
  createKnowledgeSearchSession,
  createDataExplorerSession
} from '@fixtures/scenarios'
import { getModelsToTest, getTierBModels } from '@settings'
import * as settings from '@settings'

// ============================================================================
// Internal Types
// ============================================================================

interface FailureRecord {
  transactionId: string
  category: string
}

// ============================================================================
// Tool Success Rate
// ============================================================================

function computeToolSuccessRate(toolCalls: ToolCall[], expectedTools: string[]): number {
  if (expectedTools.length === 0) return 1.0
  const matched = expectedTools.filter((exp) => toolCalls.some((t) => t.name === exp))
  return matched.length / expectedTools.length
}

// ============================================================================
// Turn Runners
// ============================================================================

async function runBackendTurn(
  csvExporter: CSVExporter | undefined,
  testId: string,
  model: string,
  provider: string,
  turn: ScenarioTurn,
  scenarioId: string,
  transactionId: string,
  toolCalls: ToolCall[],
  toolSuccessRate: number,
  unexpectedNote: string,
  responseText: string,
  latencyMs: number
): Promise<FailureRecord[]> {
  const failures: FailureRecord[] = []

  const evaluation = await evaluateAndCheckPass(
    responseText,
    buildJudgeCriteria(turn),
    turn.user,
    { mode: EvaluationMode.AI_JUDGE },
    settings.aiSemanticPassThreshold
  )

  if (!evaluation.passed) {
    failures.push({ transactionId, category: EVAL_FAILURE_CATEGORIES.POOR_QUALITY })
  }

  csvExporter?.addEvaluationResult({
    testId, transactionId, model, provider,
    question: turn.user,
    type: TEST_TYPES.PERF.GOLDEN_DATASETS,
    expectedValue: turn.expected.output,
    receivedValue: responseText.substring(0, STRING_TRUNCATION.MEDIUM_PREVIEW),
    score: evaluation.score,
    scoreExplanation: evaluation.explanation + unexpectedNote,
    judgeResponse: evaluation.rawResponse,
    tokenUsage: evaluation.tokenUsage,
    latencyMs, scenarioId,
    turnNumber: turn.turn,
    turnType: EVAL_TURN_TYPES.BACKEND,
    toolSuccessRate,
    runLabel: settings.evalRunLabel ?? undefined,
    apiResponse: JSON.stringify({ toolCalls: toolCalls.map((t) => ({ name: t.name, args: t.arguments.substring(0, 100) })) })
  })

  return failures
}

interface ToolTurnResult {
  failures: FailureRecord[]
  newResponseId: string
  skipRemaining: boolean
}

async function runToolTurn(
  client: AgentClient,
  model: string,
  csvExporter: CSVExporter | undefined,
  testId: string,
  provider: string,
  turn: ScenarioTurn,
  scenarioId: string,
  transactionId: string,
  toolCalls: ToolCall[],
  toolSuccessRate: number,
  unexpectedNote: string,
  previousResponseId: string,
  latencyMs: number
): Promise<ToolTurnResult> {
  const failures: FailureRecord[] = []

  const { outputs, unmatched } = buildFunctionCallOutputs(toolCalls, turn.frontendToolMocks!)

  for (const unmatchedTool of unmatched) {
    failures.push({ transactionId: `${transactionId}_mock_${unmatchedTool}`, category: EVAL_FAILURE_CATEGORIES.MOCK_NOT_MATCHED })
  }

  const unmatchedNote = unmatched.length > 0 ? ` | unmatched_mocks: ${unmatched.join(', ')}` : ''
  const toolTurnExplanation = `tool_success_rate=${toolSuccessRate.toFixed(2)}${unmatchedNote}${unexpectedNote}`

  csvExporter?.addEvaluationResult({
    testId, transactionId: `${transactionId}_tool`, model, provider,
    question: turn.user,
    type: TEST_TYPES.PERF.GOLDEN_DATASETS,
    expectedValue: `Tools required: ${turn.expected.tools_called.join(', ')}`,
    receivedValue: toolCalls.map((t) => t.name).join(', '),
    score: toolSuccessRate * 10,
    scoreExplanation: toolTurnExplanation,
    latencyMs, scenarioId,
    turnNumber: turn.turn,
    turnType: EVAL_TURN_TYPES.TOOL,
    toolSuccessRate,
    runLabel: settings.evalRunLabel ?? undefined
  })

  if (outputs.length === 0) {
    const category = EVAL_FAILURE_CATEGORIES.FRONTEND_ACK_FAILED
    failures.push({ transactionId, category })
    csvExporter?.addEvaluationResult({
      testId, transactionId: `${transactionId}_continuation`, model, provider,
      question: `[continuation] ${turn.user}`,
      type: TEST_TYPES.PERF.GOLDEN_DATASETS,
      expectedValue: turn.expected.output,
      receivedValue: 'no outputs to send',
      score: TEST_SCORES.FAIL,
      scoreExplanation: `${category}: all frontend tool mocks unmatched`,
      scenarioId, turnNumber: turn.turn,
      turnType: EVAL_TURN_TYPES.CONTINUATION,
      toolSuccessRate,
      runLabel: settings.evalRunLabel ?? undefined
    })
    return { failures, newResponseId: previousResponseId, skipRemaining: turn.criticalPath ?? false }
  }

  const continuationStart = Date.now()
  const continuation = await client.send('', {
    model, enableRetry: true,
    previousResponseId,
    functionCallOutputs: outputs as FunctionCallOutput[]
  })
  const continuationLatencyMs = Date.now() - continuationStart

  if (!continuation.text) {
    const category = EVAL_FAILURE_CATEGORIES.FRONTEND_ACK_FAILED
    failures.push({ transactionId, category })
    csvExporter?.addEvaluationResult({
      testId, transactionId: `${transactionId}_continuation`, model, provider,
      question: `[continuation] ${turn.user}`,
      type: TEST_TYPES.PERF.GOLDEN_DATASETS,
      expectedValue: turn.expected.output, receivedValue: '',
      score: TEST_SCORES.FAIL,
      scoreExplanation: `${category}: continuation response was empty`,
      latencyMs: continuationLatencyMs, scenarioId, turnNumber: turn.turn,
      turnType: EVAL_TURN_TYPES.CONTINUATION, toolSuccessRate,
      runLabel: settings.evalRunLabel ?? undefined
    })
    return { failures, newResponseId: continuation.responseId, skipRemaining: turn.criticalPath ?? false }
  }

  const continuationEvaluation = await evaluateAndCheckPass(
    continuation.text, buildJudgeCriteria(turn), turn.user,
    { mode: EvaluationMode.AI_JUDGE }, settings.aiSemanticPassThreshold
  )

  if (!continuationEvaluation.passed) {
    failures.push({ transactionId, category: EVAL_FAILURE_CATEGORIES.POOR_QUALITY })
  }

  csvExporter?.addEvaluationResult({
    testId, transactionId: `${transactionId}_continuation`, model, provider,
    question: `[continuation] ${turn.user}`,
    type: TEST_TYPES.PERF.GOLDEN_DATASETS,
    expectedValue: turn.expected.output,
    receivedValue: continuation.text.substring(0, STRING_TRUNCATION.MEDIUM_PREVIEW),
    score: continuationEvaluation.score,
    scoreExplanation: continuationEvaluation.explanation,
    judgeResponse: continuationEvaluation.rawResponse,
    tokenUsage: continuationEvaluation.tokenUsage,
    latencyMs: continuationLatencyMs, scenarioId, turnNumber: turn.turn,
    turnType: EVAL_TURN_TYPES.CONTINUATION, toolSuccessRate,
    runLabel: settings.evalRunLabel ?? undefined
  })

  return { failures, newResponseId: continuation.responseId, skipRemaining: false }
}

// ============================================================================
// Scenario Runner
// ============================================================================

async function runGoldenScenario(
  scenario: Scenario,
  client: AgentClient,
  model: string,
  provider: string,
  id: string,
  testId: string,
  csvExporter: CSVExporter | undefined,
  canaryMode: boolean
): Promise<FailureRecord[]> {
  const failures: FailureRecord[] = []
  let previousResponseId: string | undefined
  let skipRemaining = false

  const turns = canaryMode ? [scenario.turns[0]] : scenario.turns

  for (const turn of turns) {
    const transactionId = `golden_${scenario.scenarioId}_turn${turn.turn}_${provider}_${id}`

    if (skipRemaining) {
      csvExporter?.addEvaluationResult({
        testId, transactionId, model, provider,
        question: turn.user,
        type: TEST_TYPES.PERF.GOLDEN_DATASETS,
        expectedValue: `Tools required: ${turn.expected.tools_called.join(', ')}`,
        receivedValue: 'skipped',
        score: TEST_SCORES.FAIL,
        scoreExplanation: `${EVAL_FAILURE_CATEGORIES.TURN_SKIPPED}: critical-path dependency failed`,
        scenarioId: scenario.scenarioId, turnNumber: turn.turn,
        turnType: EVAL_TURN_TYPES.SKIPPED, toolSuccessRate: 0,
        runLabel: settings.evalRunLabel ?? undefined
      })
      failures.push({ transactionId, category: EVAL_FAILURE_CATEGORIES.TURN_SKIPPED })
      continue
    }

    const startMs = Date.now()
    const response = await client.send(turn.user, {
      model, enableRetry: true,
      ...(previousResponseId ? { previousResponseId } : {})
    })
    const latencyMs = Date.now() - startMs
    const toolCalls = response.toolCalls

    previousResponseId = response.responseId

    const unexpectedTools = toolCalls
      .filter((t: ToolCall) => !turn.expected.tools_called.includes(t.name))
      .map((t: ToolCall) => t.name)

    const toolSuccessRate = computeToolSuccessRate(toolCalls, turn.expected.tools_called)
    const toolCheckPassed = toolSuccessRate >= 1.0

    if (settings.evalStrictTools && unexpectedTools.length > 0) {
      for (const unexpected of unexpectedTools) {
        failures.push({ transactionId, category: EVAL_FAILURE_CATEGORIES.UNEXPECTED_TOOL })
        csvExporter?.addEvaluationResult({
          testId, transactionId: `${transactionId}_unexpected_${unexpected}`,
          model, provider, question: turn.user,
          type: TEST_TYPES.PERF.GOLDEN_DATASETS,
          expectedValue: `Tools required: ${turn.expected.tools_called.join(', ')}`,
          receivedValue: unexpected,
          score: TEST_SCORES.FAIL,
          scoreExplanation: `${EVAL_FAILURE_CATEGORIES.UNEXPECTED_TOOL}: ${unexpected}`,
          latencyMs, scenarioId: scenario.scenarioId, turnNumber: turn.turn,
          turnType: turn.frontendToolMocks ? EVAL_TURN_TYPES.TOOL : EVAL_TURN_TYPES.BACKEND,
          toolSuccessRate, runLabel: settings.evalRunLabel ?? undefined
        })
      }
    }

    const unexpectedNote = unexpectedTools.length > 0
      ? ` | unexpected_tools: ${unexpectedTools.join(', ')}`
      : ''

    if (!toolCheckPassed) {
      const missing = turn.expected.tools_called.filter((exp) => !toolCalls.find((t: ToolCall) => t.name === exp))
      failures.push({ transactionId, category: EVAL_FAILURE_CATEGORIES.REQUIRED_TOOL_NOT_CALLED })
      csvExporter?.addEvaluationResult({
        testId, transactionId, model, provider, question: turn.user,
        type: TEST_TYPES.PERF.GOLDEN_DATASETS,
        expectedValue: `Tools required: ${turn.expected.tools_called.join(', ')}`,
        receivedValue: toolCalls.map((t: ToolCall) => t.name).join(', ') || 'none',
        score: TEST_SCORES.FAIL,
        scoreExplanation: `${EVAL_FAILURE_CATEGORIES.REQUIRED_TOOL_NOT_CALLED}: missing ${missing.join(', ')}${unexpectedNote}`,
        latencyMs, scenarioId: scenario.scenarioId, turnNumber: turn.turn,
        turnType: turn.frontendToolMocks ? EVAL_TURN_TYPES.TOOL : EVAL_TURN_TYPES.BACKEND,
        toolSuccessRate, runLabel: settings.evalRunLabel ?? undefined
      })
      if (turn.criticalPath) skipRemaining = true
      continue
    }

    if (turn.frontendToolMocks && turn.frontendToolMocks.length > 0) {
      const result = await runToolTurn(
        client, model, csvExporter, testId, provider, turn,
        scenario.scenarioId, transactionId, toolCalls, toolSuccessRate,
        unexpectedNote, previousResponseId, latencyMs
      )
      failures.push(...result.failures)
      previousResponseId = result.newResponseId
      if (result.skipRemaining) skipRemaining = true
      continue
    }

    const backendFailures = await runBackendTurn(
      csvExporter, testId, model, provider, turn,
      scenario.scenarioId, transactionId, toolCalls, toolSuccessRate,
      unexpectedNote, response.text, latencyMs
    )
    failures.push(...backendFailures)
  }

  return failures
}

function buildJudgeCriteria(turn: ScenarioTurn): string {
  return `The response should:
- Answer the user's question
- Reference specific values or results from the tool outputs
- Be coherent with the conversation history
- Avoid fabricating values not present in the tool results

Reference answer (may differ due to data): ${turn.expected.output}`
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Eval/Perf Tests', () => {
  describe('Golden Dataset Task Fidelity [Not CI Gate] @ai-eval', () => {
    const testId = 'golden-datasets'
    const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined

    const modelsToTest = getModelsToTest()
    const tierBModels = getTierBModels()

    // -------------------------------------------------------------------------
    // Tier A — sales-analyzer (all providers)
    // -------------------------------------------------------------------------

    modelsToTest.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model}`, () => {
        it(`should complete scenario: ${SALES_ANALYZER_SCENARIO.name}`, async () => {
          const canaryMode = settings.evalScenarioScope === 'canary'
          const session = createSalesAnalyzerSession()
          const client = new AgentClient(session)

          const scenario = { ...SALES_ANALYZER_SCENARIO, session }
          const failures = await runGoldenScenario(
            scenario, client, model, provider, id, testId, csvExporter, canaryMode
          )

          if (failures.length > 0) {
            throw new Error(
              `[golden-datasets] ${failures.length} failure(s) in ${scenario.scenarioId} — ${provider}/${model}:\n` +
              failures.map((f) => `  • ${f.transactionId}: ${f.category}`).join('\n')
            )
          }
        })
      })
    })

    // -------------------------------------------------------------------------
    // Tier B — knowledge-search (Tier B providers only)
    // -------------------------------------------------------------------------

    tierBModels.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model} [Tier B]`, () => {
        it('should complete scenario: Knowledge Search with Isoline', async () => {
          if (settings.evalScenarioScope === 'canary') return

          const session = createKnowledgeSearchSession()
          const client = new AgentClient(session)
          const scenario = buildKnowledgeSearchScenario()

          const failures = await runGoldenScenario(
            scenario, client, model, provider, id, testId, csvExporter, false
          )

          if (failures.length > 0) {
            throw new Error(
              `[golden-datasets] ${failures.length} failure(s) in ${scenario.scenarioId} — ${provider}/${model}:\n` +
              failures.map((f) => `  • ${f.transactionId}: ${f.category}`).join('\n')
            )
          }
        })
      })
    })

    // -------------------------------------------------------------------------
    // Tier B — data-explorer (Tier B providers only)
    // -------------------------------------------------------------------------

    tierBModels.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model} [Tier B]`, () => {
        it('should complete scenario: Data Explorer with Visualisation', async () => {
          if (settings.evalScenarioScope === 'canary') return

          const session = createDataExplorerSession()
          const client = new AgentClient(session)
          const scenario = buildDataExplorerScenario()

          const failures = await runGoldenScenario(
            scenario, client, model, provider, id, testId, csvExporter, false
          )

          if (failures.length > 0) {
            throw new Error(
              `[golden-datasets] ${failures.length} failure(s) in ${scenario.scenarioId} — ${provider}/${model}:\n` +
              failures.map((f) => `  • ${f.transactionId}: ${f.category}`).join('\n')
            )
          }
        })
      })
    })
  })
})

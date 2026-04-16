/**
 * Context Coherence — Eval/Perf (TYPE 4) @ai-eval
 *
 * Multi-turn coherence benchmark: evaluates each turn with AI Judge
 * and exports per-turn scores to CSV for trend analysis.
 *
 * Structure:
 *   Turn 1: establish context ("I'm analysing Q1 sales for the EMEA region.")
 *   Turn 2: implicit reference ("What was the total?")
 *   Turn 3: entity carry-forward ("How does it compare to Q4?")
 *   Turn 4: deeper reference ("Which product had the highest growth?")
 *
 * Pass condition per-turn: AI Judge ≥ threshold.
 * Collect-then-fail — all turn failures surface together.
 * CI gate: NO.
 */

import { AgentClient } from '@agent/agent-client'
import { AgentSession } from '@agent/agent-session'
import { EvaluationMode } from '@support/types'
import { TEST_TYPES, EVAL_TURN_TYPES } from '@support/constants'
import { evaluateAndCheckPass } from '@judge/evaluator'
import { getCSVExporter } from '@support/csv-exporter'
import { getModelsToTest } from '@settings'
import * as settings from '@settings'

// ============================================================================
// Scenario Definition
// ============================================================================

interface CoherenceTurn {
  turn: number
  user: string
  expectedDescription: string
}

const COHERENCE_TURNS: CoherenceTurn[] = [
  {
    turn: 1,
    user: 'I want to analyse the sales performance of Widget Pro in EMEA for Q1 2024.',
    expectedDescription:
      'The assistant acknowledges the analysis goal for Widget Pro in EMEA Q1 2024, ' +
      'possibly asking for more context or describing what it can help with.'
  },
  {
    turn: 2,
    user: 'What tools would you use to get the total revenue for it?',
    expectedDescription:
      'The assistant refers to "it" as Widget Pro / the EMEA Q1 analysis established in Turn 1. ' +
      'It describes or suggests querying the dataset with execute_query or similar. ' +
      'Must NOT ask what "it" refers to.'
  },
  {
    turn: 3,
    user: 'Compare that to Widget Lite.',
    expectedDescription:
      'The assistant correctly interprets "that" as Widget Pro EMEA Q1 revenue. ' +
      'It proposes comparing Widget Pro with Widget Lite, maintaining the EMEA/Q1 context. ' +
      'No confusion about which products are being compared.'
  },
  {
    turn: 4,
    user: 'Which of those two had better unit sales?',
    expectedDescription:
      'The assistant correctly identifies "those two" as Widget Pro and Widget Lite from Turn 3. ' +
      'It provides a coherent answer about unit sales comparison without losing the conversation thread.'
  }
]

// ============================================================================
// Test Suite
// ============================================================================

describe('Eval/Perf Tests', () => {
  describe('Context Coherence [Not CI Gate] @ai-eval', () => {
    const testId = 'context-coherence-eval'
    const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined
    const modelsToTest = getModelsToTest()

    modelsToTest.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model}`, () => {
        it('should maintain coherence across a 4-turn analysis conversation', async () => {
          const session = new AgentSession({
            id: 'context-coherence-eval',
            systemPrompt:
              'You are a sales analysis assistant. ' +
              'Maintain conversational context across turns. ' +
              'Remember what was established in previous turns.',
            toolNames: [],
            mockExecutor: () => ({})
          })

          const client = new AgentClient(session)
          const failures: Array<{ turn: number; explanation: string; score: number }> = []

          let previousResponseId: string | undefined
          let conversationContext = ''

          for (const turnDef of COHERENCE_TURNS) {
            const startMs = Date.now()
            const response = await client.send(turnDef.user, {
              model, enableRetry: true,
              ...(previousResponseId ? { previousResponseId } : {})
            })
            const latencyMs = Date.now() - startMs

            const evaluation = await evaluateAndCheckPass(
              response.text,
              turnDef.expectedDescription,
              turnDef.user,
              { mode: EvaluationMode.AI_JUDGE },
              settings.aiSemanticPassThreshold,
              conversationContext || undefined
            )

            csvExporter?.addEvaluationResult({
              testId,
              transactionId: `coherence_turn${turnDef.turn}_${provider}_${id}`,
              model, provider,
              question: turnDef.user,
              type: TEST_TYPES.PERF.COHERENCE,
              expectedValue: turnDef.expectedDescription,
              receivedValue: response.text.substring(0, 300),
              score: evaluation.score,
              scoreExplanation: evaluation.explanation,
              judgeResponse: evaluation.rawResponse,
              tokenUsage: evaluation.tokenUsage,
              latencyMs,
              scenarioId: 'widget-pro-emea-analysis',
              turnNumber: turnDef.turn,
              turnType: EVAL_TURN_TYPES.BACKEND,
              runLabel: settings.evalRunLabel ?? undefined
            })

            if (!evaluation.passed) {
              failures.push({ turn: turnDef.turn, explanation: evaluation.explanation, score: evaluation.score })
            }

            // Update context for next turn
            conversationContext += `\nTurn ${turnDef.turn} — User: "${turnDef.user}" | Assistant: "${response.text.substring(0, 200)}"`
            previousResponseId = response.responseId
          }

          if (failures.length > 0) {
            throw new Error(
              `[context-coherence-eval] ${failures.length} turn(s) failed for ${provider}/${model}:\n` +
              failures.map((f) => `  Turn ${f.turn} (score=${f.score}): ${f.explanation}`).join('\n')
            )
          }
        })
      })
    })
  })
})

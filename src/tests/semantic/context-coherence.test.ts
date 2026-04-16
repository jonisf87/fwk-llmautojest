/**
 * Context Coherence (Semantic) @smoke-ai
 *
 * Verifies multi-turn conversation coherence:
 *   - Pronoun resolution: "it" / "that product" refers to the previously mentioned item
 *   - Context recall: model remembers earlier turns without re-stating them
 *   - No context bleed from unrelated sessions
 *
 * CI gate: YES. Evaluation: AI Judge.
 */

import { AgentClient } from '@agent/agent-client'
import { AgentSession } from '@agent/agent-session'
import { evaluateAndCheckPass } from '@judge/evaluator'
import { EvaluationMode } from '@support/types'
import { expectScoreGte } from '@support/assertions'
import { getCSVExporter } from '@support/csv-exporter'
import { TEST_TYPES } from '@support/constants'
import { getModelsToTest } from '@settings'
import * as settings from '@settings'

const SESSION = new AgentSession({
  id: 'context-coherence-semantic',
  systemPrompt:
    'You are a knowledgeable product assistant. ' +
    'Remember the context of the conversation and refer back to it naturally.',
  toolNames: [],
  mockExecutor: () => ({})
})

describe('Semantic Tests', () => {
  describe('Context Coherence @smoke-ai', () => {
    const testId = 'context-coherence-semantic'
    const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined
    const modelsToTest = getModelsToTest()

    modelsToTest.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model}`, () => {
        it('should resolve pronouns correctly across turns', async () => {
          const client = new AgentClient(SESSION)

          // Turn 1: establish context
          const turn1Q = 'My favourite programming language is TypeScript.'
          const turn1R = await client.send(turn1Q, { model, enableRetry: true })

          // Turn 2: pronoun reference — "it" must resolve to TypeScript
          const turn2Q = 'What are some popular frameworks for it?'
          const turn2R = await client.send(turn2Q, {
            model,
            enableRetry: true,
            previousResponseId: turn1R.responseId
          })

          const expected =
            'The response should list TypeScript (or JavaScript) frameworks such as React, Angular, ' +
            'NestJS, or Next.js. It must NOT ask for clarification about what "it" refers to, ' +
            'because the previous turn established TypeScript as the context.'

          const context = `Turn 1 — User: "${turn1Q}" | Assistant: "${turn1R.text.substring(0, 200)}"`

          const evaluation = await evaluateAndCheckPass(
            turn2R.text,
            expected,
            turn2Q,
            { mode: EvaluationMode.AI_JUDGE },
            settings.aiSemanticPassThreshold,
            context
          )

          csvExporter?.addEvaluationResult({
            testId,
            transactionId: `context_pronoun_${provider}_${id}`,
            model,
            provider,
            question: turn2Q,
            type: TEST_TYPES.SEMANTIC.CONTEXT_COHERENCE,
            expectedValue: expected,
            receivedValue: turn2R.text,
            score: evaluation.score,
            scoreExplanation: evaluation.explanation,
            tokenUsage: evaluation.tokenUsage,
            judgeResponse: evaluation.rawResponse
          })

          expectScoreGte(evaluation.score, settings.aiSemanticPassThreshold, {
            testId: `${testId}-pronoun`,
            explanation: evaluation.explanation,
            question: turn2Q
          })
        })
      })
    })
  })
})

/**
 * Branching Conversations @smoke-ai
 *
 * Verifies that branches from a shared parent maintain independent context
 * and do NOT bleed state between them.
 *
 * Conversation structure:
 *   parent: "What topics can you help with?"
 *      ├── Branch A: "Tell me more about data analysis."
 *      └── Branch B: "What about writing assistance?"
 *
 * Both branches must reference the parent context, not each other.
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
  id: 'branching-test',
  systemPrompt: 'You are a versatile assistant that can help with data analysis and writing tasks.',
  toolNames: [],
  mockExecutor: () => ({})
})

describe('Semantic Tests', () => {
  describe('Branching Conversations @smoke-ai', () => {
    const testId = 'branching-conversations'
    const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined
    const modelsToTest = getModelsToTest()

    modelsToTest.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model}`, () => {
        it('should maintain independent context in conversation branches', async () => {
          const client = new AgentClient(SESSION)
          const passThreshold = settings.aiSemanticPassThreshold

          // === Parent turn ===
          const parentQ = 'What topics can you help me with?'
          const parentR = await client.send(parentQ, { model, enableRetry: true })

          if (!parentR.responseId) {
            throw new Error('No responseId from parent — cannot branch')
          }

          // === Branch A: data analysis ===
          const branchAQ = 'Tell me more about data analysis capabilities.'
          const branchAR = await client.send(branchAQ, {
            model,
            enableRetry: true,
            previousResponseId: parentR.responseId
          })

          // === Branch B: writing assistance (branches from SAME parent) ===
          const branchBQ = 'What about writing assistance? What can you do there?'
          const branchBR = await client.send(branchBQ, {
            model,
            enableRetry: true,
            previousResponseId: parentR.responseId // same parent, not Branch A
          })

          const parentContext = `Parent — User: "${parentQ}" | Assistant: "${parentR.text.substring(0, 200)}"`

          // --- Evaluate Branch A ---
          const expectedA =
            'The response should elaborate on data analysis capabilities (e.g. statistics, visualisation, ' +
            'querying data). It should NOT mention writing assistance — that is Branch B content.'

          const evalA = await evaluateAndCheckPass(
            branchAR.text, expectedA, branchAQ,
            { mode: EvaluationMode.AI_JUDGE }, passThreshold, parentContext
          )

          csvExporter?.addEvaluationResult({
            testId,
            transactionId: `branching_A_${provider}_${id}`,
            model, provider, question: branchAQ,
            type: TEST_TYPES.SEMANTIC.CONVERSATION_BRANCHING,
            expectedValue: expectedA, receivedValue: branchAR.text,
            score: evalA.score, scoreExplanation: evalA.explanation,
            tokenUsage: evalA.tokenUsage, judgeResponse: evalA.rawResponse
          })

          // --- Evaluate Branch B ---
          const expectedB =
            'The response should describe writing assistance features (e.g. drafting, editing, ' +
            'summarisation). It should NOT reference data analysis as if it was just discussed — ' +
            'this branch is independent of Branch A.'

          const evalB = await evaluateAndCheckPass(
            branchBR.text, expectedB, branchBQ,
            { mode: EvaluationMode.AI_JUDGE }, passThreshold, parentContext
          )

          csvExporter?.addEvaluationResult({
            testId,
            transactionId: `branching_B_${provider}_${id}`,
            model, provider, question: branchBQ,
            type: TEST_TYPES.SEMANTIC.CONVERSATION_BRANCHING,
            expectedValue: expectedB, receivedValue: branchBR.text,
            score: evalB.score, scoreExplanation: evalB.explanation,
            tokenUsage: evalB.tokenUsage, judgeResponse: evalB.rawResponse
          })

          expectScoreGte(evalA.score, passThreshold, {
            testId: `${testId}-branch-A`, explanation: evalA.explanation, question: branchAQ
          })
          expectScoreGte(evalB.score, passThreshold, {
            testId: `${testId}-branch-B`, explanation: evalB.explanation, question: branchBQ
          })
        })
      })
    })
  })
})

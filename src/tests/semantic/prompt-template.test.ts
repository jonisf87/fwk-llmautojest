/**
 * Prompt Template @smoke-ai
 *
 * Verifies that each model follows the system prompt:
 *   - Language: responds in the same language as the user (Spanish question → Spanish answer)
 *   - Scope:    stays within the domain defined by the system prompt
 *   - Persona:  behaves as the configured assistant persona
 *
 * CI gate: YES. Evaluation: AI Judge (score ≥ threshold).
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

describe('Semantic Tests', () => {
  describe('Prompt Template @smoke-ai', () => {
    const testId = 'prompt-template'

    const session = new AgentSession({
      id: 'prompt-template-test',
      systemPrompt:
        'You are a concise sales data assistant. ' +
        'You help users understand sales figures and trends. ' +
        'Respond ONLY in the same language the user writes in. ' +
        'Do not discuss topics outside of sales and business data.',
      toolNames: [],
      mockExecutor: () => ({})
    })

    const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined
    const modelsToTest = getModelsToTest()

    modelsToTest.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model}`, () => {
        it('should respond in Spanish when the user writes in Spanish', async () => {
          const client = new AgentClient(session)
          const question = '¿Cuáles son las tendencias de ventas más importantes?'

          const response = await client.send(question, { model, enableRetry: true })

          const expected =
            'The response should be in Spanish and discuss sales trends or ask for clarification. ' +
            'It must NOT switch to English.'

          const evaluation = await evaluateAndCheckPass(
            response.text,
            expected,
            question,
            { mode: EvaluationMode.AI_JUDGE },
            settings.aiSemanticPassThreshold
          )

          csvExporter?.addEvaluationResult({
            testId,
            transactionId: `prompt_template_language_${provider}_${id}`,
            model,
            provider,
            question,
            type: TEST_TYPES.SEMANTIC.PROMPT_TEMPLATE,
            expectedValue: expected,
            receivedValue: response.text,
            score: evaluation.score,
            scoreExplanation: evaluation.explanation,
            tokenUsage: evaluation.tokenUsage,
            judgeResponse: evaluation.rawResponse
          })

          expectScoreGte(evaluation.score, settings.aiSemanticPassThreshold, {
            testId: `${testId}-language`,
            explanation: evaluation.explanation,
            question
          })
        })

        it('should stay within the sales domain', async () => {
          const client = new AgentClient(session)
          const question = 'Tell me about quantum physics and black holes.'

          const response = await client.send(question, { model, enableRetry: true })

          const expected =
            'The response should politely redirect the user to sales topics, ' +
            'or decline to answer, since the system prompt restricts the assistant to sales data only. ' +
            'A high-quality response does NOT provide physics information.'

          const evaluation = await evaluateAndCheckPass(
            response.text,
            expected,
            question,
            { mode: EvaluationMode.AI_JUDGE },
            settings.aiSemanticPassThreshold
          )

          csvExporter?.addEvaluationResult({
            testId,
            transactionId: `prompt_template_scope_${provider}_${id}`,
            model,
            provider,
            question,
            type: TEST_TYPES.SEMANTIC.PROMPT_TEMPLATE,
            expectedValue: expected,
            receivedValue: response.text,
            score: evaluation.score,
            scoreExplanation: evaluation.explanation,
            tokenUsage: evaluation.tokenUsage,
            judgeResponse: evaluation.rawResponse
          })

          expectScoreGte(evaluation.score, settings.aiPassThresholds.relaxed, {
            testId: `${testId}-scope`,
            explanation: evaluation.explanation,
            question
          })
        })
      })
    })
  })
})

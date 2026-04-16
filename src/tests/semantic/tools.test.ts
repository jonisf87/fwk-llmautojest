/**
 * Tool Calling — Semantic Tests @smoke-ai
 *
 * Verifies that the agent:
 *   1. Calls the expected backend tool and incorporates its result into the response.
 *   2. Handles a frontend tool turn correctly: calls the tool, then synthesises a
 *      coherent response after receiving the functionCallOutputs continuation.
 *
 * CI gate: YES. Evaluation: AI Judge for response quality.
 */

import { AgentClient } from '@agent/agent-client'
import { AgentSession } from '@agent/agent-session'
import { evaluateAndCheckPass } from '@judge/evaluator'
import { EvaluationMode } from '@support/types'
import { expectScoreGte } from '@support/assertions'
import { getCSVExporter } from '@support/csv-exporter'
import { TEST_TYPES, TOOLS } from '@support/constants'
import { buildFunctionCallOutputs, LONDON_ISOLINE_OUTPUT } from '@fixtures/tool-mocks'
import { executeMockQuery, KNOWN_COUNTS } from '@fixtures/tool-data'
import { getModelsToTest } from '@settings'
import * as settings from '@settings'

const BACKEND_SESSION = new AgentSession({
  id: 'tools-backend-test',
  systemPrompt:
    'You are a data assistant. Use the execute_query tool to query the sales dataset when needed. ' +
    'The dataset has columns: product, category, region, revenue, units, date.',
  toolNames: ['execute_query'],
  mockExecutor: (name, args) => {
    if (name === 'execute_query') return executeMockQuery((args.sql as string) ?? '')
    return {}
  }
})

const FRONTEND_SESSION = new AgentSession({
  id: 'tools-frontend-test',
  systemPrompt:
    'You are a location analysis assistant. ' +
    'When asked to generate an isoline, use the create_isoline tool with precise coordinates.',
  toolNames: ['create_isoline'],
  mockExecutor: () => ({})
})

describe('Semantic Tests', () => {
  describe('Tool Calling @smoke-ai', () => {
    const testId = 'tools'
    const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined
    const modelsToTest = getModelsToTest()

    modelsToTest.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model}`, () => {
        // -----------------------------------------------------------------------
        // Backend tool: execute_query auto-executed by AgentClient
        // -----------------------------------------------------------------------
        it('should call execute_query and return the count of sales records', async () => {
          const client = new AgentClient(BACKEND_SESSION)
          const question = `How many records are in the sales dataset?`

          const response = await client.send(question, { model, enableRetry: true })

          // Hard check: tool must have been called
          const queryTool = response.toolCalls.find((t) => t.name === TOOLS.EXECUTE_QUERY)
          if (!queryTool) {
            throw new Error(`[tools-backend] ${provider}/${model} did not call execute_query`)
          }

          // Hard check: tool response must have a result
          const toolResponse = response.toolResponses.find((r) => r.tool_call_id === queryTool.id)
          if (!toolResponse?.response) {
            throw new Error(`[tools-backend] ${provider}/${model} tool response is empty`)
          }

          const expected =
            `The response should state that the sales dataset has ${KNOWN_COUNTS.sales} records. ` +
            'The count must be derived from the query result, not estimated.'

          const evaluation = await evaluateAndCheckPass(
            response.text, expected, question,
            { mode: EvaluationMode.AI_JUDGE }, settings.aiSemanticPassThreshold
          )

          csvExporter?.addEvaluationResult({
            testId,
            transactionId: `tools_backend_${provider}_${id}`,
            model, provider, question,
            type: TEST_TYPES.SEMANTIC.TOOLS,
            expectedValue: expected, receivedValue: response.text,
            score: evaluation.score, scoreExplanation: evaluation.explanation,
            tokenUsage: evaluation.tokenUsage, judgeResponse: evaluation.rawResponse
          })

          expectScoreGte(evaluation.score, settings.aiSemanticPassThreshold, {
            testId: `${testId}-backend`, explanation: evaluation.explanation, question
          })
        })

        // -----------------------------------------------------------------------
        // Frontend tool: create_isoline — caller provides functionCallOutputs
        // -----------------------------------------------------------------------
        it('should call create_isoline and synthesise a response from the polygon result', async () => {
          const client = new AgentClient(FRONTEND_SESSION)
          const question = 'Generate a 15-minute driving isoline centred on London, UK.'

          // First call: expect tool calls to be returned (frontend tool = not auto-executed)
          const firstResponse = await client.send(question, { model, enableRetry: true })

          const isolineTool = firstResponse.toolCalls.find((t) => t.name === TOOLS.CREATE_ISOLINE)
          if (!isolineTool) {
            throw new Error(
              `[tools-frontend] ${provider}/${model} did not call create_isoline. ` +
              `Tool calls: ${firstResponse.toolCalls.map((t) => t.name).join(', ') || 'none'}`
            )
          }

          // Build functionCallOutputs from mock
          const { outputs, unmatched } = buildFunctionCallOutputs(
            firstResponse.toolCalls,
            [{ tool: 'create_isoline', output: LONDON_ISOLINE_OUTPUT }]
          )

          if (unmatched.length > 0) {
            throw new Error(`[tools-frontend] Unmatched mocks: ${unmatched.join(', ')}`)
          }

          // Continuation call with the frontend tool result
          const continuation = await client.send('', {
            model,
            enableRetry: true,
            previousResponseId: firstResponse.responseId,
            functionCallOutputs: outputs
          })

          const expected =
            'The response should confirm the 15-minute driving isoline around London has been generated. ' +
            'It should describe the result in user-friendly terms (coverage area, travel time, mode).'

          const evaluation = await evaluateAndCheckPass(
            continuation.text, expected, question,
            { mode: EvaluationMode.AI_JUDGE }, settings.aiSemanticPassThreshold
          )

          csvExporter?.addEvaluationResult({
            testId,
            transactionId: `tools_frontend_${provider}_${id}`,
            model, provider, question,
            type: TEST_TYPES.SEMANTIC.TOOLS,
            expectedValue: expected, receivedValue: continuation.text,
            score: evaluation.score, scoreExplanation: evaluation.explanation,
            tokenUsage: evaluation.tokenUsage, judgeResponse: evaluation.rawResponse
          })

          expectScoreGte(evaluation.score, settings.aiSemanticPassThreshold, {
            testId: `${testId}-frontend`, explanation: evaluation.explanation, question
          })
        })
      })
    })
  })
})

/**
 * Tool-Argument Correctness (TYPE 3) @ai-eval
 *
 * Deep-validates tool argument semantics beyond structural presence:
 *   - SQL contains COUNT keyword and toolResponse has a numeric result
 *   - Coordinates for a named city are within precisionTolerance of expected
 *
 * Grading: code-based only — zero AI Judge tokens.
 * CI gate: NO.
 */

import { AgentClient } from '@agent/agent-client'
import { AgentSession } from '@agent/agent-session'
import { ToolCall, ToolResponse } from '@support/types'
import {
  TEST_TYPES,
  TEST_COORDINATES,
  STRING_TRUNCATION,
  TEST_SCORES,
  EVAL_FAILURE_CATEGORIES,
  TOOLS
} from '@support/constants'
import { getCSVExporter } from '@support/csv-exporter'
import { executeMockQuery } from '@fixtures/tool-data'
import { getModelsToTest } from '@settings'
import * as settings from '@settings'

const QUERY_SESSION = new AgentSession({
  id: 'tool-arg-sql',
  systemPrompt:
    'You are a data analyst. Use execute_query to count records in the sales dataset.',
  toolNames: ['execute_query'],
  mockExecutor: (name, args) => {
    if (name === 'execute_query') return executeMockQuery((args.sql as string) ?? '')
    return {}
  }
})

const COORD_SESSION = new AgentSession({
  id: 'tool-arg-coord',
  systemPrompt:
    'You are a mapping assistant. ' +
    'When asked to create an isoline, use the create_isoline tool with precise coordinates for the named location.',
  toolNames: ['create_isoline'],
  mockExecutor: () => ({})
})

describe('Eval/Perf Tests', () => {
  describe('Tool-Argument Correctness [Not CI Gate] @ai-eval', () => {
    const testId = 'tool-arg-correctness'
    const csvExporter = settings.aiCsvExportEnabled ? getCSVExporter(testId) : undefined
    const modelsToTest = getModelsToTest()

    modelsToTest.forEach(({ id, provider, model }) => {
      describe(`${provider} - ${model}`, () => {

        // -----------------------------------------------------------------------
        // SQL COUNT keyword check
        // -----------------------------------------------------------------------
        it('should construct SQL with COUNT keyword for a record count query', async () => {
          const client = new AgentClient(QUERY_SESSION)
          const question = 'Count the number of records in the sales dataset.'
          const startMs = Date.now()

          const response = await client.send(question, { model, enableRetry: true })
          const latencyMs = Date.now() - startMs

          const toolCalls = response.toolCalls
          const toolResponses = response.toolResponses

          const executeQueryTool = toolCalls.find(
            (t: ToolCall) => t.name === TOOLS.EXECUTE_QUERY
          )

          if (!executeQueryTool) {
            csvExporter?.addEvaluationResult({
              testId,
              transactionId: `sql_count_${provider}_${id}`,
              model, provider, question,
              type: TEST_TYPES.PERF.TOOL_ARG_CORRECTNESS,
              expectedValue: 'SQL query with COUNT keyword',
              receivedValue: toolCalls.map((t) => t.name).join(', ') || 'none',
              score: TEST_SCORES.FAIL,
              scoreExplanation: EVAL_FAILURE_CATEGORIES.REQUIRED_TOOL_NOT_CALLED,
              latencyMs, runLabel: settings.evalRunLabel ?? undefined
            })
            throw new Error(`[tool-arg] ${EVAL_FAILURE_CATEGORIES.REQUIRED_TOOL_NOT_CALLED}: execute_query not called`)
          }

          const sqlArg = (() => {
            try {
              return (JSON.parse(executeQueryTool.arguments) as Record<string, string>).sql ?? ''
            } catch {
              return ''
            }
          })()

          if (!sqlArg) {
            csvExporter?.addEvaluationResult({
              testId,
              transactionId: `sql_count_${provider}_${id}`,
              model, provider, question,
              type: TEST_TYPES.PERF.TOOL_ARG_CORRECTNESS,
              expectedValue: 'SQL with COUNT',
              receivedValue: executeQueryTool.arguments.substring(0, STRING_TRUNCATION.MEDIUM_PREVIEW),
              score: TEST_SCORES.FAIL,
              scoreExplanation: EVAL_FAILURE_CATEGORIES.INVALID_TOOL_ARGS,
              latencyMs, runLabel: settings.evalRunLabel ?? undefined
            })
            throw new Error(`[tool-arg] ${EVAL_FAILURE_CATEGORIES.INVALID_TOOL_ARGS}: sql argument is empty or unparseable`)
          }

          const hasCOUNT = sqlArg.toUpperCase().includes('COUNT')

          if (!hasCOUNT) {
            csvExporter?.addEvaluationResult({
              testId,
              transactionId: `sql_count_${provider}_${id}`,
              model, provider, question,
              type: TEST_TYPES.PERF.TOOL_ARG_CORRECTNESS,
              expectedValue: 'SQL containing COUNT(...)',
              receivedValue: sqlArg.substring(0, STRING_TRUNCATION.MEDIUM_PREVIEW),
              score: TEST_SCORES.FAIL,
              scoreExplanation: EVAL_FAILURE_CATEGORIES.SQL_MISSING_COUNT,
              latencyMs, runLabel: settings.evalRunLabel ?? undefined
            })
            throw new Error(`[tool-arg] ${EVAL_FAILURE_CATEGORIES.SQL_MISSING_COUNT}: SQL="${sqlArg}"`)
          }

          // Verify the toolResponse has a numeric result
          const toolResp = toolResponses.find(
            (r: ToolResponse) => r.tool_call_id === executeQueryTool.id
          )
          const hasNumericResult = toolResp?.response
            ? /\d+/.test(toolResp.response)
            : false

          csvExporter?.addEvaluationResult({
            testId,
            transactionId: `sql_count_${provider}_${id}`,
            model, provider, question,
            type: TEST_TYPES.PERF.TOOL_ARG_CORRECTNESS,
            expectedValue: 'SQL with COUNT; numeric result in toolResponse',
            receivedValue: sqlArg.substring(0, STRING_TRUNCATION.MEDIUM_PREVIEW),
            score: hasNumericResult ? TEST_SCORES.PASS : TEST_SCORES.FAIL,
            scoreExplanation: hasNumericResult
              ? `COUNT keyword present; numeric result: ${toolResp?.response?.substring(0, 50) ?? ''}`
              : EVAL_FAILURE_CATEGORIES.SQL_EXECUTION_FAILED,
            latencyMs,
            apiResponse: JSON.stringify({ toolCalls: toolCalls.map((t) => ({ name: t.name, sql: t.arguments.substring(0, 100) })) }),
            runLabel: settings.evalRunLabel ?? undefined
          })

          if (!hasNumericResult) {
            throw new Error(`[tool-arg] ${EVAL_FAILURE_CATEGORIES.SQL_EXECUTION_FAILED}: no numeric value in tool response`)
          }

          expect(hasCOUNT).toBe(true)
          expect(hasNumericResult).toBe(true)
        })

        // -----------------------------------------------------------------------
        // Coordinate precision check
        // -----------------------------------------------------------------------
        it('should call create_isoline with accurate coordinates for London', async () => {
          const client = new AgentClient(COORD_SESSION)
          const question = 'Create a 15-minute driving isoline centred on London, United Kingdom.'
          const { lat: expectedLat, lng: expectedLng, precisionTolerance } = TEST_COORDINATES.LONDON
          const startMs = Date.now()

          const response = await client.send(question, { model, enableRetry: true })
          const latencyMs = Date.now() - startMs

          const toolCalls = response.toolCalls
          const isolineTool = toolCalls.find((t: ToolCall) => t.name === TOOLS.CREATE_ISOLINE)

          if (!isolineTool) {
            csvExporter?.addEvaluationResult({
              testId,
              transactionId: `coord_london_${provider}_${id}`,
              model, provider, question,
              type: TEST_TYPES.PERF.TOOL_ARG_CORRECTNESS,
              expectedValue: `lat≈${expectedLat}, lng≈${expectedLng}`,
              receivedValue: toolCalls.map((t) => t.name).join(', ') || 'none',
              score: TEST_SCORES.FAIL,
              scoreExplanation: EVAL_FAILURE_CATEGORIES.REQUIRED_TOOL_NOT_CALLED,
              latencyMs, runLabel: settings.evalRunLabel ?? undefined
            })
            throw new Error(`[tool-arg] ${EVAL_FAILURE_CATEGORIES.REQUIRED_TOOL_NOT_CALLED}: create_isoline not called`)
          }

          let receivedLat: number | null = null
          let receivedLng: number | null = null

          try {
            const args = JSON.parse(isolineTool.arguments) as Record<string, unknown>
            receivedLat = typeof args.lat === 'number' ? args.lat : null
            receivedLng = typeof args.lng === 'number' ? args.lng : null
          } catch {
            // args unparseable
          }

          if (receivedLat === null || receivedLng === null) {
            csvExporter?.addEvaluationResult({
              testId,
              transactionId: `coord_london_${provider}_${id}`,
              model, provider, question,
              type: TEST_TYPES.PERF.TOOL_ARG_CORRECTNESS,
              expectedValue: `lat≈${expectedLat}, lng≈${expectedLng}`,
              receivedValue: isolineTool.arguments.substring(0, STRING_TRUNCATION.MEDIUM_PREVIEW),
              score: TEST_SCORES.FAIL,
              scoreExplanation: EVAL_FAILURE_CATEGORIES.INVALID_TOOL_ARGS,
              latencyMs, runLabel: settings.evalRunLabel ?? undefined
            })
            throw new Error(`[tool-arg] ${EVAL_FAILURE_CATEGORIES.INVALID_TOOL_ARGS}: lat/lng missing in args`)
          }

          const latDelta = Math.abs(receivedLat - expectedLat)
          const lngDelta = Math.abs(receivedLng - expectedLng)
          const withinTolerance = latDelta <= precisionTolerance && lngDelta <= precisionTolerance

          csvExporter?.addEvaluationResult({
            testId,
            transactionId: `coord_london_${provider}_${id}`,
            model, provider, question,
            type: TEST_TYPES.PERF.TOOL_ARG_CORRECTNESS,
            expectedValue: `lat=${expectedLat}±${precisionTolerance}, lng=${expectedLng}±${precisionTolerance}`,
            receivedValue: `lat=${receivedLat}, lng=${receivedLng}`,
            score: withinTolerance ? TEST_SCORES.PASS : TEST_SCORES.FAIL,
            scoreExplanation: withinTolerance
              ? `Within tolerance: Δlat=${latDelta.toFixed(4)}, Δlng=${lngDelta.toFixed(4)}`
              : `${EVAL_FAILURE_CATEGORIES.COORDINATE_IMPRECISION}: Δlat=${latDelta.toFixed(4)}, Δlng=${lngDelta.toFixed(4)}`,
            latencyMs, runLabel: settings.evalRunLabel ?? undefined
          })

          if (!withinTolerance) {
            throw new Error(
              `[tool-arg] ${EVAL_FAILURE_CATEGORIES.COORDINATE_IMPRECISION}: ` +
              `lat=${receivedLat} (expected ${expectedLat}±${precisionTolerance}), ` +
              `lng=${receivedLng} (expected ${expectedLng}±${precisionTolerance})`
            )
          }

          expect(withinTolerance).toBe(true)
        })
      })
    })
  })
})

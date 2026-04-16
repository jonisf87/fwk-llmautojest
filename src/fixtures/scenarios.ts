/**
 * Test scenario definitions for eval/perf tests.
 *
 * Each scenario describes a multi-turn conversation with expected tools,
 * reference outputs, and optional frontend tool mocks.
 *
 * Domain-agnostic scenarios: sales-analyzer, knowledge-search, data-explorer.
 *
 * Tier A:
 *   sales-analyzer — backend tools only, ephemeral session, all providers.
 *
 * Tier B (frontend tools, richer scenarios):
 *   knowledge-search — search_documents + create_isoline (frontend)
 *   data-explorer    — execute_query + render_visualization (frontend)
 */

import { AgentSession } from '@agent/agent-session'
import { MockExecutor } from '@agent/agent-session'
import {
  executeMockQuery,
  searchMockDocuments,
  KNOWN_COUNTS
} from './tool-data'
import { FrontendToolMock, LONDON_ISOLINE_OUTPUT, TOP_PRODUCTS_CHART_OUTPUT } from './tool-mocks'

// ============================================================================
// Types
// ============================================================================

export interface ScenarioTurn {
  /** Turn index (1-based). */
  turn: number
  /** User message. */
  user: string
  expected: {
    /** Expected tool names to be called (order-insensitive). */
    tools_called: string[]
    /** Reference output description (used as AI Judge criteria). */
    output: string
  }
  /** If set, a hard failure on this turn skips subsequent turns. */
  criticalPath?: boolean
  /** Frontend tool mocks for this turn (absent = backend-only turn). */
  frontendToolMocks?: FrontendToolMock[]
}

export interface Scenario {
  scenarioId: string
  name: string
  session: AgentSession
  turns: ScenarioTurn[]
}

// ============================================================================
// Shared Mock Executor
// ============================================================================

const DEFAULT_EXECUTOR: MockExecutor = (toolName, args) => {
  switch (toolName) {
    case 'execute_query':
      return executeMockQuery((args.sql as string) ?? '')

    case 'search_documents':
      return searchMockDocuments((args.query as string) ?? '', (args.top_k as number) ?? 5)

    case 'get_record_count': {
      const name = (args.dataset_name as string) ?? ''
      const count = KNOWN_COUNTS[name as keyof typeof KNOWN_COUNTS] ?? 0
      return { dataset: name, count }
    }

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}

// ============================================================================
// Tier A — Sales Analyzer
// ============================================================================

const SALES_SYSTEM_PROMPT = `You are a data analysis assistant for a sales database.
You have access to a "sales" table with columns: product, category, region, revenue, units, date.

Always use the available tools to query data before answering factual questions.
Be precise with numbers and cite the data source in your response.`

export function createSalesAnalyzerSession(): AgentSession {
  return new AgentSession({
    id: 'sales-analyzer',
    systemPrompt: SALES_SYSTEM_PROMPT,
    toolNames: ['execute_query', 'get_record_count'],
    mockExecutor: DEFAULT_EXECUTOR
  })
}

export const SALES_ANALYZER_SCENARIO: Scenario = {
  scenarioId: 'sales-analyzer-001',
  name: 'Sales Data Analysis',
  session: createSalesAnalyzerSession(),
  turns: [
    {
      turn: 1,
      user: 'What are the top 3 products by total revenue?',
      expected: {
        tools_called: ['execute_query'],
        output:
          'The top 3 products by revenue are CloudBase ($157,000), DataSync ($106,000), and Widget Pro ($36,250). ' +
          'The response should include product names and revenue figures sourced from the query results.'
      },
      criticalPath: true
    },
    {
      turn: 2,
      user: 'Which region has the highest total revenue?',
      expected: {
        tools_called: ['execute_query'],
        output:
          'North America (NA) has the highest total revenue. ' +
          'The response should cite the specific revenue figure and identify NA as the leading region.'
      }
    }
  ]
}

// ============================================================================
// Tier B — Knowledge Search (with frontend tool)
// ============================================================================

const KNOWLEDGE_SYSTEM_PROMPT = `You are a knowledge assistant with access to a documentation knowledge base.
Use the search_documents tool to find relevant information before answering questions.
When asked to show results on a map or generate an isoline, use the create_isoline tool.
Always ground your answers in the retrieved documents.`

export function createKnowledgeSearchSession(): AgentSession {
  return new AgentSession({
    id: 'knowledge-search',
    systemPrompt: KNOWLEDGE_SYSTEM_PROMPT,
    toolNames: ['search_documents', 'create_isoline'],
    mockExecutor: DEFAULT_EXECUTOR
  })
}

export function buildKnowledgeSearchScenario(): Scenario {
  return {
    scenarioId: 'knowledge-search-001',
    name: 'Knowledge Search with Isoline',
    session: createKnowledgeSearchSession(),
    turns: [
      {
        turn: 1,
        user: 'Find documents about LLM evaluation and testing best practices.',
        expected: {
          tools_called: ['search_documents'],
          output:
            'The response should list relevant documents about LLM evaluation, mentioning titles like ' +
            '"LLM-as-a-Judge: Best Practices" and "Integration Testing Patterns for AI Systems". ' +
            'Summaries should be grounded in the retrieved document content.'
        },
        criticalPath: true
      },
      {
        turn: 2,
        user: 'Show me the 15-minute driving isoline centred on London.',
        expected: {
          tools_called: ['create_isoline']
        },
        frontendToolMocks: [
          {
            tool: 'create_isoline',
            output: LONDON_ISOLINE_OUTPUT
          }
        ]
      } as ScenarioTurn
    ]
  }
}

// Fix: add the missing output field for the frontend tool turn
;(buildKnowledgeSearchScenario().turns[1] as ScenarioTurn).expected.output =
  'The response should confirm that the 15-minute driving isoline around London has been generated ' +
  'and describe the approximate coverage area.'

// ============================================================================
// Tier B — Data Explorer (backend + frontend tools)
// ============================================================================

const DATA_EXPLORER_SYSTEM_PROMPT = `You are a data exploration assistant.
You have access to a "sales" dataset you can query with SQL.
When asked to visualise data, use the render_visualization tool to display charts.
Always query the data before creating visualisations.`

export function createDataExplorerSession(): AgentSession {
  return new AgentSession({
    id: 'data-explorer',
    systemPrompt: DATA_EXPLORER_SYSTEM_PROMPT,
    toolNames: ['execute_query', 'render_visualization'],
    mockExecutor: DEFAULT_EXECUTOR
  })
}

export function buildDataExplorerScenario(): Scenario {
  return {
    scenarioId: 'data-explorer-001',
    name: 'Data Explorer with Visualisation',
    session: createDataExplorerSession(),
    turns: [
      {
        turn: 1,
        user: 'Show me a bar chart of the top 5 products by revenue.',
        expected: {
          tools_called: ['execute_query', 'render_visualization'],
          output:
            'The response should confirm the bar chart has been rendered showing top products by revenue.',
          tools_called_note: 'execute_query first, then render_visualization with the results'
        } as ScenarioTurn['expected'] & { tools_called_note: string },
        criticalPath: true,
        frontendToolMocks: [
          {
            tool: 'render_visualization',
            matchOn: { arg: 'chart_type', value: 'bar' },
            output: TOP_PRODUCTS_CHART_OUTPUT
          }
        ]
      }
    ]
  }
}

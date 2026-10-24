import {
  EMPLOYEE_ROWS,
  KNOWLEDGE_DOCS,
  KNOWN_COUNTS,
  SALES_ROWS,
  executeMockQuery,
  searchMockDocuments
} from '@fixtures/tool-data'
import { buildFunctionCallOutputs } from '@fixtures/tool-mocks'
import { FRONTEND_TOOLS, selectTools } from '@agent/agent-tools'

describe('mock tool data', () => {
  it('KNOWN_COUNTS matches the datasets', () => {
    expect(KNOWN_COUNTS).toEqual({
      sales: SALES_ROWS.length,
      employees: EMPLOYEE_ROWS.length,
      knowledge_base: KNOWLEDGE_DOCS.length
    })
  })

  it('COUNT queries return the dataset size', () => {
    expect(executeMockQuery('SELECT COUNT(*) FROM sales').data.rows).toEqual([{ count: SALES_ROWS.length }])
    expect(executeMockQuery('SELECT COUNT(*) FROM employees').data.rows).toEqual([{ count: EMPLOYEE_ROWS.length }])
  })

  it('ORDER BY revenue DESC LIMIT N returns the top-N rows', () => {
    const { rows } = executeMockQuery('SELECT * FROM sales ORDER BY revenue DESC LIMIT 3').data
    const revenues = (rows as { revenue: number }[]).map((r) => r.revenue)
    expect(revenues).toHaveLength(3)
    expect(revenues).toEqual([...revenues].sort((a, b) => b - a))
    expect(revenues[0]).toBe(Math.max(...SALES_ROWS.map((r) => r.revenue)))
  })

  it('unknown tables return no rows', () => {
    expect(executeMockQuery('SELECT * FROM nothing').data.rows).toEqual([])
  })

  it('searchMockDocuments honours topK and ranks matches first', () => {
    const { documents } = searchMockDocuments(KNOWLEDGE_DOCS[0].title, 2)
    expect(documents).toHaveLength(2)
    expect(documents[0].id).toBe(KNOWLEDGE_DOCS[0].id)
  })
})

describe('tool definitions', () => {
  it('selectTools resolves known names and rejects unknown ones', () => {
    expect(selectTools(['execute_query']).map((t) => t.name)).toEqual(['execute_query'])
    expect(() => selectTools(['nope'])).toThrow('Unknown tool: "nope"')
  })

  it('frontend tools are all registered', () => {
    for (const name of FRONTEND_TOOLS) {
      expect(selectTools([name])).toHaveLength(1)
    }
  })
})

describe('buildFunctionCallOutputs', () => {
  it('matches mocks to tool calls and reports unmatched mocks', () => {
    const toolCalls = [{ id: 'call_1', name: 'create_isoline', arguments: '{}' }]
    const { outputs, unmatched } = buildFunctionCallOutputs(toolCalls, [
      { tool: 'create_isoline', output: { ok: true } },
      { tool: 'render_visualization', output: { ok: true } }
    ] as never)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].call_id).toBe('call_1')
    expect(unmatched).toEqual(['render_visualization'])
  })
})

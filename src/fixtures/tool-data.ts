/**
 * Mock data for tool calls.
 *
 * All tools execute against this in-memory data — no external services needed.
 * Counts and values here are the "ground truth" used by grounding/robustness tests.
 */

// ============================================================================
// Sales Dataset
// ============================================================================

export interface SalesRow {
  id: number
  product: string
  category: string
  region: string
  revenue: number
  units: number
  date: string
}

export const SALES_ROWS: SalesRow[] = [
  { id: 1, product: 'Widget Pro', category: 'Hardware', region: 'EMEA', revenue: 12500, units: 250, date: '2024-01-15' },
  { id: 2, product: 'DataSync', category: 'Software', region: 'NA', revenue: 45000, units: 90, date: '2024-01-20' },
  { id: 3, product: 'Widget Pro', category: 'Hardware', region: 'APAC', revenue: 8750, units: 175, date: '2024-02-01' },
  { id: 4, product: 'CloudBase', category: 'Software', region: 'EMEA', revenue: 62000, units: 124, date: '2024-02-10' },
  { id: 5, product: 'Widget Lite', category: 'Hardware', region: 'NA', revenue: 3200, units: 320, date: '2024-02-15' },
  { id: 6, product: 'DataSync', category: 'Software', region: 'APAC', revenue: 28000, units: 56, date: '2024-03-01' },
  { id: 7, product: 'CloudBase', category: 'Software', region: 'NA', revenue: 95000, units: 190, date: '2024-03-05' },
  { id: 8, product: 'Widget Pro', category: 'Hardware', region: 'NA', revenue: 15000, units: 300, date: '2024-03-10' },
  { id: 9, product: 'SupportPlus', category: 'Service', region: 'EMEA', revenue: 18000, units: 60, date: '2024-03-15' },
  { id: 10, product: 'DataSync', category: 'Software', region: 'EMEA', revenue: 33000, units: 66, date: '2024-03-20' }
]

export const SALES_SCHEMA = [
  { name: 'id', type: 'INTEGER' },
  { name: 'product', type: 'VARCHAR' },
  { name: 'category', type: 'VARCHAR' },
  { name: 'region', type: 'VARCHAR' },
  { name: 'revenue', type: 'NUMERIC' },
  { name: 'units', type: 'INTEGER' },
  { name: 'date', type: 'DATE' }
]

// ============================================================================
// Employee Dataset
// ============================================================================

export interface EmployeeRow {
  id: number
  name: string
  department: string
  role: string
  salary: number
  years_experience: number
  location: string
}

export const EMPLOYEE_ROWS: EmployeeRow[] = [
  { id: 1, name: 'Alice Chen', department: 'Engineering', role: 'Senior Engineer', salary: 120000, years_experience: 8, location: 'London' },
  { id: 2, name: 'Bob Martinez', department: 'Sales', role: 'Account Executive', salary: 75000, years_experience: 4, location: 'Madrid' },
  { id: 3, name: 'Carol Smith', department: 'Engineering', role: 'Staff Engineer', salary: 145000, years_experience: 12, location: 'London' },
  { id: 4, name: 'David Lee', department: 'Product', role: 'Product Manager', salary: 110000, years_experience: 6, location: 'Berlin' },
  { id: 5, name: 'Eva Johnson', department: 'Sales', role: 'Sales Director', salary: 95000, years_experience: 9, location: 'London' }
]

// ============================================================================
// Knowledge Base
// ============================================================================

export interface KnowledgeDoc {
  id: string
  title: string
  content: string
  tags: string[]
  score?: number // relevance score added during search
}

export const KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  {
    id: 'doc-001',
    title: 'LLM-as-a-Judge: Best Practices',
    content:
      'LLM-as-a-Judge is an evaluation technique that uses a large language model to score ' +
      'the quality of another model\'s responses. Key considerations: choose a capable judge ' +
      'model, define clear rubrics, use structured output for deterministic scoring, and ' +
      'calibrate thresholds on human-labelled examples.',
    tags: ['evaluation', 'llm', 'testing']
  },
  {
    id: 'doc-002',
    title: 'Integration Testing Patterns for AI Systems',
    content:
      'AI integration tests should verify model behaviour end-to-end, including tool calling, ' +
      'multi-turn coherence, and factual grounding. Separate CI-gated smoke tests (fast, ' +
      'deterministic) from eval/perf tests (non-gated, richer metrics).',
    tags: ['testing', 'integration', 'ai']
  },
  {
    id: 'doc-003',
    title: 'Provider-Agnostic LLM Testing',
    content:
      'Abstracting LLM providers behind a common interface allows the same test suite to run ' +
      'against OpenAI, Anthropic, and Gemini. Use OpenAI-compatible endpoints where possible ' +
      'or provider-specific SDKs with a normalisation adapter.',
    tags: ['testing', 'providers', 'openai', 'anthropic', 'gemini']
  },
  {
    id: 'doc-004',
    title: 'Robustness Testing for NLP Models',
    content:
      'Robustness tests measure whether a model produces consistent results across semantically ' +
      'equivalent input phrasings. A high score variance across paraphrases indicates the model ' +
      'is sensitive to surface-form variations rather than semantic content.',
    tags: ['testing', 'robustness', 'nlp']
  },
  {
    id: 'doc-005',
    title: 'Grounding and Factual Accuracy in RAG Systems',
    content:
      'Grounding tests verify that a model\'s stated facts can be traced back to retrieved ' +
      'context or tool outputs. A grounded model should cite specific values from tool responses, ' +
      'not fabricate plausible-sounding numbers.',
    tags: ['grounding', 'rag', 'factual-accuracy']
  }
]

// ============================================================================
// Known Record Counts (used as ground truth in grounding tests)
// ============================================================================

export const KNOWN_COUNTS = {
  sales: SALES_ROWS.length,           // 10
  employees: EMPLOYEE_ROWS.length,     // 5
  knowledge_base: KNOWLEDGE_DOCS.length // 5
} as const

// ============================================================================
// Mock Query Executor
// ============================================================================

/**
 * Naive in-memory SQL executor.
 *
 * Supports only basic SELECT queries for the datasets above.
 * Returns {data: {rows: [], columns: []}} structure.
 *
 * Recognised SQL patterns:
 *   - SELECT COUNT(*) FROM sales/employees  → returns count
 *   - SELECT ... FROM sales ORDER BY revenue DESC LIMIT N → top-N products
 *   - Any other: returns all rows from the first mentioned table
 */
export function executeMockQuery(sql: string): { data: { rows: unknown[]; columns: string[] } } {
  const lower = sql.toLowerCase()

  const isCount = lower.includes('count(')
  const isSales = lower.includes('sales')
  const isEmployees = lower.includes('employees')

  const dataset: { rows: unknown[]; columns: string[] } = (() => {
    if (isSales) {
      return { rows: SALES_ROWS, columns: SALES_SCHEMA.map((c) => c.name) }
    }
    if (isEmployees) {
      return { rows: EMPLOYEE_ROWS, columns: ['id', 'name', 'department', 'role', 'salary', 'years_experience', 'location'] }
    }
    return { rows: [], columns: [] }
  })()

  if (isCount) {
    const count = dataset.rows.length
    return { data: { rows: [{ count }], columns: ['count'] } }
  }

  // ORDER BY revenue DESC LIMIT N (top-N)
  const limitMatch = lower.match(/limit\s+(\d+)/)
  const limit = limitMatch ? parseInt(limitMatch[1], 10) : 1000

  const orderByRevenue = lower.includes('order by') && lower.includes('revenue')
  let rows = [...dataset.rows]

  if (orderByRevenue) {
    rows = rows.sort((a, b) => {
      const aRev = (a as SalesRow).revenue ?? 0
      const bRev = (b as SalesRow).revenue ?? 0
      return bRev - aRev
    })
  }

  return { data: { rows: rows.slice(0, limit), columns: dataset.columns } }
}

// ============================================================================
// Mock Document Searcher
// ============================================================================

export function searchMockDocuments(query: string, topK = 5): { documents: KnowledgeDoc[] } {
  const words = query.toLowerCase().split(/\s+/)

  const scored = KNOWLEDGE_DOCS.map((doc) => {
    const text = `${doc.title} ${doc.content} ${doc.tags.join(' ')}`.toLowerCase()
    const score = words.reduce((sum, w) => sum + (text.includes(w) ? 1 : 0), 0)
    return { ...doc, score }
  })

  const ranked = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return { documents: ranked }
}

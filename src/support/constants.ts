/**
 * Constants for fmw-llmmautojest
 *
 * Centralised strings and numeric literals used across tests.
 * All values are provider-agnostic.
 */

// ============================================================================
// Test Type Constants
// ============================================================================

export const TEST_TYPES = {
  STRUCTURAL: {
    MODEL_HEALTH: 'model_health'
  },
  SEMANTIC: {
    PROMPT_TEMPLATE: 'prompt_template',
    CONTEXT_COHERENCE: 'context_coherence',
    CONVERSATION_BRANCHING: 'conversation_branching',
    TOOLS: 'tools'
  },
  PERF: {
    GOLDEN_DATASETS: 'golden_datasets',
    TOOL_ARG_CORRECTNESS: 'tool_arg_correctness',
    GROUNDING: 'grounding',
    ROBUSTNESS: 'robustness',
    COHERENCE: 'context_coherence'
  }
} as const

// ============================================================================
// Test Messages
// ============================================================================

export const TEST_MESSAGES = {
  SIMPLE_GREETING: 'Hello'
} as const

// ============================================================================
// Test Coordinates — London city centre
// ============================================================================

export const TEST_COORDINATES = {
  LONDON: {
    lat: 51.5074,
    lng: -0.1278,
    label: 'London, UK',
    /** Broad range — confirms the model knows where London is */
    validationRange: {
      latMin: 51.0,
      latMax: 52.0,
      lngMin: -1.0,
      lngMax: 0.5
    },
    /** Tight tolerance (degrees) — confirms coordinate precision */
    precisionTolerance: 0.1
  }
} as const

// ============================================================================
// Tool Names
// ============================================================================

export const TOOLS = {
  EXECUTE_QUERY: 'execute_query',
  SEARCH_DOCUMENTS: 'search_documents',
  GET_RECORD_COUNT: 'get_record_count',
  CREATE_ISOLINE: 'create_isoline',
  RENDER_VISUALIZATION: 'render_visualization'
} as const

// ============================================================================
// Dataset Names (used in prompts and tests)
// ============================================================================

export const DATASETS = {
  SALES: 'sales',
  EMPLOYEES: 'employees',
  KNOWLEDGE_BASE: 'knowledge_base'
} as const

// ============================================================================
// String Truncation
// ============================================================================

export const STRING_TRUNCATION = {
  SHORT_PREVIEW: 100,
  MEDIUM_PREVIEW: 500
} as const

// ============================================================================
// Test Scores
// ============================================================================

export const TEST_SCORES = {
  PASS: 10,
  FAIL: 0
} as const

// ============================================================================
// Grounding
// ============================================================================

/** Maximum allowed relative error when comparing extracted count to ground truth. */
export const GROUNDING_PCT_ERROR_THRESHOLD = 0.05

// ============================================================================
// Eval Failure Categories
// ============================================================================

export const EVAL_FAILURE_CATEGORIES = {
  // Common
  INVALID_TOOL_ARGS: 'INVALID_TOOL_ARGS',

  // Type 3 — Tool-Arg Correctness
  SQL_MISSING_COUNT: 'SQL_MISSING_COUNT',
  SQL_EXECUTION_FAILED: 'SQL_EXECUTION_FAILED',
  COORDINATE_IMPRECISION: 'COORDINATE_IMPRECISION',

  // Type 5 — Golden Dataset Fidelity
  REQUIRED_TOOL_NOT_CALLED: 'REQUIRED_TOOL_NOT_CALLED',
  FRONTEND_ACK_FAILED: 'FRONTEND_ACK_FAILED',
  POOR_QUALITY: 'POOR_QUALITY',

  // Type 6 — Robustness
  HIGH_VARIANCE: 'HIGH_VARIANCE',
  LOW_MEAN: 'LOW_MEAN',
  UNSTABLE_TOOL_ROUTING: 'UNSTABLE_TOOL_ROUTING',
  OUTLIER_FAILURE: 'OUTLIER_FAILURE',

  // Type 7 — Grounding
  GROUND_TRUTH_UNAVAILABLE: 'GROUND_TRUTH_UNAVAILABLE',
  REFUSED_TO_QUERY: 'REFUSED_TO_QUERY',
  EMPTY_TOOL_RESPONSE: 'EMPTY_TOOL_RESPONSE',
  NO_NUMERIC_EXTRACTED: 'NO_NUMERIC_EXTRACTED',
  COUNT_OUTSIDE_TOLERANCE: 'COUNT_OUTSIDE_TOLERANCE',
  POOR_PRESENTATION: 'POOR_PRESENTATION',

  // Turn execution
  TURN_SKIPPED: 'TURN_SKIPPED',
  MOCK_NOT_MATCHED: 'MOCK_NOT_MATCHED',
  UNEXPECTED_TOOL: 'UNEXPECTED_TOOL',

  // Infrastructure
  INFRA_MISCONFIGURATION: 'INFRA_MISCONFIGURATION'
} as const

// ============================================================================
// Eval Turn Types
// ============================================================================

export const EVAL_TURN_TYPES = {
  BACKEND: 'backend',
  TOOL: 'tool',
  CONTINUATION: 'continuation',
  AGGREGATE: 'aggregate',
  SKIPPED: 'skipped'
} as const

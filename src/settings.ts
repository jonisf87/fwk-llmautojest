/**
 * Centralised configuration — all values read from process.env.
 *
 * Load environment variables before running tests:
 *   dotenv -e environments/local.env -- jest
 *
 * Required variables per provider (at least one agent provider needed):
 *   - OpenAI:    OPENAI_API_KEY
 *   - Anthropic: ANTHROPIC_API_KEY
 *   - Gemini:    GEMINI_API_KEY  (also used as judge by default)
 *
 * The judge always requires a Gemini or Anthropic key.
 */

// ============================================================================
// Provider API Keys
// ============================================================================

export const openaiApiKey = process.env.OPENAI_API_KEY ?? null
export const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? null
export const geminiApiKey = process.env.GEMINI_API_KEY ?? null

/** Base URL for OpenAI-compatible providers (e.g. ollama, LM Studio, Azure). */
export const openaiBaseUrl = process.env.OPENAI_BASE_URL ?? null

// ============================================================================
// Judge Configuration
// ============================================================================

/** Judge provider: 'gemini' (default) | 'anthropic' */
export const judgeProvider = (process.env.JUDGE_PROVIDER ?? 'gemini') as 'gemini' | 'anthropic'

/** Judge model. Defaults vary by provider. */
export const judgeModel = process.env.JUDGE_MODEL ?? null

// ============================================================================
// Model Configuration
// ============================================================================

export interface ModelTestConfig {
  /** Unique identifier for this model entry (used in transaction IDs). */
  id: string
  /** Provider group name (e.g. 'OPENAI', 'ANTHROPIC', 'GEMINI'). */
  provider: string
  /** Model identifier as accepted by the provider API. */
  model: string
}

/**
 * Models to test, grouped by provider.
 *
 * JSON format:
 * ```json
 * {
 *   "OPENAI": [{"id":"1","provider":"OPENAI","model":"gpt-4o-mini"}],
 *   "ANTHROPIC": [{"id":"2","provider":"ANTHROPIC","model":"claude-3-5-haiku-20241022"}],
 *   "GEMINI": [{"id":"3","provider":"GEMINI","model":"gemini-1.5-flash"}]
 * }
 * ```
 */
export const aiTestModels: Record<string, ModelTestConfig[]> = (() => {
  const raw = process.env.AI_TEST_MODELS
  if (!raw) {
    // Default: gpt-4o-mini — good balance of speed and quality for workshops
    return { OPENAI: [{ id: '1', provider: 'OPENAI', model: 'gpt-4o-mini' }] }
  }
  try {
    return JSON.parse(raw) as Record<string, ModelTestConfig[]>
  } catch {
    throw new Error('AI_TEST_MODELS must be valid JSON. See environments/example.env for examples.')
  }
})()

/**
 * Default model for oracle/ground-truth derivation.
 * Uses the first configured model.
 */
export const aiDefaultModel: string = (() => {
  const first = Object.values(aiTestModels).flat()[0]
  return first?.model ?? 'gpt-4o-mini'
})()

/**
 * Provider group(s) to include in Tier B golden-dataset scenarios.
 * 'all' = all groups; otherwise comma-separated group names.
 */
export const tierBProviderGroups = process.env.TIER_B_PROVIDER_GROUPS ?? 'OPENAI'

// ============================================================================
// Eval / Quality Thresholds
// ============================================================================

/** Minimum AI Judge score (0–10) for a semantic test to pass. */
export const aiSemanticPassThreshold = parseFloat(process.env.AI_SEMANTIC_PASS_THRESHOLD ?? '7')

export const aiPassThresholds = {
  /** Standard threshold. */
  standard: aiSemanticPassThreshold,
  /** Relaxed threshold for tests that are sensitive to data variation. */
  relaxed: parseFloat(process.env.AI_PASS_THRESHOLD_RELAXED ?? '6')
}

/** Grounding: max allowed relative error |extracted - truth| / truth. */
export const groundingPctErrorThreshold = parseFloat(
  process.env.GROUNDING_PCT_ERROR_THRESHOLD ?? '0.05'
)

// ============================================================================
// Eval Run Options
// ============================================================================

/**
 * Scenario scope:
 *   'full'   — all turns (default)
 *   'canary' — first turn only (fast smoke run)
 */
export const evalScenarioScope = (process.env.EVAL_SCENARIO_SCOPE ?? 'full') as 'full' | 'canary'

/** Label attached to CSV rows — useful for grouping runs in dashboards. */
export const evalRunLabel = process.env.EVAL_RUN_LABEL ?? null

/** Number of paraphrase variant repetitions for robustness tests. */
export const robustnessVariantRuns = parseInt(process.env.ROBUSTNESS_VARIANT_RUNS ?? '1', 10)

/**
 * When true, unexpected tool calls (not in expected.tools_called) are treated
 * as failures instead of informational warnings.
 */
export const evalStrictTools = process.env.EVAL_STRICT_TOOLS === 'true'

// ============================================================================
// CSV Export
// ============================================================================

/** Enable CSV export of eval results to reports/eval/. */
export const aiCsvExportEnabled = process.env.AI_CSV_EXPORT_ENABLED === 'true'

/** Directory for CSV output (relative to project root). */
export const aiCsvExportDir = process.env.AI_CSV_EXPORT_DIR ?? 'reports/eval'

// ============================================================================
// Debug
// ============================================================================

export const aiDebug = process.env.AI_DEBUG === 'true'

// ============================================================================
// Helpers for tests
// ============================================================================

/** Returns all models across all provider groups as a flat array. */
export function getModelsToTest(): ModelTestConfig[] {
  return Object.values(aiTestModels).flat()
}

/** Returns models for the configured Tier B provider groups. */
export function getTierBModels(): ModelTestConfig[] {
  const input = tierBProviderGroups.trim()
  if (input === 'all') {
    return Object.values(aiTestModels).flat()
  }
  return input
    .split(',')
    .map((g) => g.trim())
    .flatMap((group) => {
      const models = aiTestModels[group]
      if (!models) {
        throw new Error(
          `[getTierBModels] Unknown provider group: "${group}". ` +
          `Valid groups: ${Object.keys(aiTestModels).join(', ')}`
        )
      }
      return models
    })
}

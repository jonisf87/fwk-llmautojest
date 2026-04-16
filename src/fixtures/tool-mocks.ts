/**
 * Frontend tool mock definitions for golden-dataset scenarios.
 *
 * Mirrors the FrontendToolMock pattern from the original CARTO project.
 * Each mock defines: which tool to match, optional argument matching,
 * and the pre-built output to return as functionCallOutput.
 */

import { FunctionCallOutput, ToolCall } from '@support/types'

// ============================================================================
// Types
// ============================================================================

export interface FrontendToolMock {
  /** Tool name to match. */
  tool: string
  /**
   * Optional: match only calls where JSON.parse(arguments)[arg] === value.
   * If omitted, matches the first unconsumed call of that tool name.
   */
  matchOn?: { arg: string; value: unknown }
  /** Pre-built output to return as the tool's result. */
  output: unknown
}

// ============================================================================
// Mock Builder
// ============================================================================

/**
 * Match FrontendToolMock definitions against actual tool calls and
 * build the functionCallOutputs array.
 *
 * Returns: outputs (for the continuation call) and unmatched mock names.
 */
export function buildFunctionCallOutputs(
  toolCalls: ToolCall[],
  mocks: FrontendToolMock[]
): { outputs: FunctionCallOutput[]; unmatched: string[] } {
  const consumed = new Set<string>()
  const outputs: FunctionCallOutput[] = []
  const unmatched: string[] = []

  for (const mock of mocks) {
    const candidates = toolCalls.filter((t) => t.name === mock.tool && !consumed.has(t.id))

    let matched: ToolCall | undefined

    if (mock.matchOn) {
      const { arg, value } = mock.matchOn
      matched = candidates.find((t) => {
        try {
          const parsed = JSON.parse(t.arguments) as Record<string, unknown>
          return parsed[arg] === value
        } catch {
          return false
        }
      })
    } else {
      matched = candidates[0]
    }

    if (matched) {
      consumed.add(matched.id)
      outputs.push({
        type: 'function_call_output',
        call_id: matched.id,
        output: JSON.stringify(mock.output)
      })
    } else {
      unmatched.push(mock.tool)
    }
  }

  return { outputs, unmatched }
}

// ============================================================================
// Pre-built Frontend Tool Outputs
// ============================================================================

/** Isoline mock centred on London (used in knowledge-search Tier B scenario). */
export const LONDON_ISOLINE_OUTPUT = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-0.2278, 51.5574], [-0.0278, 51.5574], [-0.0278, 51.4574],
          [-0.2278, 51.4574], [-0.2278, 51.5574]
        ]]
      },
      properties: { travel_time_seconds: 900, mode: 'car', centre: { lat: 51.5074, lng: -0.1278 } }
    }
  ]
}

/** Visualization render acknowledgement (used in data-explorer Tier B scenario). */
export const BAR_CHART_RENDER_OUTPUT = {
  visualization_id: 'viz-001',
  status: 'rendered',
  chart_type: 'bar',
  message: 'Bar chart rendered successfully with 3 data points.'
}

/** Visualization render acknowledgement for top products chart. */
export const TOP_PRODUCTS_CHART_OUTPUT = {
  visualization_id: 'viz-002',
  status: 'rendered',
  chart_type: 'bar',
  message: 'Top products bar chart rendered successfully with 5 data points.'
}

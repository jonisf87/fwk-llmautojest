/**
 * Tool definitions for the agent under test.
 *
 * Tools are passed to the LLM via the standard function-calling API.
 * Each tool has a JSON Schema definition understood by all major providers.
 */

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

// ============================================================================
// Backend Tools (auto-executed against mock data)
// ============================================================================

/** Run a SQL query against the configured dataset. Returns rows as JSON. */
export const EXECUTE_QUERY_TOOL: ToolDefinition = {
  name: 'execute_query',
  description:
    'Execute a SQL query against the dataset and return the results as a JSON array of rows. ' +
    'Use standard SQL syntax. Aggregate functions (COUNT, SUM, AVG, etc.) are supported.',
  parameters: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'The SQL query to execute. Must be a valid SELECT statement.'
      }
    },
    required: ['sql']
  }
}

/** Search documents in the knowledge base by natural language query. */
export const SEARCH_DOCUMENTS_TOOL: ToolDefinition = {
  name: 'search_documents',
  description:
    'Search the knowledge base for documents relevant to a query. ' +
    'Returns the top matching documents with titles, snippets, and relevance scores.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query.'
      },
      top_k: {
        type: 'integer',
        description: 'Maximum number of results to return (default: 5).',
        default: 5
      }
    },
    required: ['query']
  }
}

/** Get the exact record count for a named dataset. */
export const GET_RECORD_COUNT_TOOL: ToolDefinition = {
  name: 'get_record_count',
  description:
    'Return the exact number of records in a named dataset. ' +
    'Use this when the user asks "how many records/rows/entries" are in a dataset.',
  parameters: {
    type: 'object',
    properties: {
      dataset_name: {
        type: 'string',
        description: 'Name of the dataset. Supported values: "sales", "employees", "knowledge_base".'
      }
    },
    required: ['dataset_name']
  }
}

// ============================================================================
// Frontend Tools (require caller-provided outputs via functionCallOutputs)
// ============================================================================

/**
 * Generate a travel-time isoline polygon centred at lat/lng.
 * This is a "frontend" tool — the test provides a mock polygon response.
 */
export const CREATE_ISOLINE_TOOL: ToolDefinition = {
  name: 'create_isoline',
  description:
    'Generate a travel-time isoline (reachability polygon) centred at the given coordinates. ' +
    'Returns a GeoJSON polygon representing the area reachable within the specified travel time.',
  parameters: {
    type: 'object',
    properties: {
      lat: {
        type: 'number',
        description: 'Latitude of the centre point (decimal degrees, WGS84).'
      },
      lng: {
        type: 'number',
        description: 'Longitude of the centre point (decimal degrees, WGS84).'
      },
      travel_time_seconds: {
        type: 'integer',
        description: 'Travel time budget in seconds (e.g. 900 = 15 minutes).'
      },
      mode: {
        type: 'string',
        enum: ['car', 'walk', 'bike', 'transit'],
        description: 'Travel mode.',
        default: 'car'
      }
    },
    required: ['lat', 'lng', 'travel_time_seconds']
  }
}

/** Render a chart or visualisation from data. Frontend tool. */
export const RENDER_VISUALIZATION_TOOL: ToolDefinition = {
  name: 'render_visualization',
  description:
    'Render a chart or data visualisation and display it to the user. ' +
    'Supported types: bar, line, pie, scatter, table.',
  parameters: {
    type: 'object',
    properties: {
      chart_type: {
        type: 'string',
        enum: ['bar', 'line', 'pie', 'scatter', 'table'],
        description: 'Type of visualisation to render.'
      },
      title: {
        type: 'string',
        description: 'Chart title.'
      },
      data: {
        type: 'object',
        description: 'Data to visualise. Structure depends on chart_type.'
      }
    },
    required: ['chart_type', 'data']
  }
}

// ============================================================================
// Tool Registry
// ============================================================================

/** All available tools by name. */
export const ALL_TOOLS: Record<string, ToolDefinition> = {
  execute_query: EXECUTE_QUERY_TOOL,
  search_documents: SEARCH_DOCUMENTS_TOOL,
  get_record_count: GET_RECORD_COUNT_TOOL,
  create_isoline: CREATE_ISOLINE_TOOL,
  render_visualization: RENDER_VISUALIZATION_TOOL
}

/** Tool names that require the caller to provide outputs (frontend tools). */
export const FRONTEND_TOOLS = new Set(['create_isoline', 'render_visualization'])

/** Filter tool definitions by name list. */
export function selectTools(names: string[]): ToolDefinition[] {
  return names.map((n) => {
    const tool = ALL_TOOLS[n]
    if (!tool) throw new Error(`Unknown tool: "${n}"`)
    return tool
  })
}

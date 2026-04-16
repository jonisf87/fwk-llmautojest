/**
 * CSV Exporter for eval/perf test results.
 *
 * Writes one CSV file per test-id to the configured output directory.
 * Each row captures a single evaluation turn with full metadata.
 */

import * as fs from 'fs'
import * as path from 'path'
import { TokenUsage, CSVExportRow } from './types'

// ============================================================================
// Column Schema
// ============================================================================

const CSV_HEADERS: (keyof CSVExportRow)[] = [
  'test_id',
  'transaction_id',
  'model',
  'provider',
  'question',
  'type',
  'score',
  'score_explanation',
  'tokens',
  'latency_ms',
  'scenario_id',
  'turn_number',
  'turn_type',
  'tool_success_rate',
  'run_label',
  'expected_value',
  'received_value',
  'ground_truth_value',
  'extracted_value',
  'pct_error',
  'api_response',
  'judge_response'
]

// ============================================================================
// Sanitisation
// ============================================================================

function sanitize(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// ============================================================================
// File Utilities
// ============================================================================

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function generateFilename(testId?: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
  return testId ? `${ts}_${testId}.csv` : `${ts}.csv`
}

// ============================================================================
// CSVExporter
// ============================================================================

export class CSVExporter {
  private filePath: string
  private rowCount = 0

  constructor(testId?: string, outputDir?: string) {
    const dir = outputDir ?? path.join(__dirname, '..', '..', 'reports', 'eval')
    ensureDir(dir)
    this.filePath = path.join(dir, generateFilename(testId))
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, CSV_HEADERS.join(',') + '\n')
    }
  }

  addRow(row: CSVExportRow): void {
    const values = CSV_HEADERS.map((col) => sanitize(row[col] as string | number | undefined))
    fs.appendFileSync(this.filePath, values.join(',') + '\n')
    this.rowCount++
  }

  /**
   * High-level helper that constructs and writes a row from individual params.
   * Unknown extra properties are silently ignored.
   */
  addEvaluationResult(params: {
    testId: string
    transactionId: string
    model?: string
    provider?: string
    question: string
    type: string
    expectedValue: unknown
    receivedValue: unknown
    score: number
    scoreExplanation: string
    tokenUsage?: TokenUsage
    latencyMs?: number
    scenarioId?: string
    turnNumber?: number
    turnType?: string
    toolSuccessRate?: number
    runLabel?: string
    groundTruthValue?: number
    extractedValue?: number
    pctError?: number
    apiResponse?: string
    judgeResponse?: string
  }): void {
    this.addRow({
      test_id: params.testId,
      transaction_id: params.transactionId,
      model: params.model,
      provider: params.provider,
      question: params.question,
      type: params.type,
      score: params.score,
      score_explanation: params.scoreExplanation,
      tokens: params.tokenUsage?.total_tokens ?? 0,
      latency_ms: params.latencyMs,
      scenario_id: params.scenarioId,
      turn_number: params.turnNumber,
      turn_type: params.turnType,
      tool_success_rate: params.toolSuccessRate,
      run_label: params.runLabel,
      expected_value: typeof params.expectedValue === 'string' ? params.expectedValue : JSON.stringify(params.expectedValue),
      received_value: typeof params.receivedValue === 'string' ? params.receivedValue : JSON.stringify(params.receivedValue),
      ground_truth_value: params.groundTruthValue,
      extracted_value: params.extractedValue,
      pct_error: params.pctError,
      api_response: params.apiResponse,
      judge_response: params.judgeResponse
    })
  }

  getFilePath(): string { return this.filePath }
  getRowCount(): number { return this.rowCount }
}

// ============================================================================
// Registry (one exporter per test-id)
// ============================================================================

class CSVExporterRegistry {
  private exporters = new Map<string, CSVExporter>()

  getExporter(testId: string, outputDir?: string): CSVExporter {
    if (!this.exporters.has(testId)) {
      this.exporters.set(testId, new CSVExporter(testId, outputDir))
    }
    return this.exporters.get(testId)!
  }
}

const globalRegistry = new CSVExporterRegistry()

export function getCSVExporter(testId: string, outputDir?: string): CSVExporter {
  return globalRegistry.getExporter(testId, outputDir)
}

/**
 * AI test assertion helpers.
 *
 * Provides rich error context for debugging evaluation failures.
 */

interface ScoreContext {
  testId: string
  explanation: string
  question?: string
}

/**
 * Assert AI Judge score meets threshold.
 * Throws with full context (testId, score, threshold, explanation, question) on failure.
 */
export function expectScoreGte(score: number, threshold: number, context: ScoreContext): void {
  if (score < threshold) {
    const lines = [
      `[${context.testId}] Score ${score} below threshold ${threshold}`,
      `Explanation: ${context.explanation}`
    ]
    if (context.question) {
      lines.push(`Question: ${context.question}`)
    }
    throw new Error(lines.join('\n'))
  }
}

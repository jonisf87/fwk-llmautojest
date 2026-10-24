import { RETRY_CONSTANTS, calculateRetryDelay, sampleStddev, withRetry } from '@support/helpers'
import { expectScoreGte } from '@support/assertions'

describe('calculateRetryDelay', () => {
  it('grows exponentially within jitter bounds and is capped', () => {
    const j = RETRY_CONSTANTS.JITTER_FACTOR
    for (const [attempt, base] of [[1, 1000], [2, 2000], [3, 4000], [10, RETRY_CONSTANTS.MAX_BACKOFF_MS]]) {
      const d = calculateRetryDelay(attempt)
      expect(d).toBeGreaterThanOrEqual(Math.floor(base * (1 - j)))
      expect(d).toBeLessThanOrEqual(Math.ceil(base * (1 + j)))
    }
  })
})

describe('withRetry', () => {
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn()
      return 0
    }) as never)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('returns the result after transient failures', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok')
    await expect(withRetry(fn, () => true, (e) => e)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-retryable errors and wraps the final error', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fatal'))
    await expect(withRetry(fn, () => false, (e) => new Error(`wrapped: ${e.message}`))).rejects.toThrow('wrapped: fatal')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives up after MAX_ATTEMPTS', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('again'))
    await expect(withRetry(fn, () => true, (e) => e)).rejects.toThrow('again')
    expect(fn).toHaveBeenCalledTimes(RETRY_CONSTANTS.MAX_ATTEMPTS)
  })
})

describe('sampleStddev', () => {
  it('returns 0 for fewer than two values', () => {
    expect(sampleStddev([])).toBe(0)
    expect(sampleStddev([5])).toBe(0)
  })

  it('uses the N-1 denominator', () => {
    expect(sampleStddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3)
  })
})

describe('expectScoreGte', () => {
  it('passes at or above the threshold', () => {
    expect(() => expectScoreGte(7, 7, { testId: 't', explanation: 'e' })).not.toThrow()
  })

  it('throws with full context below the threshold', () => {
    expect(() => expectScoreGte(3, 7, { testId: 'T1', explanation: 'bad', question: 'why?' })).toThrow(
      /\[T1\] Score 3 below threshold 7\nExplanation: bad\nQuestion: why\?/
    )
  })
})

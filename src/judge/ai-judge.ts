/**
 * AI Judge — evaluates LLM responses semantically using a second LLM.
 *
 * Supported judge providers:
 *   - Gemini (default): uses @google/generative-ai with structured JSON output.
 *   - Anthropic: uses @anthropic-ai/sdk with JSON mode.
 *
 * The judge is configured via JUDGE_PROVIDER and JUDGE_MODEL env vars.
 * Neither requires cloud-platform auth — only an API key.
 */

import * as fs from 'fs'
import * as path from 'path'
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'

import { AiJudgeResult, TokenUsage } from '@support/types'
import * as settings from '@settings'

// ============================================================================
// Prompt Template
// ============================================================================

const PROMPT_TEMPLATE = fs.readFileSync(path.join(__dirname, 'ai-judge-prompt.md'), 'utf8')

// ============================================================================
// Focused Rubric for Count/Grounding Queries (Types 3, 7)
// ============================================================================

export const COUNT_QUERY_JUDGE_CRITERIA = `### 1. Accuracy

- Is the numeric count stated correctly?
- Does the stated value match the query result in the tool output?
- No hallucinated or estimated values without evidence from the tool output

### 2. Completeness

- Does the response clearly state the count?
- Is the answer direct and unambiguous?

### 3. Relevance

- Does the response directly answer the count question?
- Is the query result referenced as the source of the stated number?`

// ============================================================================
// Judge Factory
// ============================================================================

type JudgeFn = (
  received: string,
  expected: string,
  question: string,
  context?: string,
  criteria?: string
) => Promise<AiJudgeResult>

export class AIJudgeFactory {
  /**
   * Create the judge function from environment configuration.
   * Reads JUDGE_PROVIDER and GEMINI_API_KEY / ANTHROPIC_API_KEY.
   */
  static createFromEnv(): JudgeFn {
    const provider = settings.judgeProvider

    if (provider === 'anthropic') {
      if (!settings.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY required when JUDGE_PROVIDER=anthropic')
      }
      return createAnthropicJudge(settings.anthropicApiKey, settings.judgeModel ?? 'claude-3-5-haiku-20241022')
    }

    // Default: Gemini
    if (!settings.geminiApiKey) {
      throw new Error('GEMINI_API_KEY required when JUDGE_PROVIDER=gemini (default). Set JUDGE_PROVIDER=anthropic to use Anthropic instead.')
    }
    return createGeminiJudge(settings.geminiApiKey, settings.judgeModel ?? 'gemini-1.5-flash')
  }
}

// ============================================================================
// Gemini Judge
// ============================================================================

function buildPrompt(
  received: string,
  expected: string,
  question: string,
  context?: string,
  criteria?: string
): string {
  return PROMPT_TEMPLATE
    .replace('{{context}}', context ?? '(no prior context)')
    .replace('{{question}}', question)
    .replace('{{expected}}', expected)
    .replace('{{received}}', received)
    .replace(/### 1\. Accuracy[\s\S]*### 5\. Language Quality[\s\S]*?(?=\n---)/,
      criteria ?? PROMPT_TEMPLATE.match(/### 1\. Accuracy[\s\S]*### 5\. Language Quality[^\n]*/)?.[0] ?? '')
}

function createGeminiJudge(apiKey: string, model: string): JudgeFn {
  const genAI = new GoogleGenerativeAI(apiKey)

  const judgeModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          score: { type: SchemaType.NUMBER },
          explanation: { type: SchemaType.STRING }
        },
        required: ['score', 'explanation']
      }
    }
  })

  return async (received, expected, question, context?, criteria?) => {
    const prompt = buildPrompt(received, expected, question, context, criteria)
    const result = await judgeModel.generateContent(prompt)
    const raw = result.response.text()

    const parsed = JSON.parse(raw) as { score: number; explanation: string }
    const score = Math.max(0, Math.min(10, Number(parsed.score)))

    const promptTokens = result.response.usageMetadata?.promptTokenCount ?? 0
    const completionTokens = result.response.usageMetadata?.candidatesTokenCount ?? 0

    const tokenUsage: TokenUsage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    }

    return { score, explanation: parsed.explanation, tokenUsage, rawResponse: raw }
  }
}

// ============================================================================
// Anthropic Judge
// ============================================================================

function createAnthropicJudge(apiKey: string, model: string): JudgeFn {
  const client = new Anthropic({ apiKey })

  return async (received, expected, question, context?, criteria?) => {
    const prompt = buildPrompt(received, expected, question, context, criteria)

    const response = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a scoring judge. Always respond with valid JSON only: {"score": <0-10>, "explanation": "<string>"}'
    })

    const raw = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleaned) as { score: number; explanation: string }
    const score = Math.max(0, Math.min(10, Number(parsed.score)))

    const tokenUsage: TokenUsage = {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens
    }

    return { score, explanation: parsed.explanation, tokenUsage, rawResponse: raw }
  }
}

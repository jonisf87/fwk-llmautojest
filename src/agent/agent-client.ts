/**
 * AgentClient — provider-agnostic LLM client.
 *
 * Supports OpenAI, Anthropic, and Google Gemini. All three are normalised
 * to the same AgentResponse interface so tests stay provider-agnostic.
 *
 * Key behaviours:
 * - Multi-turn via in-process conversation history (keyed by responseId UUID).
 * - Backend tools auto-executed against AgentSession.mockExecutor.
 * - Frontend tools return to the caller; caller provides functionCallOutputs
 *   in a continuation call.
 * - Exponential-backoff retry on transient errors.
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI, FunctionCallingMode, SchemaType } from '@google/generative-ai'
import { randomUUID } from 'crypto'

import { AgentSession } from './agent-session'
import { ToolDefinition } from './agent-tools'
import { AgentResponse, FunctionCallOutput, SendOptions, ToolCall, ToolResponse, TokenUsage, AgentError } from '@support/types'
import { withRetry, RETRY_CONSTANTS } from '@support/helpers'
import * as settings from '@settings'

// ============================================================================
// Internal Types
// ============================================================================

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  /** Present on assistant messages that call tools (OpenAI format). */
  tool_calls?: OpenAI.ChatCompletionMessageToolCall[]
  /** Present on tool result messages. */
  tool_call_id?: string
  name?: string
}

// ============================================================================
// AgentClient
// ============================================================================

export class AgentClient {
  private readonly session: AgentSession
  /** Conversation history keyed by responseId. */
  private readonly conversations = new Map<string, ConversationMessage[]>()

  constructor(session: AgentSession) {
    this.session = session
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Send a message and return the agent's response.
   *
   * If `options.functionCallOutputs` is set, the message is a continuation
   * of a previous turn where the caller resolved frontend tool calls.
   *
   * If `options.previousResponseId` is set, the conversation history from
   * that response is used as context.
   */
  async send(text: string, options: SendOptions = {}): Promise<AgentResponse> {
    const makeRequest = async () => this._send(text, options)

    if (options.enableRetry !== false) {
      return withRetry(
        makeRequest,
        (err) => this._isRetryable(err),
        (err) => new AgentError(`Failed after ${RETRY_CONSTANTS.MAX_ATTEMPTS} attempts: ${err.message}`)
      )
    }
    return makeRequest()
  }

  // -------------------------------------------------------------------------
  // Core Send Implementation
  // -------------------------------------------------------------------------

  private async _send(text: string, options: SendOptions): Promise<AgentResponse> {
    const provider = this._inferProvider(options.model ?? this.session.defaultModel ?? settings.aiDefaultModel)
    const model = options.model ?? this.session.defaultModel ?? settings.aiDefaultModel

    // Build initial messages from history + new input
    const messages = this._buildMessages(text, options)

    // Decide which tools to expose
    const toolsToUse = options.allowedTools
      ? this.session.tools.filter((t) => options.allowedTools!.includes(t.name))
      : this.session.tools

    // Agentic tool-calling loop
    const allToolCalls: ToolCall[] = []
    const allToolResponses: ToolResponse[] = []
    let finalText = ''
    let usage: TokenUsage | undefined

    let currentMessages = [...messages]

    for (let iteration = 0; iteration < 10; iteration++) {
      const raw = await this._callProvider(provider, model, currentMessages, toolsToUse, options)
      finalText = raw.text
      usage = raw.usage

      if (!raw.toolCalls?.length) {
        // No more tool calls — final response received
        currentMessages.push({ role: 'assistant', content: finalText })
        break
      }

      // Record tool calls
      allToolCalls.push(...raw.toolCalls)

      // Build the assistant message WITH tool_calls (OpenAI format)
      const assistantMsg: ConversationMessage = {
        role: 'assistant',
        content: raw.text || null,
        tool_calls: raw.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments }
        }))
      }
      currentMessages.push(assistantMsg)

      // Determine which tool calls to execute vs return to caller
      const pendingFrontend: ToolCall[] = []
      const toExecute: ToolCall[] = []

      for (const tc of raw.toolCalls) {
        if (this.session.isFrontendTool(tc.name)) {
          pendingFrontend.push(tc)
        } else {
          toExecute.push(tc)
        }
      }

      // Execute backend tools and add results
      for (const tc of toExecute) {
        let resultStr: string
        try {
          const args = JSON.parse(tc.arguments) as Record<string, unknown>
          resultStr = this.session.executeTool(tc.name, args)
        } catch (err) {
          resultStr = JSON.stringify({ error: String(err) })
        }
        allToolResponses.push({ tool_call_id: tc.id, response: resultStr })
        currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr })
      }

      // If frontend tools are pending AND no functionCallOutputs provided → stop loop
      if (pendingFrontend.length > 0) {
        // Caller must provide functionCallOutputs in a continuation call
        finalText = ''
        break
      }
    }

    // Store updated history
    const responseId = randomUUID()
    this.conversations.set(responseId, currentMessages)

    return this._buildResponse(responseId, finalText, allToolCalls, allToolResponses, usage)
  }

  // -------------------------------------------------------------------------
  // Message Builder
  // -------------------------------------------------------------------------

  private _buildMessages(text: string, options: SendOptions): ConversationMessage[] {
    let messages: ConversationMessage[] = []

    if (options.previousResponseId) {
      const history = this.conversations.get(options.previousResponseId)
      if (history) {
        messages = [...history]
      } else {
        // Unknown responseId — start fresh with system prompt
        messages = [{ role: 'system', content: this.session.systemPrompt }]
      }
    } else {
      messages = [{ role: 'system', content: this.session.systemPrompt }]
    }

    // Add functionCallOutputs as tool messages (continuation turn)
    if (options.functionCallOutputs?.length) {
      for (const fco of options.functionCallOutputs) {
        messages.push({ role: 'tool', tool_call_id: fco.call_id, content: fco.output })
      }
    }

    // Add user message (may be empty in pure continuation turns)
    if (text) {
      messages.push({ role: 'user', content: text })
    }

    return messages
  }

  // -------------------------------------------------------------------------
  // Provider Router
  // -------------------------------------------------------------------------

  private _inferProvider(model: string): 'openai' | 'anthropic' | 'gemini' {
    // Check API keys to infer provider from model name as fallback
    if (model.startsWith('claude-')) return 'anthropic'
    if (model.startsWith('gemini-')) return 'gemini'
    return 'openai'
  }

  private async _callProvider(
    provider: 'openai' | 'anthropic' | 'gemini',
    model: string,
    messages: ConversationMessage[],
    tools: ToolDefinition[],
    options: SendOptions
  ): Promise<{ text: string; toolCalls?: ToolCall[]; usage?: TokenUsage }> {
    switch (provider) {
      case 'openai':
        return this._callOpenAI(model, messages, tools, options)
      case 'anthropic':
        return this._callAnthropic(model, messages, tools, options)
      case 'gemini':
        return this._callGemini(model, messages, tools, options)
    }
  }

  // -------------------------------------------------------------------------
  // OpenAI Provider
  // -------------------------------------------------------------------------

  private async _callOpenAI(
    model: string,
    messages: ConversationMessage[],
    tools: ToolDefinition[],
    options: SendOptions
  ): Promise<{ text: string; toolCalls?: ToolCall[]; usage?: TokenUsage }> {
    if (!settings.openaiApiKey) throw new AgentError('OPENAI_API_KEY not set')

    const client = new OpenAI({
      apiKey: settings.openaiApiKey,
      ...(settings.openaiBaseUrl ? { baseURL: settings.openaiBaseUrl } : {})
    })

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      ...(tools.length > 0 ? { tools: tools.map(toOpenAITool) } : {}),
      ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {})
    }

    const response = await client.chat.completions.create(params)
    const choice = response.choices[0]
    const msg = choice.message

    return {
      text: msg.content ?? '',
      toolCalls: msg.tool_calls?.map(toToolCall),
      usage: response.usage ? {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens
      } : undefined
    }
  }

  // -------------------------------------------------------------------------
  // Anthropic Provider
  // -------------------------------------------------------------------------

  private async _callAnthropic(
    model: string,
    messages: ConversationMessage[],
    tools: ToolDefinition[],
    options: SendOptions
  ): Promise<{ text: string; toolCalls?: ToolCall[]; usage?: TokenUsage }> {
    if (!settings.anthropicApiKey) throw new AgentError('ANTHROPIC_API_KEY not set')

    const client = new Anthropic({ apiKey: settings.anthropicApiKey })

    // Extract system message (Anthropic takes it separately)
    const systemMsg = messages.find((m) => m.role === 'system')?.content ?? ''
    const history = messages.filter((m) => m.role !== 'system')

    // Convert to Anthropic message format
    const anthropicMessages: Anthropic.MessageParam[] = []

    for (const m of history) {
      if (m.role === 'user') {
        anthropicMessages.push({ role: 'user', content: m.content ?? '' })
      } else if (m.role === 'assistant') {
        if (m.tool_calls?.length) {
          const content: Anthropic.Messages.ContentBlockParam[] = []
          if (m.content) content.push({ type: 'text', text: m.content })
          for (const tc of m.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments) as Record<string, unknown>
            })
          }
          anthropicMessages.push({ role: 'assistant', content })
        } else {
          anthropicMessages.push({ role: 'assistant', content: m.content ?? '' })
        }
      } else if (m.role === 'tool') {
        // Tool results go as user messages with tool_result content
        const last = anthropicMessages[anthropicMessages.length - 1]
        if (last?.role === 'user' && Array.isArray(last.content)) {
          (last.content as Anthropic.ToolResultBlockParam[]).push({
            type: 'tool_result',
            tool_use_id: m.tool_call_id!,
            content: m.content ?? ''
          })
        } else {
          anthropicMessages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: m.tool_call_id!,
              content: m.content ?? ''
            }]
          })
        }
      }
    }

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemMsg,
      messages: anthropicMessages,
      ...(tools.length > 0 ? { tools: tools.map(toAnthropicTool) } : {}),
      ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {})
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const toolCalls: ToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => {
        const tb = b
        return { id: tb.id, name: tb.name, arguments: JSON.stringify(tb.input) }
      })

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens
      }
    }
  }

  // -------------------------------------------------------------------------
  // Google Gemini Provider
  // -------------------------------------------------------------------------

  private async _callGemini(
    model: string,
    messages: ConversationMessage[],
    tools: ToolDefinition[],
    options: SendOptions
  ): Promise<{ text: string; toolCalls?: ToolCall[]; usage?: TokenUsage }> {
    if (!settings.geminiApiKey) throw new AgentError('GEMINI_API_KEY not set')

    const genAI = new GoogleGenerativeAI(settings.geminiApiKey)

    const systemMsg = messages.find((m) => m.role === 'system')?.content ?? ''
    const history = messages.filter((m) => m.role !== 'system')

    // Convert history to Gemini Content format
    // Gemini doesn't have a 'tool' role — tool results go as 'user' with functionResponse
    const geminiHistory: { role: 'user' | 'model'; parts: unknown[] }[] = []

    for (const m of history) {
      if (m.role === 'user') {
        geminiHistory.push({ role: 'user', parts: [{ text: m.content ?? '' }] })
      } else if (m.role === 'assistant') {
        const parts: unknown[] = []
        if (m.content) parts.push({ text: m.content })
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) {
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments)
              }
            })
          }
        }
        geminiHistory.push({ role: 'model', parts })
      } else if (m.role === 'tool') {
        // Find the tool call this response belongs to and get its name
        const toolCallId = m.tool_call_id!
        let fnName = 'unknown_function'
        for (let i = geminiHistory.length - 1; i >= 0; i--) {
          const entry = geminiHistory[i]
          if (entry.role === 'model') {
            for (const part of entry.parts as Array<{ functionCall?: { name: string } }>) {
              if (part.functionCall) {
                fnName = part.functionCall.name
                break
              }
            }
            break
          }
        }

        // Find name from tool_call_id by searching assistant messages
        for (const msg of history) {
          if (msg.role === 'assistant' && msg.tool_calls) {
            const tc = msg.tool_calls.find((t) => t.id === toolCallId)
            if (tc) {
              fnName = tc.function.name
              break
            }
          }
        }

        let responseData: unknown
        try {
          responseData = JSON.parse(m.content ?? '{}')
        } catch {
          responseData = { result: m.content }
        }

        geminiHistory.push({
          role: 'user',
          parts: [{ functionResponse: { name: fnName, response: { content: responseData } } }]
        })
      }
    }

    const geminiModel = genAI.getGenerativeModel({
      model,
      systemInstruction: systemMsg,
      ...(tools.length > 0 ? {
        tools: [{ functionDeclarations: tools.map(toGeminiFunctionDeclaration) }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }
      } : {}),
      generationConfig: {
        ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {})
      }
    })

    // Separate last user message for sendMessage vs history
    const lastMsg = geminiHistory.pop()
    const chat = geminiModel.startChat({ history: geminiHistory as never[] })

    const userParts = lastMsg?.parts ?? [{ text: '' }]
    const result = await chat.sendMessage(userParts as never[])
    const candidate = result.response.candidates?.[0]

    const text = candidate?.content.parts
      .filter((p) => 'text' in p)
      .map((p) => (p as { text: string }).text)
      .join('') ?? ''

    const toolCalls: ToolCall[] = (candidate?.content.parts ?? [])
      .filter((p) => 'functionCall' in p)
      .map((p) => {
        const fc = (p as { functionCall: { name: string; args: unknown } }).functionCall
        return {
          id: randomUUID(), // Gemini doesn't provide tool call IDs
          name: fc.name,
          arguments: JSON.stringify(fc.args)
        }
      })

    const promptTokens = result.response.usageMetadata?.promptTokenCount ?? 0
    const completionTokens = result.response.usageMetadata?.candidatesTokenCount ?? 0

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    }
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  private _buildResponse(
    responseId: string,
    text: string,
    toolCalls: ToolCall[],
    toolResponses: ToolResponse[],
    usage?: TokenUsage
  ): AgentResponse {
    const parseResult = {
      text,
      toolCalls,
      toolResponses,
      done: true,
      usage,
      responseId
    }
    return { responseId, text, toolCalls, toolResponses, usage, parseResult }
  }

  private _isRetryable(err: unknown): boolean {
    if (err instanceof AgentError && err.statusCode) {
      return RETRY_CONSTANTS.RETRYABLE_STATUS_CODES.includes(err.statusCode)
    }
    const msg = err instanceof Error ? err.message.toLowerCase() : ''
    return msg.includes('timeout') || msg.includes('rate limit') || msg.includes('overloaded')
  }
}

// ============================================================================
// Provider Format Converters
// ============================================================================

function toOpenAITool(td: ToolDefinition): OpenAI.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: td.name,
      description: td.description,
      parameters: td.parameters
    }
  }
}

function toToolCall(tc: OpenAI.ChatCompletionMessageToolCall): ToolCall {
  return {
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments
  }
}

function toAnthropicTool(td: ToolDefinition): Anthropic.Messages.Tool {
  return {
    name: td.name,
    description: td.description,
    input_schema: td.parameters as Anthropic.Messages.Tool['input_schema']
  }
}

function toGeminiFunctionDeclaration(td: ToolDefinition) {
  return {
    name: td.name,
    description: td.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: td.parameters.properties as Record<string, { type: SchemaType; description?: string }>,
      required: td.parameters.required
    }
  }
}

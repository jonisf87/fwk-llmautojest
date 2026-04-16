/**
 * Model Health — Structural Tests @smoke-ai
 *
 * Verifies that each configured model is reachable and returns a non-empty
 * text response to a simple greeting. No semantic evaluation.
 *
 * CI gate: YES — hard failure if a model is unreachable.
 */

import { AgentClient } from '@agent/agent-client'
import { AgentSession } from '@agent/agent-session'
import { getModelsToTest } from '@settings'

describe('Structural Tests', () => {
  describe('Model Health @smoke-ai', () => {
    const session = new AgentSession({
      id: 'health-check',
      systemPrompt: 'You are a helpful assistant.',
      toolNames: [],
      mockExecutor: () => ({})
    })

    const modelsToTest = getModelsToTest()

    modelsToTest.forEach(({ id, provider, model }) => {
      it(`[${provider}] ${model} — should respond to a greeting`, async () => {
        const client = new AgentClient(session)

        const response = await client.send('Hello', { model, enableRetry: true })

        expect(response.text).toBeTruthy()
        expect(response.text.length).toBeGreaterThan(0)
        expect(response.responseId).toBeTruthy()

        if (process.env.AI_DEBUG === 'true') {
          console.log(`[health] ${provider}/${model} (id=${id}) responded: "${response.text.substring(0, 80)}…"`)
        }
      })
    })
  })
})

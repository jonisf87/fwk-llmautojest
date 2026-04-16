# fmw-llmmautojest

**LLM-as-a-Judge integration testing framework with Jest.**

Provider-agnostic, runs anywhere with a single API key. No cloud platform auth, no proprietary services, no external databases. Mock tools included — everything self-contained.

Built as a reference implementation for workshops and technical interviews demonstrating production-quality LLM evaluation patterns.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure (copy example, add your API key)
cp environments/example.env environments/local.env
# Edit local.env — set at least OPENAI_API_KEY + GEMINI_API_KEY (or ANTHROPIC_API_KEY for judge)

# 3. Run CI-gated smoke tests (structural + semantic)
npm run test:ci

# 4. Run all tests
npm test

# 5. Run eval/perf tests with CSV export
AI_CSV_EXPORT_ENABLED=true EVAL_RUN_LABEL=my-run npm run test:eval
```

---

## Architecture

```
User question
      │
      ▼
  AgentClient                   ← provider-agnostic wrapper
      │  uses
      ├── OpenAI SDK             → OPENAI_API_KEY
      ├── @anthropic-ai/sdk      → ANTHROPIC_API_KEY
      └── @google/generative-ai  → GEMINI_API_KEY
      │
      ▼
  AgentSession                  ← system prompt + tools + mock executor
      │
      ├── backend tools          → auto-executed against mock data
      └── frontend tools         → returned to caller for functionCallOutputs
      │
      ▼
  AgentResponse                 ← {text, toolCalls, toolResponses, responseId}
      │
      ▼
  AI Judge (evaluator.ts)        ← Gemini or Anthropic, structured JSON output
      │
      ▼
  Score + Explanation + CSV row
```

**Key design decisions:**

| Pattern | Implementation |
|---|---|
| Provider-agnostic agent | Direct LLM API calls via SDK |
| Auth | API keys in `.env` |
| Data layer | Mock JSON data (`fixtures/tool-data.ts`) |
| Agent config | `AgentSession` (system prompt + tools) |
| AI Judge | `@google/generative-ai` API key |
| Secrets | `.env` file |

---

## Test Inventory

### Structural (`src/tests/structural/`)

| File | Tag | CI Gate | Description |
|---|---|---|---|
| `model-health.test.ts` | `@smoke-ai` | YES | Model liveness — each model responds to "Hello" |

### Semantic (`src/tests/semantic/`)

| File | Tag | CI Gate | Description |
|---|---|---|---|
| `prompt-template.test.ts` | `@smoke-ai` | YES | System prompt followed (language, scope) |
| `branching-conversations.test.ts` | `@smoke-ai` | YES | Independent branches from shared parent |
| `tools.test.ts` | `@smoke-ai` | YES | Backend tool called + frontend tool continuation |

### Eval / Perf (`src/tests/eval/`)

| File | Tag | CI Gate | Type | Description |
|---|---|---|---|---|
| `tool-arg-correctness.test.ts` | `@ai-eval` | NO | 3 | SQL has COUNT; coordinates within ±0.1° |
| `golden-datasets.test.ts` | `@ai-eval` | NO | 5 | Multi-turn scenario fidelity (Tier A + B) |
| `robustness.test.ts` | `@ai-eval` | NO | 6 | Paraphrase invariance across 4 variants |
| `grounding.test.ts` | `@ai-eval` | NO | 7 | Factual count accuracy; AI Judge framing check |
| `context-coherence.test.ts` | `@ai-eval` | NO | 4 | 4-turn coherence with entity carry-forward |

See [`src/tests/eval/README.md`](src/tests/eval/README.md) for detailed test type descriptions.

---

## Provider Configuration

Set `AI_TEST_MODELS` as a JSON string in your `.env`:

```bash
# Single model (fastest for smoke testing)
AI_TEST_MODELS={"OPENAI":[{"id":"1","provider":"OPENAI","model":"gpt-4o-mini"}]}

# Multi-provider
AI_TEST_MODELS={"OPENAI":[{"id":"1","provider":"OPENAI","model":"gpt-4o-mini"}],"ANTHROPIC":[{"id":"2","provider":"ANTHROPIC","model":"claude-3-5-haiku-20241022"}],"GEMINI":[{"id":"3","provider":"GEMINI","model":"gemini-1.5-flash"}]}
```

**Supported providers:**

| Provider | Key | Notes |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | Also works with any OpenAI-compatible API via `OPENAI_BASE_URL` |
| Anthropic | `ANTHROPIC_API_KEY` | Uses native Anthropic SDK |
| Google Gemini | `GEMINI_API_KEY` | Uses `@google/generative-ai` |
| Ollama / LM Studio | `OPENAI_BASE_URL=http://localhost:11434/v1` | OpenAI-compatible mode |

**Judge provider** (for semantic/eval tests):

```bash
JUDGE_PROVIDER=gemini    # default — requires GEMINI_API_KEY
# or
JUDGE_PROVIDER=anthropic # requires ANTHROPIC_API_KEY
```

---

## Scenarios

### Tier A — `sales-analyzer`

All providers, backend tools only.

- Dataset: `sales` table (10 records, columns: product, category, region, revenue, units, date)
- Tools: `execute_query`, `get_record_count`
- Scenarios: top products by revenue, top region

### Tier B — `knowledge-search`

Frontend tool scenario. Provider group: `TIER_B_PROVIDER_GROUPS`.

- Dataset: 5-doc knowledge base (LLM evaluation topics)
- Tools: `search_documents` (backend), `create_isoline` (frontend)
- Scenarios: document search → isoline generation

### Tier B — `data-explorer`

Frontend visualisation scenario.

- Dataset: `sales` table
- Tools: `execute_query` (backend), `render_visualization` (frontend)
- Scenarios: query top products → render bar chart

---

## Eval Options

| Variable | Default | Description |
|---|---|---|
| `AI_SEMANTIC_PASS_THRESHOLD` | `7` | Minimum AI Judge score (0–10) |
| `AI_PASS_THRESHOLD_RELAXED` | `6` | Relaxed threshold for sensitive tests |
| `EVAL_SCENARIO_SCOPE` | `full` | `full` = all turns, `canary` = Turn 1 only |
| `TIER_B_PROVIDER_GROUPS` | `OPENAI` | Providers for Tier B golden-dataset scenarios |
| `ROBUSTNESS_VARIANT_RUNS` | `1` | Repetitions per paraphrase variant |
| `EVAL_STRICT_TOOLS` | `false` | Treat unexpected tool calls as failures |
| `EVAL_RUN_LABEL` | — | Label for CSV rows (grouping in dashboards) |
| `AI_CSV_EXPORT_ENABLED` | `false` | Write CSV to `reports/eval/` |

---

## Project Structure

```
fmw-llmmautojest/
├── src/
│   ├── tests/
│   │   ├── structural/      # model-health
│   │   ├── semantic/        # prompt-template, context-coherence, branching, tools
│   │   └── eval/            # golden-datasets, grounding, robustness, tool-arg, coherence
│   ├── agent/               # AgentClient, AgentSession, tool definitions
│   ├── judge/               # AI Judge (Gemini + Anthropic), evaluator
│   ├── fixtures/            # Mock tool data, scenarios, frontend tool mocks
│   ├── support/             # Types, constants, helpers, assertions, CSV exporter
│   └── settings.ts          # All config from process.env
├── environments/
│   └── example.env          # Template with all variables documented
├── reports/eval/            # CSV output (gitignored)
├── jest.config.ts
├── package.json
└── README.md
```

---

## Extending the Framework

### Add a new scenario

1. Define the session in `src/fixtures/scenarios.ts`
2. Add mock tool data in `src/fixtures/tool-data.ts`
3. Add a test file in `src/tests/eval/`

### Add a new tool

1. Define the `ToolDefinition` in `src/agent/agent-tools.ts`
2. Add mock implementation in `src/fixtures/tool-data.ts`
3. Register in `DEFAULT_EXECUTOR` in `src/fixtures/scenarios.ts`
4. If frontend: add to `FRONTEND_TOOLS` set in `agent-tools.ts`

### Add a new provider

Implement a new branch in `AgentClient._callProvider()` and update `_inferProvider()`.

### Connect to real services

Replace `executeMockQuery` / `searchMockDocuments` in `src/fixtures/scenarios.ts` with real client calls. Tests don't change — only the executor.

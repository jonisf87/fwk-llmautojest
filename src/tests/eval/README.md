# Eval / Perf Tests — `@ai-eval`

Non-CI-gated evaluation tests that benchmark LLM agent quality across multiple dimensions.
These tests run against real LLM APIs and use an AI Judge (Gemini/Anthropic) for semantic scoring.

## Test Types

### TYPE 3 — Tool-Argument Correctness (`tool-arg-correctness.test.ts`)

Deep-validates tool argument semantics beyond structural checks:

| Check | What it verifies |
|---|---|
| SQL COUNT | `execute_query` SQL argument contains `COUNT` keyword and toolResponse has a numeric result |
| Coordinate precision | `create_isoline` lat/lng within ±0.1° of the expected city centre |

**Grading**: code-based only — zero AI Judge tokens. Fast and deterministic.

---

### TYPE 4 — Context Coherence (`context-coherence.test.ts`)

4-turn analysis conversation. Each turn is evaluated with AI Judge for:
- Pronoun/reference resolution across turns
- Entity carry-forward (product names, regions)
- No confusion about what "it", "those two", "that" refer to

**Grading**: AI Judge per turn. Collect-then-fail.

---

### TYPE 5 — Golden Dataset Fidelity (`golden-datasets.test.ts`)

End-to-end multi-turn scenarios with curated expected outputs.

**Tiers:**
- **Tier A** (`sales-analyzer`) — backend tools only, all providers, canary-compatible
- **Tier B** (`knowledge-search`, `data-explorer`) — frontend tools + functionCallOutputs, Tier B providers only

**Per-turn grading (two layers):**
1. Hard code check: expected tools present (score=0 + failure category if absent)
2. Soft AI Judge ≥ threshold: applied to final text response

`criticalPath=true` on a turn skips subsequent turns on failure.

**Frontend tool flow:**
```
Turn N: client.send(question) → toolCalls with frontend tool
Test builds functionCallOutputs from turn.frontendToolMocks
Continuation: client.send('', {previousResponseId, functionCallOutputs})
→ Final text response evaluated with AI Judge
```

---

### TYPE 6 — Robustness (`robustness.test.ts`)

Paraphrase invariance: 1 canonical + 3 variants per task.

**Tasks:**
- `sales_count` — "How many records are in the sales dataset?"
- `employee_count` — "How many employees are there?"

**Pass condition:**
- `mean_score ≥ 6` — consistent quality across phrasings
- `stddev_score ≤ 2.0` — low variance
- `tool_success_rate = 1.0` — tool routing is stable
- No `min_score = 0` when `mean ≥ threshold` (OUTLIER_FAILURE)

Skipped in `EVAL_SCENARIO_SCOPE=canary`.

---

### TYPE 7 — Grounding / Factual Accuracy (`grounding.test.ts`)

Verifies the model does not hallucinate record counts.

**Ground truth**: derived directly from `KNOWN_COUNTS` (mock data), not the LLM.

**Two-layer grading:**
1. Code: `|extracted_count - truth| / truth ≤ 5%`
2. AI Judge: framing quality — did the model cite the query result?

If the oracle count is unavailable, the test records `GROUND_TRUTH_UNAVAILABLE` and skips without asserting.

---

## Running Eval Tests

```bash
# All eval tests
npm run test:eval

# Single test file
npm test -- --testPathPattern="grounding"

# With CSV export + run label
AI_CSV_EXPORT_ENABLED=true EVAL_RUN_LABEL=my-run npm run test:eval

# Canary scope (Turn 1 only, fast smoke)
EVAL_SCENARIO_SCOPE=canary npm run test:eval
```

## CSV Output Schema

Eval results are written to `reports/eval/<timestamp>_<test-id>.csv`.

| Column | Description |
|---|---|
| test_id | Test file identifier |
| transaction_id | Unique per turn/variant |
| model | Model API name |
| provider | Provider group |
| question | User input |
| type | Test type (e.g. `golden_datasets`) |
| score | AI Judge score 0–10 (or `tool_success_rate×10`) |
| score_explanation | Judge explanation or code failure category |
| tokens | Total tokens used by judge call |
| latency_ms | Agent API call latency |
| scenario_id | Scenario identifier |
| turn_number | Turn within scenario |
| turn_type | `backend` / `tool` / `continuation` / `aggregate` / `skipped` |
| tool_success_rate | Fraction of expected tools called |
| run_label | `EVAL_RUN_LABEL` env var for grouping runs |
| expected_value | Reference output |
| received_value | Actual model response (truncated) |
| ground_truth_value | Known correct count (grounding only) |
| extracted_value | Count extracted from model text (grounding only) |
| pct_error | `|extracted - truth| / truth` (grounding only) |
| api_response | Raw tool call data (JSON) |
| judge_response | Raw judge LLM response |

## Swapping Mock Tools for Real Services

All tools execute against in-memory mock data by default. To connect to real services:

1. Implement a custom `MockExecutor` in `src/fixtures/tool-data.ts`
2. For SQL: replace `executeMockQuery` with a real database client (pg, mysql2, etc.)
3. For search: replace `searchMockDocuments` with a real vector search (OpenSearch, Pinecone, etc.)
4. Update `KNOWN_COUNTS` with actual dataset sizes for grounding tests

The test files do not need to change — only the executor implementation.

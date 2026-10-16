# Demo API — implementation 2026-10-16

These endpoints process fictional clinician-demo material only. They do not provide patient identity, clinical-record hosting, or verification that a browser's claimed provenance is authentic.

## Routes and deployment

Root `api/access.ts`, `models.ts`, `turn.ts`, and `draft.ts` export Vercel Node Web-standard `{ fetch(Request) }` handlers. Shared code lives here; root `package.json` supplies Zod. No client-side provider key or paid SDK is used.

- `POST /api/access`, JSON `{code}`: constant-time comparison against the configured SHA-256 hash; returns a signed bearer token valid for one hour and `expiresAt`.
- `GET /api/models`: the three approved model IDs, current catalogue availability, supported parameters and USD-per-million prices, plus `liveReady`, `readiness.providerKey`, `readiness.access`, and `readiness.quota`. This tests Redis connectivity but does not make a paid model request or authenticate the provider key.
- `POST /api/turn` and `/api/draft`, bearer token and shared `ModelRequest`: return the shared `ModelResponse`, with validated result, actual model identifier, server prompt/version, elapsed milliseconds, and provider-reported token counts/cost when supplied.
- `OPTIONS`: exact-origin CORS preflight. No wildcard origins or credential cookies.

The frontend must keep the bearer token in memory, send a new request ID only for a deliberate new operation, and reject responses to a superseded local revision. The API also rejects revisions at or below the last successfully committed revision for that code/patient/branch/session.

## Private environment

| Variable | Meaning |
|---|---|
| `OPENROUTER_API_KEY` | Provider key entered privately in Vercel Production; never prefix with `VITE_`. |
| `DEMO_ACCESS_CODE_HASH` | SHA-256 hex digest of a high-entropy access code. Code length 8–256 characters. |
| `SESSION_SECRET` | At least 32 characters of cryptographically random signing material. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | HTTPS Redis REST endpoint and private token. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Supported aliases supplied by the Vercel Upstash integration. |
| `ALLOWED_ORIGINS` | Comma-separated exact browser origins, e.g. GitHub Pages origin and explicitly chosen localhost origin. The current API origin is also accepted. |

Rotating the access-code hash revokes existing sessions. Rotating the signing secret also revokes them. Avoid short human-guessable access codes: hashing does not add entropy. There is no production in-memory quota fallback; missing or unavailable Redis closes access and paid operations.

## Durable quotas and idempotency

`quota.ts` uses atomic Redis Lua scripts and the namespace `iser:v1:`. Amounts are integer microdollars (one million equals one USD). Limits are $10 total, $2 per UTC calendar day, at most $0.25 reserved per request, 20 operations per access code per UTC day, one concurrent request per fictional session, and two across the environment. Policy-only finish responses count as an operation but finalize at zero cost.

Before a provider call, one atomic reservation checks the code/day count, global and session leases, revision, idempotency ID and payload hash, and both budgets. The provider request has fixed output limits, required-parameter routing, no fallback, and prompt/completion/per-request price caps. The input bound uses UTF-8 bytes of the actual messages and schema plus a 4,096-token framing margin. The output reservation includes two complete output budgets to cover providers that account for reasoning separately. Current tier prices and internal-reasoning prices are considered. A request exceeding the cap is rejected before it is sent; content is not silently truncated.

Finalization replaces the reservation with actual cost if the provider returned a finite cost, including for a rejected model answer. Missing/uncertain billing retains the full reserved amount. A killed function leaves a pending receipt and its reservation. Concurrency leases expire after 120 seconds, but this never releases the money. Unknown receipts require an operator to reconcile provider usage before any manual budget adjustment. Daily counters expire after 90 days; lifetime spend and request receipts do not automatically expire.

Duplicate IDs return HTTP 409 (`request_pending`, `request_done`, `request_failed`, or `request_uncertain`); a different body with the same ID returns `request_id_conflict`. **No response content is cached or replayed.** Redis stores hashes, statuses, timestamps, counters, and cost receipts only—not prompts, sources, cases, tokens, or generated documents. This means a successful response lost in transit cannot be reconstructed from the server. The UI must explain that uncertainty and let the clinician keep working manually or deliberately initiate a new request. No automatic retry occurs.

Access attempts are limited to 10 per hashed IP/window of 15 minutes and 100 per environment/minute. Vercel's client-IP header is preferred; the raw IP is not persisted or logged. The local fallback shares one bucket. Token subjects derive from the configured access-code hash; minting another token does not reset the code's daily quota.

Question counters are shared across functions and tokens for the same fictional session. Main questions are capped at three. Intake questions are capped at two per `intakeRound`; the browser creates a new round only through explicit opt-in, and the server accepts rounds 0–10 subject to the daily operation limit. The backend cannot prove a UI click happened: a fully hostile client may manufacture fictional state or a round number, but cannot bypass code/global cost quotas.

## Input and output boundaries

Bodies are streamed with a 100,000-byte limit, strict JSON/Zod schemas, bounded texts and arrays, approved model IDs, and only server-authored system instructions. User context is a separate JSON user message. Runtime validation checks patient/declared branch scope, earlier source session numbers and cutoff times, duplicate IDs, document/message citations, preference ownership, and all 32 permissible intake-field IDs/statuses. All sources, including the current session, must be recorded at or before `asOf`, the context assembly or session closure boundary. Declared ancestry is structurally checked, not authenticated against a server-held clinical record; the demo has no such record.

Drafts contain exactly the five distinct document kinds. Intake changes are sparse patches (0–32), with unique field IDs. Non-unknown updated fields require an existing source. The prompt and renderer retain all 32 fields in the report even when no patch changes them. Strict provider JSON schema requires every output property; optional preference `goal` uses `null` on the wire and is normalized to omitted before the shared runtime contract check.

Question ceilings and explicit finish commands are enforced before inference using durable counters. Output validation rejects unknown citations, incomplete generations, another model, obvious multiple question marks, common yes/no phrasing, exact blocked-topic references, and exact excluded-topic text. **These lexical checks do not establish semantic fidelity**: paraphrases, leading assumptions, subtle compound questions, unsupported clinical claims, and source entailment still require clinician review and conversation-quality tests. The API never treats a valid schema as clinical validation. No partial/raw streamed output is sent to the UI; no reasoning trace is returned.

## Errors and recovery

Every failure returns `{error: string}`. Messages are controlled codes, never raw provider/Redis exception bodies.

| HTTP | Typical codes | Meaning |
|---|---|---|
| 400 / 413 / 415 | `invalid_request`, `invalid_json`, `request_too_large`, `source_outside_context`, `message_source_mismatch`, `request_budget_exceeded` | Correct or reduce the submitted context; no paid request was made if validation failed before reservation. |
| 401 | `invalid_access_code`, `access_required`, `invalid_session`, `session_expired` | Re-enter the demo code when appropriate. |
| 403 | `origin_not_allowed` | Deployment origin is not in the configured allowlist. |
| 409 | `request_*`, `stale_revision` | Already processed, uncertain, conflicting, or stale operation; never automatically resend as a paid call. |
| 429 | `access_rate_limit`, `daily_call_limit`, `daily_budget_exceeded`, `total_budget_exceeded`, `concurrency_limit` | Stop or wait for the applicable window/operation. Budget is not topped up automatically. |
| 502 | `provider_outcome_uncertain`, `invalid_model_output`, `unknown_model_source`, `incomplete_model_output`, `unexpected_response_model` | No update is applied. The request may have incurred cost; the durable receipt prevents retry under that ID. |
| 503 | `quota_store_not_configured`, `quota_store_unavailable`, `model_catalog_unavailable`, `model_unavailable`, `provider_not_configured` | Live mode unavailable; prepared/manual modes remain usable. |

## Verification

Run `npx vitest run --root . tests/api.test.ts`. The tests use wholly artificial strings, mock provider HTTP, and an explicitly injected test-only in-memory quota store. They cover authentication/expiry, access throttling, CORS, missing Redis, malformed and oversized bodies, source scope/citations, all five kinds, sparse updates, field/semantic guards, price limits, one-call idempotency, durable counter behavior, rejected-output billing and uncertain reservations. They do not establish that deployed Redis executes the Lua scripts or that an actual provider complies. A deployed access/turn/draft smoke test and participant-browser verification are separate release gates.

The optional `tests/api-budget.test.ts` runs only when `API_BUDGET_LIVE=1`, fetching the public model catalogue without a provider key or paid inference. It constructs every supplied fictional case's fifth session through the actual domain API, adds a short artificial note, and checks a draft using the full server prompt/schema/context. Verified on 2026-10-16: maximum input bound 45,802 tokens (a conservative byte-based bound, not measured provider usage); Sonnet and GPT reserve $0.210387–$0.211604, and Gemini reserves $0.086785–$0.087287. All nine case/model combinations fit the $0.25 cap. Actual prices and longer user input may change these bounds.

Official implementation references checked on 2026-10-16: [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js), [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs), [provider price/routing rules](https://openrouter.ai/docs/guides/routing/provider-selection), [reasoning budgets](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), and [Upstash REST](https://upstash.com/docs/redis/features/restapi).

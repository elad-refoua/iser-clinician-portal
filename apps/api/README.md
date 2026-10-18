# Demo API — implementation 2026-10-16

These endpoints process and optionally persist fictional clinician-demo material only. Cloud saving stores the demo workspace, including its contained document versions and diagnostic traces. It does not provide a clinical-record service, patient identity verification, or proof that a browser's claimed provenance is authentic. A `fictional: true` flag is a schema requirement, not permission to upload real clinical material.

## Routes and deployment

Root `api/access.ts`, `models.ts`, `turn.ts`, `draft.ts`, and `workspace.ts` export Vercel Node Web-standard `{ fetch(Request) }` handlers. Shared code lives here; root `package.json` supplies Zod and the Neon serverless driver. No client-side provider key is used.

- `POST /api/access`, strict JSON `{username, password}`: validates the configured username and compares the password digest in constant time; returns a signed bearer token valid for one hour and `expiresAt`. The old `{code}` request is rejected.
- `GET /api/models`: the three approved model IDs, current catalogue availability, supported parameters and USD-per-million prices, plus `liveReady`, `readiness.providerKey`, `readiness.access`, and `readiness.quota`. This tests Redis connectivity but does not make a paid model request, authenticate the provider key, or test workspace-database readiness.
- `POST /api/turn` and `/api/draft`, bearer token and shared `ModelRequest`: return the shared `ModelResponse`, with validated result, actual model identifier, server prompt/version, `effectiveContext`, elapsed milliseconds, and provider-reported token counts/cost when supplied. `effectiveContext` is the validated context after durable server question counters are applied; it is the context used for that operation. A policy-only finish response identifies `model: "server-policy"` and does not call a model.
- `GET /api/workspace`, bearer token: returns `{revision, updatedAt, state}` for the configured shared workspace. An empty workspace returns `{revision: 0, updatedAt: null, state: null}`.
- `PUT /api/workspace`, bearer token and JSON `{expectedRevision, state}`: validates and replaces the full workspace snapshot atomically, returning `{revision, updatedAt}`. A stale expected revision returns HTTP 409 `workspace_conflict`; see the persistence contract below.
- `OPTIONS`: exact-origin CORS preflight. No wildcard origins or credential cookies.

The frontend must keep the bearer token in memory, send a new model-request ID only for a deliberate new operation, and reject model responses to a superseded local revision. The model API also rejects revisions at or below the last successfully committed revision for that code/patient/branch/session. These model-request revisions are separate from the workspace snapshot's `revision`.

## Login request contract

The following is a shape example, not a working credential:

```http
POST /api/access
Content-Type: application/json

{"username":"elad","password":"<private-password>"}
```

A successful response has `{token, expiresAt}`. Send `Authorization: Bearer <token>` to model and workspace routes. Do not put credentials or tokens in URLs, committed examples, diagnostic logs, or exported workspace state. The browser shows a full login screen, then opens the stored workspace with explicit reconciliation for differing local work. Login does not send an inference request.

## Private environment

| Variable | Meaning |
|---|---|
| `OPENROUTER_API_KEY` | Provider key for live model operations, entered privately in Vercel Production; never prefix with `VITE_`. Not required for authenticated cloud saving or manual editing; new AI questions and drafts require it. |
| `DEMO_USERNAME` | Login username; defaults to `elad` when unset or blank. Comparison trims surrounding whitespace and ignores case. This is one configured owner identity, not a user-account database. |
| `DEMO_ACCESS_CODE_HASH` | SHA-256 hex digest of the private password, retaining the existing environment name. Password length 8–256 characters; its whitespace and case are significant. |
| `SESSION_SECRET` | At least 32 characters of cryptographically random signing material. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | HTTPS Redis REST endpoint and private token. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Supported aliases supplied by the Vercel Upstash integration. |
| `DEMO_DATABASE_URL` | Private Neon Postgres connection string for workspace persistence; preferred over `DATABASE_URL`. Never prefix with `VITE_`. |
| `DATABASE_URL` | Fallback database connection string when `DEMO_DATABASE_URL` is unset or empty. |
| `DEMO_WORKSPACE_ID` | Shared workspace row key; defaults to `owner-demo`. Must be nonblank and at most 160 characters. It is independent of the access-code hash. |
| `ALLOWED_ORIGINS` | Comma-separated exact browser origins, e.g. GitHub Pages origin and explicitly chosen localhost origin. The current API origin is also accepted. |

Rotating the password hash revokes existing sessions. Rotating the signing secret also revokes them. Neither rotation changes the saved workspace: the database connection and `DEMO_WORKSPACE_ID` select it. Avoid short human-guessable passwords: hashing does not add entropy. Changing `DEMO_USERNAME` alone does not revoke existing tokens, whose subject is derived from the password hash. There is no production in-memory quota fallback; missing or unavailable Redis closes token issuance and paid operations. `POST /api/access` uses Redis rate limiting even when the intended use is only cloud saving. Authenticated workspace GET/PUT requests use the database directly and do not require an OpenRouter key or a paid model call.

## Fictional workspace persistence

`workspace.ts` authenticates both GET and PUT with the same one-hour bearer token as model operations. `workspace-store.ts` uses `@neondatabase/serverless` through its HTTP query interface, with a 15-second query timeout. Use a Neon-compatible Postgres connection string (`postgres:` or `postgresql:`), not Redis REST credentials. Database provisioning and connection details are documented in the official [Vercel storage overview](https://vercel.com/docs/storage) and [Neon serverless driver guide](https://neon.com/docs/serverless/serverless-driver).

On first use, the store runs a transaction with an advisory lock and `CREATE TABLE IF NOT EXISTS public.merhav_demo_workspaces`. The table contains `workspace_id` (text primary key), `revision` (positive integer), `updated_at` (timestamp with time zone), and `state` (JSONB object). The configured database role must permit that automatic DDL and subsequent SELECT, INSERT, and UPDATE operations; there is no separate migration command. Both GET and PUT can trigger initialization.

All accepted tokens in one deployment read and write the same configured workspace. This is a shared single-owner demo, with no per-user workspace assignment, multiuser roles, or record-level authorization. Two deployments using the same database and workspace ID also address the same row. Changing the ID selects another row; it does not migrate or delete the previous one. The server receives and stores readable JSON, so this is not end-to-end encryption or authorization for clinical data.

The client sends lossless binary gzip with `Content-Type: application/vnd.merhav.workspace+gzip` and requests the same representation with `Accept` on GET. This is an application payload, not HTTP `Content-Encoding`, so the shared codec bounds both transport and decoded content explicitly. The wire limit is **3,000,000 bytes** and the decoded UTF-8 envelope limit is **25,000,000 bytes**. Legacy JSON remains accepted within the 3 MB wire limit. The handler checks streamed bytes and declared length; decompression stops at the decoded bound. A PUT also preflights the future GET envelope before saving, leaving a small metadata margin. Full histories and sources are retained; compression does not summarize or remove them.

`expectedRevision` must be an integer from 0 through 2,147,483,646. The full state passes the domain's `importState()` schema and relationship checks, including fictional flags, unique identifiers, branch/session ownership, source and version references, time boundaries, preferences, and trace structure. GET revalidates stored state before returning it. Structural validity does not verify that submitted text is genuinely fictional or clinically accurate. Browsers require the standard CompressionStream/DecompressionStream APIs; a missing codec is a visible compatibility failure, not a local-storage fallback.

Trace validation recognizes the exact current and legacy generated intake layouts, including preference-redacted reports. This keeps older compacted contexts readable when a status display label changes. It does not rewrite saved document text, accept arbitrary trace content, or treat clinician-authored prose as generated boilerplate.

Saving uses compare-and-swap: expected revision 0 inserts the first snapshot at revision 1 only if no row exists; otherwise an UPDATE succeeds only when the stored revision matches, then increments it. A conflict returns HTTP 409 `workspace_conflict` without overwriting the stored snapshot. The client preserves active work in page memory, loads the current snapshot, and resolves the conflict deliberately; blindly resending the old state with a fresh revision would overwrite the other saved work. Workspace responses use `Cache-Control: no-store`. Cases, drafts and auth are never automatically persisted in browser storage.

The row holds the **latest full snapshot**, including every document version, source, message, preference, and trace contained in that submitted state. Replacing the row does not create a server archive of each prior snapshot or every keystroke, and it cannot recover changes never saved successfully. There is no application TTL or automatic snapshot expiry, no DELETE route, and no application-managed backup history. Database retention and backups remain an operator responsibility. Redis remains separate and stores only the quota/access metadata described below.

Saving a workspace does not change the model authorization boundary. `/api/turn` and `/api/draft` validate the browser's submitted context but do not load this saved snapshot or compare that context against it. Possession of a valid token therefore does not establish that a claimed source, branch ancestry, or model context matches the cloud state.

## Durable quotas and idempotency

`quota.ts` uses atomic Redis Lua scripts and the namespace `iser:v1:`. Amounts are integer microdollars (one million equals one USD). The user-authorized trial limits are **$10 per UTC calendar day** and **$20 total**. These limits have no scheduled expiry. All previously recorded spending and reservations count toward them; increasing the allowance does not reset or refund counters, reservations or receipts.

The remaining limits are at most $2 reserved per request, 100 operations per access code per UTC day, one concurrent request per fictional session, and two across the environment. Policy-only finish responses count as an operation but finalize at zero cost. The application limits are separate from the OpenRouter account or key allowance; increasing one does not configure the other.

`compactModelContext` removes only duplicated deterministic intake rendering when all fields are present, preserving original source text, messages and custom intake prose. Stored records stay complete. Working drafts and pending fields remain explicitly unapproved. The final effective context is returned for tracing.

Before a provider call, one atomic reservation checks the code/day count, global and session leases, revision, idempotency ID and payload hash, and both budgets. The provider request has budget-adjusted output limits (turn target 2,500/floor 1,500; draft target 6,000/floor 3,500 tokens), required-parameter routing, no fallback, and prompt/completion/per-request price caps. The input bound uses UTF-8 bytes of the actual messages and schema plus a 4,096-token framing margin. The output reservation includes two complete output budgets to cover providers that account for reasoning separately. Current tier prices and internal-reasoning prices are considered. A request exceeding the cap is rejected before it is sent; content is not silently truncated.

Finalization replaces the reservation with actual cost if the provider returned a finite cost, including for a rejected model answer. Missing/uncertain billing retains the full reserved amount. A killed function leaves a pending receipt and its reservation. Concurrency leases expire after 300 seconds, but this never releases the money. Unknown receipts require an operator to reconcile provider usage before any manual budget adjustment. Daily counters expire after 90 days; lifetime spend and request receipts do not automatically expire.

The provider deadline is 180 seconds, inside Vercel's 240-second function duration and the 300-second concurrency lease. Enable Fluid Compute for this duration; the deployment project uses Node.js 24. These aligned windows allow slow long-case generation to complete and leave time for catalogue, quota and finalization operations. An uncertain timeout keeps its reservation and never causes an automatic paid repeat. The 600,000-byte model-request envelope and each model's context/output limits remain explicit boundaries; sources are not silently truncated. See [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration).

Duplicate IDs return HTTP 409 (`request_pending`, `request_done`, `request_failed`, or `request_uncertain`); a different body with the same ID returns `request_id_conflict`. **The model-request idempotency store does not cache or replay response content.** Redis stores hashes, statuses, timestamps, counters, and cost receipts only—not prompts, sources, cases, bearer tokens, or generated documents. A successful model response lost in transit cannot be reconstructed from that store. Postgres can contain model outputs and traces only as part of a separately saved workspace snapshot; it does not capture an undelivered model response. The UI must explain that uncertainty and let the clinician keep working manually or deliberately initiate a new request. No automatic model retry occurs.

Access attempts are limited to 10 per hashed IP/window of 15 minutes and 100 per environment/minute. Vercel's client-IP header is preferred; the raw IP is not persisted or logged. The local fallback shares one bucket. Token subjects derive from the configured access-code hash; minting another token does not reset the code's daily quota.

Question counters are shared across functions and tokens for the same fictional session. Main questions are capped at three. Intake questions are capped at two per `intakeRound`; the browser creates a new round only through explicit opt-in, and the server accepts rounds 0–10 subject to the daily operation limit. The backend cannot prove a UI click happened: a fully hostile client may manufacture fictional state or a round number, but cannot bypass code/global cost quotas.

## Input and output boundaries

Bodies for `/api/access` are streamed with a **100,000-byte limit**; `/api/turn` and `/api/draft` allow **600,000 bytes**, using the shared `MAX_MODEL_REQUEST_BYTES`; workspace PUT has the separate 3,000,000-byte limit above. Model operations use strict JSON/Zod schemas, bounded texts and arrays, approved model IDs, and only server-authored system instructions. User context is a separate JSON user message. Runtime validation checks patient/declared branch scope, earlier source session numbers and cutoff times, duplicate IDs, document/message citations, preference ownership, and all 32 permissible intake-field IDs/statuses. All sources, including the current session, must be recorded at or before `asOf`, the context assembly or session closure boundary. Declared ancestry is structurally checked within that request, not authenticated against the separately persisted fictional workspace.

Drafts contain exactly the five distinct document kinds, a short `summary`, and up to three optional `followUps` with target kind, invitation/reminder text and relevant intake field IDs. The model leaves intake document content and sourceIds empty; the domain derives the full report and citations from existing, pending and new structured fields. Intake changes are sparse patches (0–32), with unique field IDs. Non-unknown updated fields require an existing source. For both tasks, the provider schema uses nested `anyOf` branches to require an empty-string value for `unknown` and ordinary text for other statuses. Runtime validation remains active and never silently deletes or relabels rejected text; stored historical context schemas are unchanged. The prompt and renderer retain all 32 fields in the report even when no patch changes them. Strict provider JSON schema requires every output property; optional preference `goal` uses `null` on the wire and is normalized to omitted before the shared runtime contract check.

Question ceilings and explicit finish commands are enforced before inference using durable counters. Output validation rejects unknown citations, incomplete generations, another model, obvious multiple question marks, common yes/no phrasing, exact blocked-topic references, and exact excluded-topic text. **These lexical checks do not establish semantic fidelity**: paraphrases, leading assumptions, subtle compound questions, unsupported clinical claims, and source entailment still require clinician review and conversation-quality tests. The API never treats a valid schema as clinical validation. No partial/raw streamed output is sent to the UI; no reasoning trace is returned. The brief output `rationale` is a user-facing explanation, not hidden model reasoning. The prompt asks each follow-up to identify a concrete detail in the latest clinician contribution and a meaningful unresolved gap; it forbids a generic request to repeat what is important to document. An explicit rewrite or draft request is routed to drafting, without resetting question counters. These behavioral instructions still require live review.

## Errors and recovery

Every failure returns a controlled `{error: string}` code, never raw provider/Redis exception bodies. A `stale_revision` rejection additionally carries a validated positive `minimumRevision`. It occurs before quota reservation and inference. The current explicit UI action can advance an unchanged session once and retry under the same limits; another rejection stops. It regenerates a response rather than retrieving an earlier result.

Validation diagnostics log only fixed route/error codes, allowlisted schema paths and numeric counts. They do not log source text, model output, credentials, arbitrary keys or Zod message text. The UI exposes the fixed error code in a collapsed details control. Historical failures without this instrumentation cannot be diagnosed retrospectively from their generic502 status.

| HTTP | Typical codes | Meaning |
|---|---|---|
| 400 / 413 / 415 | `invalid_request`, `invalid_json`, `request_too_large`, `source_outside_context`, `message_source_mismatch`, `request_budget_exceeded` | Correct or reduce the submitted context; no paid request was made if validation failed before reservation. |
| 401 | `invalid_credentials`, `access_required`, `invalid_session`, `session_expired` | Re-enter the configured username and private password when appropriate. Login does not reveal which credential was wrong. |
| 403 | `origin_not_allowed` | Deployment origin is not in the configured allowlist. |
| 409 | `request_*`, `stale_revision` | Already processed, uncertain, conflicting, or stale operation. Only a new explicit action rejected as stale can use the single guarded revision advance described above; other409 errors do not repeat. |
| 429 | `access_rate_limit`, `daily_call_limit`, `daily_budget_exceeded`, `total_budget_exceeded`, `concurrency_limit` | Stop or wait for the applicable window/operation. Budget is not topped up automatically. |
| 502 | `provider_outcome_uncertain`, `invalid_model_output`, `unknown_model_source`, `incomplete_model_output`, `unexpected_response_model` | No update is applied. The request may have incurred cost; the durable receipt prevents retry under that ID. |
| 503 | `quota_store_not_configured`, `quota_store_unavailable`, `model_catalog_unavailable`, `model_unavailable`, `provider_not_configured` | The requested service is unavailable. No prepared answer is substituted for a failed AI call; retain local work and use explicitly labeled manual editing if an authenticated interface remains open. |

Workspace-specific failures include HTTP 400 `workspace_invalid_request` or `workspace_invalid_state`, HTTP 409 `workspace_conflict`, HTTP 503 `workspace_not_configured` or `workspace_store_unavailable`, and HTTP 500 `workspace_request_failed`. They also use the common authentication, origin, JSON, and size errors. A cloud failure does not confirm that local work has been saved remotely; retain the local copy and inspect the current remote revision before resolving an uncertain write. Cloud configuration is independent of model readiness.

## Verification

Workspace checks are separate from inference: `npx vitest run --root . tests/workspace.test.ts tests/workspace-sync.test.ts tests/workspace-choice.test.ts` exercises the handler and client synchronization with artificial state and test doubles. It does not establish that a deployed Neon role can initialize the table or that two actual browsers recover correctly. Verify those paths through the deployed interface and record the result in the release evidence.

Run `npx vitest run --root . tests/api.test.ts`. The tests use wholly artificial strings, mock provider HTTP, and an explicitly injected test-only in-memory quota store. They cover authentication/expiry, access throttling, CORS, missing Redis, malformed and oversized bodies, source scope/citations, all five kinds, sparse updates, field/semantic guards, price limits, one-call idempotency, durable counter behavior, rejected-output billing and uncertain reservations. They do not establish that deployed Redis executes the Lua scripts or that an actual provider complies. A deployed access/turn/draft smoke test and participant-browser verification are separate release gates.

The optional `tests/api-budget.test.ts` runs only when `API_BUDGET_LIVE=1`, fetching the public model catalogue without a provider key or paid inference. It constructs every supplied fictional case's fifth session through the actual domain API, adds a short artificial note, and checks a draft using the full server prompt/schema/context. The current regression also covers a pending draft with full raw sources, exact duplicate-rendering compaction, nonmutating context projection, and the dynamic output budget. Run it against current catalogue prices before claiming capacity; the conservative byte bound is not measured provider token usage. Actual prices and longer clinician input can still exceed the unchanged caps.

Official implementation references checked on 2026-10-16: [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js), [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs), [provider price/routing rules](https://openrouter.ai/docs/guides/routing/provider-selection), [reasoning budgets](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), and [Upstash REST](https://upstash.com/docs/redis/features/restapi).

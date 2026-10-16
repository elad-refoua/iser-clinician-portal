# Server-only UI and transport review — 2026-10-16

Reviewed the current shared working tree after the server-only persistence change. This was initially a read-only review; the root agent subsequently assigned the fixes described below. No real patient data, credentials, `.env` files, live database records, browser session, deployment, or paid provider call was used by this reviewer. Fixtures and mocked transports were used throughout.

## Findings and resolutions

### S1 — P2 — Intermediate acknowledged save was forgotten on logout/reconnect — fixed

**Reproduction:** Start from confirmed state S; send edit A; queue newer edit B while A is in flight; acknowledge A; leave B pending; stop the connection and reconnect. Before the fix, the controller knew A was confirmed but emitted no event after this intermediate acknowledgment. App's baseline remained S. Reconnection therefore compared server A, memory B, baseline S and treated this tab's own successful write as an external conflict, with no option to save B against the unchanged server.

The in-memory transport reproduction observed `statuses=[pending,pending]`, `syncAcknowledgedA=true`, `appBaselineStillOriginal=true`, `onReauthAction=choose`, `canKeepWorkingCopy=false`.

**Resolution:** `apps/web/workspace-sync.ts:181` now emits `pending` after an acknowledged intermediate write and `saved` only when its queue is clear. `apps/web/App.tsx:101` captures the latest acknowledged state before every connection stop; the status callback also refreshes that baseline on every event. The UI still compares the acknowledged snapshot with the actual current state, so a newer edit waiting for debounce is not labeled saved.

**Regression:** `tests/server-only-workflow.test.ts:66` reproduces A acknowledged/B pending/logout, verifies A is retained as the baseline, B remains unsaved, no false `saved` event occurs, and explicit reconnection can retain B. Existing serialized-write, conflict and transport tests remain green.

### S2 — P2 — A lost completed model response made explicit retry fail indefinitely at the same revision — fixed for regeneration

**Evidence and reproduction:** `apps/api/handler.ts:93` finalizes a successful request before returning its response. The durable quota guard rejects revisions at or below the completed revision (`apps/api/quota.ts`, `RESERVE_LUA`). Ordinary cancellation did not advance the browser's session revision; reloading the persisted input could also restore the same revision after the response was lost. A new request ID did not help.

An executed reproduction used the actual handler, a fictional session, a stub catalogue and a quota double matching the production revision guard. The first request took the zero-provider `server-policy` path; its response was deliberately not applied. Results were:

```json
{"firstStatus":200,"firstModel":"server-policy","clientRevision":1,"committed":1,"retryStatus":409,"retryError":"stale_revision"}
```

**Resolution:** A stale rejection now carries a validated `minimumRevision = committedRevision + 1` (`apps/api/quota.ts:97`, `apps/api/handler.ts:103`). It happens before quota reservation or a provider request. Within an explicit action, `apps/web/model-retry.ts:3` permits one rebase/retry only. App verifies that the request, selected session and context stamp are still current before rebasing (`apps/web/App.tsx:226`). `advanceRequestRevision(state, sessionId, expectedRevision, minimumRevision)` changes only the session revision and leaves all messages, sources, versions, preferences, proposals and traces intact. It does not make an older proposal approvable (`packages/domain/index.ts:287`).

The same quota and durable question counters govern the subsequent request. A second stale rejection, provider failure, uncertain outcome or malformed recovery metadata stops without another retry. No retry is initiated simply by loading the page. If a previously completed request was paid, explicitly generating another response can incur another normal, quota-limited call; the old response is not claimed to have been recovered.

**Regression:** `tests/model-retry.test.ts` covers ordinary cancellation and reload, exactly one user message and one applied reply, at most one rebase, intervening changes, malformed metadata, and no automatic repeat after provider errors. The API regression simulates a lost third question, verifies that the stale rejection changes neither quota nor provider-call count, then verifies the rebased turn becomes a draft transition without asking a fourth question. The Redis adapter test rejects invalid minimum revisions.

**Expansion interaction:** The existing `rollbackExpansion` guard still checks unchanged content and ownership. It accepts the current request's tracked rebased revision, preserves consumed intake rounds, advances the revision again, and only restores proposal approvability when the exact original content, preferences and document bases still match. `tests/context-integrity.test.ts:180` covers rebase followed by cancellation and intervening changes.

### S3 — P2 — Import/reset could clear unsaved editor buffers after offering an incomplete backup — fixed

**Evidence:** `adoptState` clears the in-memory editor map. The earlier import/reset confirmation called it even with an open editor, while its export action included only committed `PortalState` and omitted that buffer. The server-copy replacement flow already blocked this condition.

**Resolution:** `apps/web/App.tsx:488` now displays a specific open-editor warning, disables replacement, and checks again inside the action handler. The user must save or cancel the editor before replacement. JSON export is explicitly described as excluding text still open in an editor. This UI guard was source-verified; root owns browser verification of the actual modal.

### S4 — P2 — Failed question retry always requested a draft — fixed

**Evidence:** The error-panel retry button previously called `runAction('draft')` for every failure, including a first `turn` validation failure. This changed the requested interaction and prevented retrying the failed question.

**Resolution:** App records the actual attempted task, including the transition from turn to draft, and retries the same route with a matching label (`apps/web/App.tsx:207`, `apps/web/App.tsx:244`, `apps/web/App.tsx:469`). Already committed composer input is reused without adding a duplicate user message. The error panel also offers a disclosure containing only an allowlisted fixed error code; provider text and validation values are not exposed. The main agent owns browser verification of the first-turn failure/retry flow.

**Expansion retry follow-up:** An untouched failed expansion that rolls back now retains its exact goal and a cloned follow-up selection, including field IDs. `rememberExpansionRetry` captures the post-rollback state and patient/branch/session; `canRetryExpansion` rejects a different selection or changed state. The explicit button restarts through `beginExpansion`, consuming a new voluntary round while reusing the same focus. Changed composer text, preferences or proposal require choosing a current suggestion instead. This prevents a rolled-back optional expansion from accidentally retrying as a general main-session turn. Three additional tests in `tests/model-retry.test.ts` cover these cases and mutation isolation; typecheck and 25 model-retry/context-integrity tests passed after this follow-up.

## Other reviewed paths

- A fresh login reads the server; it does not read browser persistence. An empty workspace remains noneditable until its first PUT succeeds. Initial GET availability failures retain authentication and offer retry. A real 401 requires login.
- Later write failures keep the working copy in tab memory and retain the acknowledged baseline. A conflict does not silently overwrite the server. Reconnecting the in-memory copy requires an explicit choice, a fresh server read and the server's current compare-and-swap revision.
- Unsent composer text belongs to the workspace snapshot. Uncommitted document-editor buffers belong only to page memory and are explicitly marked unsaved. Before-unload checks include changes before the debounce, an active model request and open editors.
- Stale manual editor saves are rejected against the original document-version ID while retaining the buffer. History restoration and proposal acceptance cannot silently replace the same open editor; domain save validation remains the final guard.
- The application-level gzip transport checks compressed and decoded sizes separately, rejects malformed responses, and bounds client operations. Workspace PUT checks that the accepted snapshot can be read back within the same protocol limits before committing it. The Neon store uses atomic revision comparisons. No live Neon integration was exercised by this reviewer.

## Verification and limits

After the fixes, `npm run typecheck` passed. Targeted runs passed 38 tests across `model-retry`, `context-integrity` and `server-only-workflow`, plus 49 tests across `api`, `workspace-sync` and `workspace-choice` (87 total). An earlier review run passed 39 tests across context integrity, document editing, workflow guards and workspace API/transport. `git diff --check` passed for changed files; Git reported only its normal CRLF-to-LF notices. The root agent owns the final complete-suite run and browser verification after integration.

Reviewed source: App, Documents, SessionConversation, editor buffers, workflow guards, workspace choice/state/sync, shared workspace transport, workspace handler/store, model handler/quota, domain revision/expansion helpers, and their relevant tests. This is not a fresh audit of every domain mutation, all archive growth boundaries, production credentials, platform compression support, or real multi-device behavior.

The server stores confirmed workspace snapshots, not unsent editor buffers or a replayable archive of every completed provider response. Refreshing before a write is acknowledged can lose memory-only changes; the UI warns about that boundary. The new model retry produces another response under the normal limits. It does not provide durable recovery of a response that never reached the workspace. No fabricated response, source, or trace was introduced.

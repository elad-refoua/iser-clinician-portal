# Persistent fictional records — 2026-10-16

## Scope and setup
User confirmed fictional demonstrations only. Neon resource `iser-demo-records` provisioned through Vercel on `free_v3`, fra1, Production-only `DEMO_` environment prefix, after the user accepted provider terms. No database credentials or provider key were printed or committed. Upstash continues to store quota metadata only.

## Automated checks
- Full suite after reconnect and recovery review: 127 passed, one optional public-catalogue test skipped; TypeScript and production build passed.
- New-patient domain: minimal required name/code, optional weekday/time, empty session 1, administrative source, capacity checks, backward-compatible archive import.
- Workspace endpoint: authenticated GET/PUT, strict state validation, bounded request, no unauthenticated database reads, CORS, empty/save/load, and revision conflict.
- Sync client: serialized writes, pending-change coalescing, timeout/lost-response handling, no automatic retry, conflict/auth pause, late response ignored after stop.
- Reconnect decision regressions: dirty local state always requires a choice when server content differs, including a shared-browser-storage snapshot with a newer tab-local baseline. Property-order differences alone do not cause a conflict.

## Deployed browser checks
Initial integrated deployment: `dpl_4P7kP2LmTLv8sEPW9bcCe2XUURJa`.
1. Opened the stable Vercel website in Chrome and entered the existing private access code through its visible form. No paid model request was used.
2. Created a wholly fictional record, `דמות הדגמה — תיק מתמשך`, with Monday 17:30. Confirmed the form contains only name/code plus optional day/time, no age or fabricated clinical history.
3. Confirmed session 1 started empty, produced a prepared draft from an explicitly fictional note, and approved it.
4. Opened session 2; session 1 remained approved and its two document versions remained available.
5. Opened the immutable deployment URL, a different browser origin with independent local storage. It initially displayed only the three seed records. After private authentication and explicit server-load confirmation, it displayed all four records, the new schedule, both sessions, and the saved first-session content. This verifies server retrieval independent of the original IndexedDB copy; it is not a test on a second physical device.
6. Saved a new session-2 composer note from that context. An edit from the older stable-origin window was rejected with the visible conflict warning and retained in its composer. After explicit recovery, the newer server note was still present; the stale text had not overwritten it.
7. Opened session 1 and its version-history comparison after recovery. Both original and approved versions were present.
8. At a 390px viewport, the new-record button, selectors, database-save indicator, and recurring schedule were visible without horizontal overflow. Image: `persistent-record-mobile.png`.

## Deployed HTTP boundaries
- GET `/api/workspace` without a bearer token: 401 `access_required`, `Cache-Control: no-store`.
- Preflight from the GitHub Pages origin: 204, exact allowed origin and GET/PUT/OPTIONS.
- Preflight from an unapproved origin: 403, no allow-origin header.

## Review repairs before final publication
The reviewer found a possible stale local snapshot after another tab had advanced its baseline. Reconnect no longer automatically uploads any differing local snapshot. A signature/editor-state recheck after asynchronous local backup prevents new edits or a model response being replaced during server adoption. Connection generations ignore superseded reads. Separate per-page recovery copies preserve unsynchronized edits so another tab cannot overwrite their only local disk copy.

## Final client recovery verification
Deployment `dpl_2s7RKnWV24kbLgcTjQroUAitih9V` includes the reviewed reconnect logic and recovery UI. Reloaded the stable site, entered the existing private code again, and confirmed the saved record remained available. Advanced the server from the second context and attempted a stale edit in the final client. The save was blocked. `אפשרויות הדמו → עותקים מקומיים לשחזור` displayed an independent recovery copy with four records and sixteen sessions. Its download produced a 736,400-byte JSON file; passing that actual downloaded file through `importState` validated four fictional records, sixteen sessions, eighty-one document versions, and the unique unsynchronized composer marker. Nothing was sent to a paid model during these extension checks.

## Remaining release gates at this checkpoint
Verify the separate recovery-copy UI, final deployment/reload, public GitHub Pages flow, and paired updated handbook HTML/PDF. Record final results below; do not treat this checkpoint as completion.

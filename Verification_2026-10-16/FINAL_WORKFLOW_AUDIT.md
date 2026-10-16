# Final workflow audit

Date: 2026-10-16. Reviewed commit: `122f30c`.

The original read-only audit below reviewed the React application at commit `122f30c` and identified four actionable findings. It is retained as historical evidence; the implementation update below supersedes its remaining-work status. The existing conflict, provenance, and staged-approval checks provide meaningful protection; the passing unit suite does not cover the React sequences below.


## Implementation update — server-only persistence, 2026-10-16

The user explicitly changed the persistence requirement during the repair: all automatic persistence must be on the server. This supersedes the proposed local-quarantine solution in F1. No legacy browser snapshots were opened, migrated, erased, or replaced.

Implemented in the shared working tree:

- **F1 resolved at both boundaries:** the domain now validates direct-edit text, individual intake values and the complete generated source/report before mutation. The UI imports shared `TEXT_LIMITS`, retains rejected editor buffers, and displays length guidance (`Documents.tsx:85–94`, `domain/index.ts:312–330`). All automatic IndexedDB/sessionStorage recovery/loading/writing was removed, so an unreadable browser snapshot can no longer trigger a fixture overwrite. Removed `storage.ts`, `recovery-storage.ts`, `RecoveryCopies.tsx`, their obsolete recovery test and the `idb` dependency. Existing browser bytes are deliberately untouched.
- **F2 resolved:** `App.tsx:285–327` distinguishes an actual 401 from GET/network/validation failures. A valid login survives non-auth failures. Initial loading shows retry without exposing fixture editors; an already opened workspace retains its authenticated shell, memory state and explicit export/reconnect controls. A fresh server-empty workspace must receive its first successful PUT acknowledgement before editing (`App.tsx:256–283,428–430`).
- **F3 resolved:** `document-editing.ts` caches the exact base version ID, including an explicitly absent version. Save passes this base to the domain's atomic version check. A stale editor retains its text, blocks Save and offers copy/reopen guidance. History remains readable, while Restore and legacy proposal acceptance are disabled during editing (`Documents.tsx:23–24,60,92–105,118–119`).
- **F4 resolved:** cancellation and request failure call `rollbackExpansion` with the captured prior session and expected revision (`App.tsx:114–122,221`; domain helper at `domain/index.ts:268`). The helper restores approvability only while no content/result/editor/preference/base changes invalidate it. Session revision and consumed expansion round remain monotonic; a later expansion gets a fresh server-counter round.
- Skip now records only “אבקש לדלג על השאלה הזו.” Model errors, expiry and cancellation no longer imply that in-memory text has already received a durable save acknowledgement.

Server-only behavior:

- Login token, active work, direct editor buffers and last-confirmed baseline live in page memory. No automatic browser storage remains in the reachable application.
- State changes are debounced to the existing serial CAS writer. `נשמר בשרת` is shown only when the acknowledged snapshot matches the current state; an open direct editor has a separate unsaved status. `beforeunload` compares current memory state to the baseline synchronously, including edits made before the next debounce fires.
- Every writer status refreshes the baseline from its last acknowledged snapshot, including an intermediate save followed by a failed newer save. A transient write failure keeps memory work. Reconnect requires an explicit choice if local and server snapshots differ; the safe in-memory-work path rechecks the server baseline and uses its fresh revision. Conflicts never automatically overwrite newer server work.
- Explicit JSON import/export remains user-initiated. Export contains workspace records/conversation, not unfinished direct-editor buffers. The replacement dialog states that adopting server content discards the in-memory copy and blocks replacement while direct editors are open.
- Browser refresh/closure can lose unacknowledged edits. The UI states this and warns before unload; it does not claim a browser backup exists.

Verification executed after these changes:

```text
npm test
14 files passed, 1 skipped; 205 tests passed, 1 skipped.

npm run build
TypeScript and Vite production build passed.
Existing bundle-size and lucide-react module-directive warnings remain.
```

New `document-editing.test.ts` exercises captured bases, stale restore/save rejection, explicit null bases, retained oversize buffers, exact text limit, and save→export→import validity. It also server-renders the actual `DocumentEditor` to confirm the stale warning and disabled Save. New `server-only-workflow.test.ts` exercises non-401/401 classification, failed write/retry, an older save acknowledgement while newer text is still waiting for debounce, synchronous unsaved-work detection, conflict decisions, non-durable error wording, and persistence dependency exclusion. Existing domain `context-integrity.test.ts` tests the rollback helper and preservation of genuine intervening changes.

These tests do not replace participant-view browser verification. Root owns browser QA: initial GET503 then retry, first PUT failure before editor access, reload/login loading server state, normal save acknowledgement, two-window conflict, editor navigation/restore block, cancellation and failure of an empty expansion, and zero case-data writes to browser storage. No live model call or deployment was made by this subagent.

## Independent transport/context review after repairs

Read the current shared codec, workspace API/client, domain/contracts/API-validation diff, context integrity tests and workspace transport tests without editing those implementations. No additional blocking defect was identified in bounded compressed/decoded handling, authentication before payload decoding, strict UTF-8/JSON parsing, write/readback limits, CAS preservation, historical manual-text compatibility, derivative proposal metadata, same-result preference enforcement or guarded expansion rollback.

Executed an additional synthetic integration probe through the actual `readWorkspace` → `WorkspaceSync` → `handleWorkspace` → in-memory fake store → `readWorkspace` path, with an artificial test token and no network calls. Results: first GET revision 0; PUT used `application/vnd.merhav.workspace+gzip`; second GET revision 1; the complete reloaded state matched the original by stable signature. This verifies compatibility of the real API and client transport, independent of their separate mocked unit tests. It does not verify a hosting platform or production database.

## Original findings at 122f30c (historical)

## Scope and verification

Read the current implementation checkpoint, `App.tsx`, `Documents.tsx`, `SessionConversation.tsx`, `ReviewProposal.tsx`, `NewPatient.tsx`, `LoginScreen.tsx`, `CaseWelcome.tsx`, workspace synchronization/choice/guards, local/recovery storage, auth/workspace API and store, relevant domain functions, and their tests.

Executed:

```text
npm exec vitest run -- --root . tests/workspace.test.ts tests/workspace-sync.test.ts tests/workspace-choice.test.ts tests/workflow-guards.test.ts tests/recovery-storage.test.ts tests/staged-records.test.ts
6 test files passed; 63 tests passed.
```

Also executed three in-memory TypeScript probes against the actual exported domain functions, using only `createDemoState()` and synthetic marker text. No production browser, database, credentials, real patient material, deployment, or paid inference was accessed. No application/test code was edited. The root task owns participant-view browser verification; the browser steps below are reproducible scenarios derived from current code, not claims that this audit executed them.

This reviewer previously authored the initial prompt/fixture module, but did not implement the UI/auth/workspace modules under review. This report is not an independent clinical-quality assessment.

## F1 — P1: a direct edit can save a workspace that the application cannot reload

**Evidence:** `apps/web/Documents.tsx:62–66,88,94`; `packages/domain/index.ts:267–286,349,362–374,508`; `packages/domain/storage.ts:8–18`; `apps/web/App.tsx:105–132`.

The direct-edit inputs have no length constraint, and the save path does not validate the resulting archive:

```ts
// Documents.tsx:63
if (!update(previous => editDocument(previous, patientId, branchId, kind,
  kind === 'intake' ? renderIntake(fields) : text,
  kind === 'intake' ? fields : undefined, sessionId))) return;

// storage.ts:14,17
const snapshot = exportState(state);
await db.put('snapshots', snapshot, 'current');
```

However, import/cloud validation limits document/source text to 100,000 characters, individual field values to 30,000, and `remaining` to 5,000. A manually saved source also contains a generated prefix, so constraining only the visible document to 100,000 is insufficient.

**Executed reproduction:** call `editDocument(createDemoState(), patient, branch, 'formulation', 'x'.repeat(100001))`, then `importState(exportState(result))`. The edit succeeds, the latest document contains 100,001 characters, and re-import throws “מבנה הגיבוי אינו תואם לגרסה זו, או שהמידע אינו מסומן כבדיוני.”

**Browser reproduction:** open a direct editor; paste synthetic text above the archive limit; save; observe the success notice/local save; reload. `loadState` rejects the snapshot. `App.tsx:116` then sets `ready=true` while retaining the initial fixture state, and the regular autosave effect writes that fallback to the same `current` slot. Thus this route can replace the unusable local workspace instead of retaining its original bytes for repair. The server correctly rejects the invalid archive, but that does not protect unsynchronized local work.

**Minimal fix:** validate manual-edit values and the complete resulting source/document structure before committing the mutation. Share limits with the editor and show an actionable validation message without discarding its buffer. Separately, a failed local import must preserve the raw snapshot and suspend writes to `current` until recovery/reset is explicitly chosen. Add save→export→reload boundary tests, including generated source prefixes and total rendered intake text.

**Effort:** medium. This is a recoverability issue, not evidence that production data has already been lost.

## F2 — P2: a transient workspace GET failure logs out a valid user and hides local recovery

**Evidence:** `apps/web/App.tsx:303–341,405–413,454–457`; `apps/web/LoginScreen.tsx:31–50`.

`connectCloud` clears the access token for every failure, including database unavailability, a network failure, or an invalid workspace response:

```ts
// App.tsx:335–340
} catch (failure) {
  if (connection !== cloudConnection.current) return;
  setCloudStatus('המאגר לא מחובר');
  setCloudError(/* local work is preserved; retry or export */);
  setToken('');
}

// App.tsx:455
if (!token) return <LoginScreen ... />;
```

The login screen has no local export, recovery-copy, or continue-local action. Each successful credential submission immediately calls the same workspace GET again. While that service remains unavailable, the user is repeatedly returned to login even though the credentials are valid and `stateRef.current` still contains the local work. The error promises an export route that the current screen does not expose.

**Browser reproduction:** log in successfully with fictional local work; make `/api/workspace` GET return a temporary 503 while keeping `/api/access` successful; click “רענון מהמאגר.” The application drops to login. Correct credentials repeat the cycle, and local export/recovery controls remain inaccessible. The same issue occurs on a reload when authentication succeeds but workspace loading fails.

**Minimal fix:** distinguish expired/invalid authentication from workspace availability failures. On a non-401 workspace failure, keep the valid login and expose an explicit local/recovery state with retry and export. Do not silently upload local changes when service returns; retain the existing explicit-choice/CAS protections. A true 401 may still require fresh authentication.

**Effort:** low to medium. No server authorization bypass is recommended.

## F3 — P2: a cached direct editor can overwrite a restored version without detecting its stale base

**Evidence:** `apps/web/Documents.tsx:14,24–29,43,62–65,73,105`; `packages/domain/index.ts:267–281,289–295`.

The editor cache stores only text and fields; it does not retain the version from which editing began:

```ts
const editorDrafts = new Map<string, { text: string; fields: IntakeField[] }>();
useEffect(() => {
  if (!editing) { setText(current?.content || ''); /* ... */ }
}, [current?.id, editing]);
```

Version history remains enabled during editing. Restoring a version updates `current`, but the effect intentionally keeps the cached text while `editing` is true. Saving then calls `editDocument` with no expected base ID. The domain attaches the latest version as `baseVersionId`, even though the buffer was derived from an earlier version.

**Browser reproduction:** begin editing a document and change its text without saving; open Versions; restore another version; close history; save the still-open editor. The older buffer becomes current without a stale-edit warning, and its recorded base is the newly restored version rather than the version actually edited.

**Executed check:** an in-memory sequence using a cached buffer, `restoreVersion`, and `editDocument` accepted the stale save. Output confirmed `cachedTextIsLatest=true` and `newBasePointsToRestored=true`. History is retained, so this is an unintended replacement/misattributed edit base rather than deletion of all versions.

**Minimal fix:** cache a `baseVersionId` with the editor buffer and require it when saving. If the current version changed, offer comparison/rebase instead of silent replacement. At minimum, disallow restore/legacy-proposal acceptance for the same document until its open editor is saved or cancelled. Add an editor-level regression test; existing restore tests only test append-only domain history.

**Effort:** medium.

## F4 — P2: cancelling or failing an optional expansion strands an otherwise approvable draft

**Evidence:** `packages/domain/index.ts:236–242,309–324`; `apps/web/App.tsx:143–145,214–217,243–244,263–265`; `apps/web/ReviewProposal.tsx:40–44,81–83`.

Starting an optional expansion immediately increments the session revision before a model result or new clinician information exists:

```ts
// domain/index.ts:242
return updateSession(state, { ...s, revision: s.revision + 1,
  status: 'asking', intakeActive: true, focusGoal: goal, /* ... */ });

// App.tsx:143–145
function cancel(message = 'ההמתנה בוטלה. הטקסט שכתבת נשמר.') {
  requestRef.current?.controller.abort(); requestRef.current = null;
  setBusy(false); notify(message);
}
```

The pending draft retains its original `reviewRevision`. Cancel and request-error paths do not restore the prior review state. The review panel therefore marks the unchanged proposal stale and disables approval. The visible recovery route is another generated summary, potentially unavailable after a budget/provider failure.

**Executed reproduction:** prepare a valid fictional pending draft, confirm `pendingDraftIsCurrent=true`, then call `startExpansion` without adding any response. The result is `pendingDraftIsCurrent=false` while the entire pending draft, messages, and pending fields are byte-for-byte unchanged; only the workflow revision/focus changed. UI cancellation leaves this state in place.

**Browser reproduction:** produce a proposal; choose an optional expansion; cancel before the question returns (or let the request fail). The original proposal can no longer be approved even though no new clinical content was received.

**Minimal fix:** provide a “return to the previous summary” path when expansion added no clinician message, field/preference update, document mutation, or accepted model output. Either defer review invalidation until meaningful new content arrives or roll back only the empty expansion transition using its captured baseline. Never relax stale checks when real intervening changes exist. Test cancellation, network rejection, and budget rejection separately.

**Effort:** medium.

## Coverage that held up

- Workspace writes use expected-revision compare-and-swap; stale responses and 409 conflicts pause rather than silently overwrite server content. Tests exercise concurrency and uncertain acknowledgements.
- Cloud adoption preserves a previous local snapshot and checks for intervening local/editor changes; reconnecting differing content requires an explicit choice.
- Model responses are gated by request identity, selected session, and a revision/version/preference stamp before application (`App.tsx:234–239`).
- Pending AI approval checks the exact pending draft, effective preferences, and all five document bases. The review UI additionally blocks unsent composer text and open direct editors.
- New-patient creation validates name and optional weekday/time, starts session 1, and records the recurring schedule as planning metadata rather than a completed appointment. No concrete schedule parsing defect was found in this review.
- Restore appends a new version and retains prior versions. The issue in F3 concerns the editor buffer around that operation, not the append-only history mechanism itself.

## Limits and handoff

The 63 executed tests cover domain/API/controller behavior with fictional fixtures and mocked network/storage dependencies; they do not exercise the React screens. This audit did not establish visual behavior, accessibility, real Neon availability, or live model fidelity. Root browser QA should execute F2–F4 and the safe synthetic version of F1 against an isolated local fixture workspace, not the shared saved workspace.

Do not treat green unit tests as final UI sign-off. The code has substantive safeguards, but save/reload validity and the three recovery transitions above still need repair or explicit product decisions.

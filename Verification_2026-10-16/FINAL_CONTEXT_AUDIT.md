# Final independent context audit — 2026-10-16

Audited commit: `122f30c4acac4ce91a43cefc18a576e41ecd32d4`. The initial audit was read-only apart from this report. The root agent subsequently assigned implementation of the domain/contracts/API fixes; see the resolution section below. Reproductions used the repository's explicitly fictional fixtures and artificial marker strings. No credentials, `.env`, `.local`, real clinical material, paid inference, or deployments were accessed.

## Implementation follow-up — 2026-10-16

**F1 resolved in the working tree:** intake restores clear the pending patches for restored fields before invalidating review. A regression covers restore, regeneration with no new patches, approval, and archive roundtrip.

**F2 resolved in the working tree:** shared `TEXT_LIMITS` are exported from `packages/contracts/index.ts`: source/document 100,000; field value 30,000; field remaining 5,000; direct free-text document 99,900 (attribution allowance); chat message 16,000. Complete generated manual source and intake report lengths are checked before mutation. API context accepts storage-valid historical manual text and fields; live model output retains the tighter 30,000-document / 5,000-field / 2,000-remaining limits. No source truncation was introduced. Regressions cover both original size failures, rejection without mutation, and cumulative AI intake rendering beyond the archive limit.

**F3 trigger prevented at the domain boundary:** a direct edit cannot create the demonstrated overlong source. The later explicit user instruction requires server-only persistence; a separate UI worker is removing automatic browser persistence. That integration and browser verification are outside this worker's final sign-off. No local recovery feature was implemented by this worker.

Other assigned fixes implemented:

- `editDocument(..., sessionId?, expectedBaseVersionId?: string | null)` atomically rejects stale editor saves. Omission keeps existing caller compatibility; `null` requires no current version.
- Context documents include `author`, `approved`, `createdAt`, and `reason`; historical trace/context schemas keep them optional. `workingDraftMetadata` includes `draftId`, `createdAt`, `reviewRevision`, `baseVersionIds`, `stale`, and literal `derivative: true`. Summary and rationale remain available as relative edit targets. Historical imports without metadata remain valid.
- `DraftResult.preferenceUpdates` is optional for stored historical results and required for new live output. Provider schema uses nullable `goal`, normalized like turn output. `saveDraft()` applies preferences before rendering intake and taking the preference snapshot; duplicate effective preferences are not appended again. API validation uses old plus same-result preferences for exclusions and blocked follow-up invitations.
- `rollbackExpansion(state, sessionId, expectedRevision, previousSession)` restores untouched expansion workflow state after cancellation/failure. It requires matching ownership, expected revision/round, and unchanged messages, patches, proposal, archive, traces, composer, skips, and question count. Revision and expansion round remain monotonic, preventing reuse of durable server counter identifiers. The prior proposal becomes approvable only when its original review, current document bases, and effective preferences still match. A model response or intervening unsent edit prevents rollback.
- Domain guards now reject collection growth beyond archive capacities for session creation, source/message additions, branches, preferences, direct editing, restore, legacy proposal acceptance, and legacy approval. Full rendered AI intake output is checked before saving. Existing broader body, context, and budget bounds still apply.

Implementation verification: **TypeScript passed; 134 tests passed across 7 focused files**, including the new `tests/context-integrity.test.ts`. `git diff --check` passed for the owned files. No browser, provider, deployment, database, or full-suite claim is made here; root owns final integration verification. Code ownership for this follow-up: `packages/contracts/index.ts`, `packages/domain/index.ts`, `apps/api/validation.ts`, relevant domain/API tests, and this report. No other agent's edits were reverted.

The findings below retain their original evidence and line references at audited commit `122f30c`; those line numbers changed during implementation.

## Findings

### F1 — P2: restoring an intake version does not supersede pending AI field updates

**Evidence:** `packages/domain/index.ts:289–295` restores the full selected version and invalidates session revisions, but leaves `Session.pendingFields` unchanged. `saveDraft()` subsequently overlays those patches on the restored intake at `packages/domain/index.ts:258–259`. The direct-edit path already removes patches for manually changed fields at `packages/domain/index.ts:282–285`; restore has no equivalent.

**Executed reproduction:** create fictional Tamar session 5; apply a turn with field 5 set to `PENDING AI VALUE`; save a proposal; restore a saved intake version whose field 5 has a different value; regenerate a proposal with **no field updates from the new result**.

Observed:

```text
After restore: current saved field = original field value
After restore: pending field = PENDING AI VALUE
After regeneration with fieldUpdates: []: proposed field = PENDING AI VALUE
```

The restored document itself stays in history and is not silently mutated. The defect is deterministic reintroduction of the superseded patch into the next review proposal, without a new model change. Approval can then carry that value back into the current record. The current passing test for direct edits in `tests/staged-records.test.ts` does not exercise restore.

**Minimal fix:** when restoring an intake version, remove pending field patches superseded by that explicit restore, using a shared helper with the direct-edit path. A full intake restore is an explicit selection of all restored fields, so define whether it clears all 32 pending patches or all fields whose current/proposed values differ. Preserve the old proposal in its archive and keep the revision/base checks. Add a regression in which the new result has `fieldUpdates: []` and the restored values survive regeneration and approval.

### F2 — P2: accepted direct edits can permanently make that branch's model context invalid

**Evidence:** direct text editors have no length bound (`apps/web/Documents.tsx:88,94`); `editDocument()` adds a manual source without validating the request limits (`packages/domain/index.ts:267–281`). Every eligible historical source remains in subsequent context (`packages/domain/index.ts:156–160`). The live schema limits source text to 16,000 characters and field values to 5,000 (`apps/api/validation.ts:11,14–15,26–28`), while the archive accepts source text up to 100,000 and field values up to 30,000 (`packages/domain/index.ts:349,362–363`).

**Executed reproduction A:** save a 16,000-character direct note. The generated manual source is **16,029 characters**, because the domain prepends its attribution. Export/import roundtrip succeeds. `validateRequest()` rejects the resulting draft request with `invalid_request`. Save a shorter replacement note; the same rejection persists because the earlier oversized source is still included. This is not a budget rejection and changing models cannot remedy it.

**Executed reproduction B:** save a direct intake edit containing a 5,001-character field value. The complete manual source is only **8,623 characters**, and archive roundtrip succeeds, but `requestSchema` rejects `context.documents[1].fields[4].value` against its 5,000-character maximum.

**Impact:** an ordinary accepted editor save can disable future model work in this branch while the application continues to present the saved record as valid. The error identifies a generic invalid context; there is no UI operation to shorten an immutable historical source. The user cannot repair this by merely correcting the current document.

**Minimal fix:** use shared, explicit bounds for manual input, generated source text, stored fields, and model context, including attribution overhead. Either permit archive-supported manual text in the live context under the existing total byte/window/cost guards, or block an incompatible edit before saving and explain the exact limit. Existing archives need a non-destructive compatibility path; silently truncating or deleting historical sources would violate the current provenance contract. Add regression coverage for both examples and for a short later edit following an oversized historical source.

### F3 — P1: a locally saved invalid snapshot can be replaced by the initial demo on reload

This is a persistence consequence discovered while testing growth boundaries. The invalid-state creation and rejection were executed; the reload/overwrite sequence below is established from code and **was not exercised in a browser by this reviewer**.

**Evidence and executed trigger:** `editDocument()` accepts a direct note of 100,000 characters, generating a 100,029-character source. The entire exported snapshot was only **443,084 bytes**. `importState(exportState(state))` rejects it because source text exceeds the archive's 100,000-character limit at `packages/domain/index.ts:362`. Thus normal domain mutation can produce a state that its own loader rejects.

`persistState()` writes JSON without validating it (`packages/domain/storage.ts:13–18`). On the next load, `loadState()` passes that JSON to `importState()` (`packages/domain/storage.ts:8–10`). In `apps/web/App.tsx:105–116`, rejection leaves `state` at the initial demo and still calls `setReady(true)`. The save effect at `apps/web/App.tsx:120–132` consequently writes that initial state after 450 ms. It does not preserve the rejected raw snapshot before doing so.

**Impact:** the local snapshot can be overwritten after an accepted large edit and reload. The cloud save rejects the invalid state, but that does not make local overwriting safe; local-only changes may be the very content needing recovery. This is distinct from the documented 3 MB cloud capacity limit.

**Minimal fix:** a failed local load must never activate writing to the same snapshot key until the original bytes are preserved and the user deliberately chooses a replacement/recovery action. Reject invalid mutations before persistence as a second layer. A browser regression should place an intentionally invalid fictional snapshot in an isolated test origin, reload, and verify byte-for-byte retention after the autosave interval and a visible recovery route. Do not run that destructive reproduction against the user's active origin.

## Additional context and provenance observations

These are verified structural limitations, not claims that a live model failed during this audit.

- `buildContext()` projects stored documents to kind/version/content/citations/fields at `packages/domain/index.ts:164–166`, dropping `author`, `approved`, `createdAt`, and `reason`. The prompt asks the model to preserve wording directly edited by the clinician (`packages/prompts/index.ts`, revision/evidence sections), but the model does not receive an explicit document-level author/approval marker. Restore is especially relevant: `restoreVersion()` marks the new version as clinician-authored while retaining old source references, so source kinds alone cannot reliably reveal the clinician's restore choice. Adding `author`, `approved`, and `createdAt` is a small, useful provenance improvement. `reason` is optional if the system needs to distinguish restore from direct edit. These metadata belong in data, not system instruction text.
- A pending AI draft remains available in context after a later direct edit, even though its review revision is stale. The context has the updated stored document and the older `workingDraft`, but no draft timestamp or explicit stale/base comparison. An explicit comparison would allow the model to prioritize the clinician's later edit without inferring chronology from prose. The approval guard correctly blocks direct approval of the old proposal.
- `workingDraft` is currently a complete `DraftResult`, including its AI `summary` and `rationale`. Omitting those two explanatory fields from the **model-facing projection only** is compatible with keeping the actual documents and patches for rewriting; preserve the complete proposal in the archive. If implemented, update the wire/context type and import/trace validation, because `rationale` is currently required by the draft schema. This audit did not test whether omission improves live fidelity.
- Citation membership is checked, but citation entailment is not. A model can structurally cite an existing source without faithfully representing it; the handbook explicitly discloses this. This audit does not label the absence of a semantic entailment engine as a new defect.

## Reviewed behavior that held

The current implementation and passing regression tests support the following narrower conclusions:

- `buildContext()` checks the patient, permitted branch ancestry, session ceiling, and time cutoffs; nested branches inherit the earlier ancestor cutoff. Historical sessions do not receive later retrospective sources simply because the described event happened earlier.
- Current session messages are time filtered. AI mutation of a session with a later session is blocked and requires a new branch.
- Pending AI fields and the current proposal are local to their session and do not become cumulative documents merely by autosave. Raw clinician sources may carry forward before approval, as explicitly documented.
- New AI approval is an atomic append of five document versions. It checks the current proposal ID, conversation revision, effective preference snapshot, and current document bases. Direct edits invalidate stale proposals. Open-editor and unsent-text guards are also present in the UI.
- The intake report is generated from the 32-field ledger, not the model's free-form intake body. Missing fields remain visible. Rendering exclusions preserves the source ledger. This establishes structural coverage, not clinical accuracy or completeness.
- `compactModelContext()` removes only an exact deterministic intake-rendering suffix and duplicate field patches; it does not truncate raw sources or messages. The existing tests verify nonmutation, custom prose preservation, and idempotence.
- Provider preparation preserves the input, bounds the request using UTF-8 bytes and framing margin, reserves output/reasoning allowance, and rejects before inference when the current cap or context window is insufficient. This audit did not query live catalogue prices or make inference requests.

## Growth boundaries

The model-request schema currently permits at most 200 sources, 80 messages, 50 effective preferences, 50 skipped topics, and 20 branch-scope entries, with the per-text limits described above. `MAX_MODEL_REQUEST_BYTES` is 600,000. The archive has larger independent bounds (including 10,000 sources, 500 messages/session, 200 traces/session, 100 draft-history entries/session, 10,000 versions, 300 branches, and 2,000 sessions); workspace PUT is separately bounded at 3,000,000 bytes.

An artificial isolated count probe confirmed that a context with 201 sources is rejected even when source bodies are one character. This is an explicitly bounded demo without archive retrieval/compaction; the existence of a finite limit is not itself a finding. However, the different accepted-text limits in F2 and invalid local-state handling in F3 are actionable defects. Several mutators also do not preflight the archive's collection limits (`createSession`, `forkBranch`, `editDocument`, restore and legacy approval); therefore export/import validity should be preserved at mutation boundaries instead of relying solely on rejection when reopening. Exhaustive maximum-count UI testing was not performed.

## Verification performed

Command:

```text
npm test -- tests/domain.test.ts tests/staged-records.test.ts tests/context-budget.test.ts tests/api.test.ts tests/api-budget.test.ts tests/prompts.test.ts tests/prompt-behavior.test.ts tests/workflow-guards.test.ts
```

Result: **125 tests passed, 1 skipped; 7 files passed, 1 skipped.** The skipped file is the optional live public-catalogue check. All added reproductions ran in memory through `node --import tsx --input-type=module`; no fixture or application source was modified. The first attempted reproduction used TypeScript annotations in stdin and failed before execution; it was rerun as JavaScript and produced the results recorded above.

Reviewed source: domain context/mutation/import/export code; contracts; intake schema/report generation; prompt composition and working-memory instructions; API validation, handler, provider preparation; relevant test suites; document editor, proposal, conversation and request flow; storage load/save path; current checkpoint; relevant present-state handbook sections and module READMEs.

Unreviewed limits: no live model behavior, paid API, deployed server/database/Redis execution, browser execution, actual stored workspace, accessibility/rendering, or complete persistence concurrency review. Existing release evidence was read as background, not independently reverified. No finding here asserts access to real patient data or production readiness.

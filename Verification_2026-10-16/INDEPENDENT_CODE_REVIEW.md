# Independent code review — live clinician workflow

Date: 2026-10-16. Scope: current uncommitted live update, followed by the two focused repairs authorized by the root agent. No secrets, remote records, paid model calls, or files outside the repository were used. Local probes used the explicitly fictional fixtures.

## Result

Two P2 workflow defects were reproduced from the actual source and repaired. The focused tests and TypeScript check pass. Browser verification of these repaired interactions remains part of the root agent's final user-flow check; this report is not browser evidence.

### P2 — creating the next session stranded an unapproved summary

**Trigger:** prepare a summary in session N, open a new session using the header button, then return to N to approve it.

**Evidence:** the prior new-session handler created N+1 unconditionally. `pendingDraftIsCurrent` then returned false and `approveSession` rejected N as historical. The UI also disabled both conversation and approval for historical sessions. A local fixture probe returned `true` before new-session creation, `false` afterward, and the explicit historical-session error on approval. No UI action could delete the newly created session or finish the previous proposal.

**Current repair:** `apps/web/workflow-guards.ts` identifies unfinished work. `apps/web/App.tsx:162` routes the case welcome to it; `App.tsx:495` explains why the next session cannot yet open and provides a continuation action. The final create handler checks the current state again. A saved direct edit of a historical note does not incorrectly block the next session merely because that old note has status `draft`. An existing historical pending draft/composer remains visible as unfinished work; the repair prevents creating new instances but does not rewrite existing records.

### P2 — expired authentication could not resume connected local work

**Trigger:** a clinician sends a message after the authentication token expires. The message is already in local state, but neither the model request nor the cloud save can complete. Sign in again while the server still contains this tab's last confirmed baseline.

**Evidence:** `chooseWorkspaceAction(localWithNewMessage, unchangedRemote, baseline)` correctly returns `choose` under the existing shared-IndexedDB safeguard. The old dialog offered only adoption of the remote copy or disconnected local work. Both paths cleared the pending model request. Thus neither fulfilled the UI promise to continue the same operation after sign-in.

**Current repair:** the generic chooser and its shared-storage safeguards remain unchanged. `App.tsx:315` records whether the known baseline still matches the remote copy. The dialog at `App.tsx:439` offers an explicit “continue with this work and save it in the database” action only in that case. `reconnectLocalChoice` at `App.tsx:371` reads the server again, compares it to that baseline, and connects using the freshly read revision. An intervening server change removes that option; a change after the read is still rejected by the existing server compare-and-swap. The unchanged in-memory state and selection then pass through the existing pending-action stamp checks. Adopting a different remote copy instead explains that the previous model request was not resent (`App.tsx:430`).

## Other inspected protections

- Login calls the strict username/password endpoint and waits for workspace opening or an explicit reconciliation choice before rendering the working interface.
- Model results are checked against the request identity, selected session, session revision, document versions, and preferences before application.
- Approval requires the displayed pending draft ID, unchanged revision/document bases/preferences, no unsent composer content, no active request, and no unsaved direct document edits.
- API authentication uses expiring signed tokens and verifies the configured credential identity. Access attempts use quota storage; raw credentials are not returned by these routes.
- Workspace persistence validates the complete archive and uses an atomic expected-revision update. The client serializes saves and pauses on conflicts or authentication failures.
- Proposed documents and extracted intake fields remain staged until approval; direct document saves remain explicit separate actions.

## Verification executed

```text
npx vitest run tests/workflow-guards.test.ts tests/workspace-choice.test.ts --root .
2 test files passed; 11 tests passed.

npx tsc --noEmit
Exit code 0.
```

The five new helper tests cover unfinished current work, historical manual edits, patient/branch separation, unchanged versus changed server baseline, and missing baseline. The existing six workspace-choice tests still pass, including the deliberate refusal to automatically overwrite a different local/remote snapshot even when the remote matches the saved baseline.

## Handoff checks

- Exercise expired-login continuation and remote-changed rejection in the browser.
- Exercise opening the next session with a pending summary, then approve and open the next session.
- Include the new helper source in the handbook/source-manifest inventory if that inventory lists individual files.
- The broader context review should assess request growth: the model route bounds the HTTP body at 100 KB while context includes raw sources, messages, existing documents, and an additional working draft. This report did not change those limits or run a paid capacity trial.

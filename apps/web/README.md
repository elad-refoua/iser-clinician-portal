# מרווח frontend

React/TypeScript, Hebrew RTL, entirely fictional adults and sessions. The root README contains independent installation instructions; the Hebrew handbook explains operation and architecture.

## Entry and configuration

Vite's root is apps/web. VITE_API_URL is the public API origin, with same-origin /api when absent. PAGES_BASE is supplied to the root Vite configuration. Handbook links use import.meta.env.BASE_URL.

LoginScreen gates the complete interface. POST /api/access accepts strict {username, password} and returns a one-hour bearer token kept in page memory. The username defaults to elad; the private password is never committed. Login opens the shared workspace before presenting the case overview, with explicit reconciliation when local and remote work differ. Neon, Redis and authentication are required for the full flow. Provider/database credentials never reach the browser.

## Interface and ownership

| File | Responsibility |
|---|---|
| App.tsx | State, selection, live requests, login/workspace lifecycle, approval, settings, preferences and import/export |
| SessionConversation.tsx, chat-workflow.css | Quiet invitation, messages, single composer, request/cancel/error states |
| ReviewProposal.tsx | AI summary, full note, expandable cumulative documents, sources, optional expansion and approval |
| Documents.tsx, patient-portal.css | Patient portal, session history, five document tabs, direct editing, sources, versions, restore and proposal archive |
| LoginScreen.tsx, login.css | Private login, visibility control, busy/errors and fictional-data notice |
| CaseWelcome.tsx | Overview from stored material, continue/start choices and new-record entry |
| ResponseExplainer.tsx, experience-model.ts | On-demand explanation; input context versus output citations; model versus policy/history |
| NewPatient.tsx | Name/code and optional weekly day/time; separate root and empty session 1 |
| workspace-sync.ts, workspace-choice.ts | Validated reads, serial saves and explicit reconciliation |
| workflow-guards.ts | Unfinished-session guard and same-baseline reconnect check |
| RecoveryCopies.tsx | List/download isolated page-writer recovery snapshots |
| Backstage.tsx | Architecture, exact prompts/context/results, authored instruction examples, handbook/PDF |
| ui.tsx | Dialogs, document renderer, copy and source viewer |

Domain code owns context selection, provenance, versions and branch/time rules. The interface imports the server's prompt builder. Historical prepared traces remain labeled; new conversation has no prepared mode or fallback.

## Conversation and approval

After choosing a patient/session, the clinician sees one writing invitation. Enter sends; Shift+Enter inserts a newline. Each send requests a real model turn. Questions resolve one concrete gap grounded in the latest contribution and existing context. Zero to three main questions are permitted. Skipping, stopping or requesting a summary does not require filling fields.

A turn returning action=draft triggers a separate draft request. A deliberate summary/revision can directly request the draft. There is no automatic paid retry or model switch. Failed operations preserve contributions and expose a controlled error with an explicit next action.

The result is a pending proposal: five documents, sparse intake patches, a summary and optional follow-ups. Intake is rendered from 32 structured fields. applyTurn stages fields; saveDraft stages the proposal. Neither changes saved documents. A new proposal archives its predecessor.

approveSession atomically creates five full document versions. Approval checks the pending ID, session revision, document bases and preferences. UI guards also block approval during a request, with unsent composer text, on historical sessions or while any direct editor is open. The archive records approval time and version IDs. A stale proposal must be regenerated, not silently rebased.

Optional expansion is explicit, names a focusGoal and allows up to two questions per round. Main counters and topic blocks persist. Session 4 can receive an intake reminder; session 5 always has the full report structure with honest missing states. These are documentation aids, not treatment recommendations.

The next session cannot open while current conversation/proposal work is unfinished. A saved late manual correction to a historical note alone does not block it. New-record creation requires only a fictional name/code and optional day/time, with no calendar event creation.

## Patient portal and editing

The portal is always available outside chat. It shows session notes, cumulative intake/formulation/learning/supervision, full sources, version history and archived proposals. Inherited versions remain readable; restoration is restricted to the active branch, while direct editing creates a new active-branch version.

Direct editors use an observable page-memory cache: navigation retains the edit and approval detects it. Save creates a manual source and full version. Cancel discards that unsaved edit. Reload can lose an unsaved editor buffer, as stated in the UI. Composer text belongs to persisted session state. Export includes saved versions and conversations, not unfinished editor buffers or credentials.

## Context and persistence

buildContext filters by patient, branch ancestry, session and recorded-time cutoff. Pending AI documents/fields remain working memory for the active session, not approved facts elsewhere. Clinician text remains an attributed report. compactModelContext removes exact duplicated intake rendering only when structured fields preserve the same information; it preserves original sources, messages, custom prose and stored records. The 600,000-byte transport cap, provider context limit and cost cap still apply.

Responses return effectiveContext after server counter adjustments; traces save it as server-origin context. Older client-origin traces remain labeled. A source in input is not proof of use; citations require semantic review. rationale is a short explanation, not hidden reasoning.

State saves to IndexedDB after a 450 ms debounce with serialized writes. Connected changes queue to the workspace API with expectedRevision. נשמר במאגר means the latest snapshot received acknowledgement. The server holds one complete current snapshot including version/proposal histories, not every previous snapshot. Workspace bodies are capped at 3,000,000 bytes.

Reconnect compares the remote, local work and this tab's confirmed baseline. Empty/equal states connect; clean local work can adopt newer remote state after a recovery copy. Divergence requires choice. If the remote still equals this tab's baseline, the user can explicitly continue and save local work; the remote is reread before reconnect, and compare-and-swap guards the write. Offline work is not silently merged/uploaded.

An expired model operation retains its action and state stamp. It resumes after login/reconciliation only if selection, sources, versions and preferences still match. Adopting another remote copy cancels that continuation with an explanation. Cancellation stops the browser wait, not necessarily billing.

Cloud conflict/expiry/failure pauses writes and stores a page-specific recovery copy. Further changes update it; another tab cannot overwrite its key. Settings export recovery copies without replacing state. before-cloud-load retains the prior snapshot before remote adoption. Neither is an external backup. JSON import/reset require confirmation and replace connected remote state too.

## Verification

Tests cover approval, scope, budget projection, reconciliation and stale-result guards on fictional fixtures. They do not prove browser behavior or clinical accuracy. Observations and review limits belong in Verification_2026-10-16/LIVE_FLOW_CHECKS.md and handbook release evidence. Backstage instruction examples are authored comparisons, not live experiments.

Saved manual note edits can be approved through the portal without a new model call. The action is unavailable while any editor is open or the session contains a pending AI proposal, pending fields or unsent composer text. The handler rechecks the exact saved note version before approval.

# SDD ledger — plan: Planning_2026-10-16/MASTER_PLAN_HE.md

User approved implementation, Vercel project creation, live fictional OpenRouter testing and publication under the updated plan on 2026-10-16. Secrets entered privately by user.

## Ownership and interface review

| Task | Owner | Produces / consumes | Review |
|---|---|---|---|
| Domain, persistence, versions | Root | Shared contracts and domain functions -> frontend | Root freezes contracts before worker dispatch; domain interface documented below |
| Prompts and fictional fixtures | Prompt worker | contracts -> prompts, fixture state, prepared responses | No real patient data; prepared answers labeled; prompt module shared by API/UI |
| Frontend | UI worker | domain + prompts + fixtures -> React UI | Direct editing outside sessions, session-first flow, full history required |
| API | Backend worker | contracts + prompts -> validated API responses | Shared durable quotas required; no in-memory production quota fallback |
| Integration and deploy | Root | all above -> GitHub Pages + Vercel | Test as user in browser, no secret output |

Ruling: use root npm workspace layout with Vite root apps/web and API endpoints at root api/ importing apps/api/. This enables Vercel to compile shared packages without a separate package installation. Keep public frontend on GitHub Pages; Vercel may serve same build for preview testing.

Ruling: user acceptance authorizes project/repo creation, deployment and fictional test calls within $10 total/$2 daily budget. Do not wait for repetitive approval.

Vercel project created: iser-clinician-api / prj_6xwSpHBFHPmQiszhGJLaJ1acDv9l / team_FGTl0ktl7OD7KCf66wNKuqu1 / elad-refouas-projects.
User confirmed key saved. `vercel env ls production` verified OPENROUTER_API_KEY exists as Encrypted; value not read. Upstash `iser-demo-quota` provisioned on Free with autoUpgrade=false, connected to Production after user's terms acceptance. Actual REST env names are KV_REST_API_URL / KV_REST_API_TOKEN.

Continuity entry point: [CONTINUE_HERE.md](CONTINUE_HERE.md). User requires continuously maintained documentation plus an in-site operating handbook and companion Hebrew PDF generated from the same source. Final review must cover clinician use and adopter setup/use, with browser verification and repairs.

## Domain API (root-owned packages/domain/index.ts)

- createSession(state, patientId, branchId, number): {state, session}
- addUserMessage(state, sessionId, text): PortalState
- buildContext(state, sessionId, stage?): ContextPacket
- applyTurn(state, sessionId, baseRevision, result): PortalState
- saveDraft(state, sessionId, baseRevision, result): PortalState
- editDocument(state, patientId, branchId, kind, content, fields?, sessionId?): PortalState
- restoreVersion(state, versionId): PortalState
- approveSession(state, sessionId): PortalState
- currentVersion(state, patientId, branchId, kind, sessionId?): DocumentVersion | undefined
- forkBranch(state, sessionId, name): {state, branch}
- exportState(state): string; importState(json): PortalState
- loadState(fallback): Promise<PortalState>; persistState(state): Promise<void> (packages/domain/storage.ts)
- intakeFields metadata / intakeSections / emptyIntakeFields / renderIntake exported by domain

Frontend should own mode, API token in memory, selected patient/branch/session, loading/error states. State mutations are immutable. Root will supply above functions; do not redefine.

## Integration checkpoint — 2026-10-16 12:14 local

- Implemented React frontend, modular prompts, 3 fictional cases/12 past sessions/60 seed versions, domain/IndexedDB, Vercel API and Redis quotas. All implementation files exist.
- Initial integration: 54 automated tests pass, one public-catalog opt-in test skipped; typecheck/build pass locally. Independent review found time-cutoff, historical intake base, report-exclusion and preference inheritance gaps; repairs and regression tests in progress.
- Created public GitHub repository `elad-refoua/iser-clinician-portal`; remote origin configured. No push/Pages deployment yet.
- Vercel first deployment served frontend but API had extensionless ESM import failure. Fixed prompts/intake-schema import to .js. Second attempt caught concurrent contract edit at build; corrected before third deploy. Third deployment healthy: `/api/models` returns liveReady=true, all3 models available, provider/access/quota readiness=true.
- Vercel Function transpilation emitted TS2688 type diagnostics even with successful frontend typecheck. Runtime API readiness passed; clean deployment diagnostic fix remains to examine.
- Production browser: prepared free-text input -> immediate draft after explicit lack of recall -> note shown, saved locally. Observed transition incorrectly labeled question0; local fix removes counter outside asking state.
- Local dev blank screen resolved after restarting dependency optimization (`npm run dev -- --force`) following npm dependency changes. Further browser flow verification continues.
- Live browser access test started using temporary QA access code (never provider key); code will be rotated after verification. Production secret values never printed.
- Companion handbook worker owns docs/handbook, build script, public HTML/PDF; generated from same source/imported actual prompts. Domain repair worker owns domain/contracts/regression tests; root owns integration/UI/API fixes.

### Continued release verification
Live Sonnet reached 200 after provider-schema portability fix; compound question identified, v.3 prompt and strict conjunction guard added. Four independent domain findings assigned for repair. Companion guide built and visually checked; adopter walkthrough active. Dependencies now include Puppeteer; final regenerated guide awaits stable source and evidence.

## Release checkpoint — 12:40 local
79 tests pass; TypeScript/build pass. Prompt .3 deployed. All three models passed live turn AND five-document draft. Sonnet clinician browser flow passed, including supervision separation and complete-format intake with missing fields. Browser export downloaded and preserved as fictional evidence. Historical branch showed only sessions1–2. UI historical paid-call preflight fixed locally for next deployment. Adopter clean-copy build in progress; Pages pending publication.

## Public release check — 12:54 local
GitHub commit 0393251 published to main; Actions 38882146228 succeeded. Public Pages loaded as a new user. Mobile 390px layout showed no horizontal overflow. Clean adopter installation and build passed. A Gemini v3 field citation gap was addressed in prompt v4 and a new live five-document draft was reviewed without an additional substantive blocker. Access code rotated via CLI into ignored .local/Access_2026-10-16/code.txt and ACCESS.md. Backup/reset now uses an in-page confirmation with an export option after native browser dialog automation stalled.


## Final verification checkpoint
Commit 17bf6ac deployed successfully on GitHub Pages (Actions 38883072049) and Vercel. The private release code authenticated successfully through the actual Pages interface. Import of the browser-exported fictional backup completed through the new confirmation modal and restored its content. Optional intake question 1 followed by skip returned gently to a draft. Final tests initially discovered the ignored clean-copy tests too; explicit vitest.config.ts discovery now reports the correct 79 passing tests and one opt-in skip. TypeScript and production build pass. Handbook edition .2 is being regenerated from prompt .4 and the verified release evidence. No further user input is needed.

The final companion handbook contains 37 A4 pages, edition 2026-10-16.2 and prompt 2026-10-16.4. All pages were rendered and visually screened, with detailed samples and no out-of-page text bounds. Three source text files were normalized to LF before the final paired rebuild so the recorded source hashes remain reproducible from Git clones. No patient data or secrets are included.

## Release delivered — 2026-10-16
Product and matched handbook published in commit 9edba49. Pages Actions 38884374843 succeeded; Vercel deployment dpl_DCFM5gATAjfRHkiD3asVhu7uuFyz is READY. All four public handbook URLs return 200 and exactly match the manifest. Actual Chrome user view shows handbook .2 / prompt .4. The public PDF link downloaded a file whose SHA-256 matches the published 37-page PDF. CONTINUE_HERE now records the completed release instead of an outdated task list. Private access instructions remain local and ignored. No further user input is needed for the prototype.

## New records and durable storage extension — 2026-10-16
User confirmed minimal new-record fields (name/code, optional regular day/time), then clarified persistent storage is expected and fictional demo cases only. Neon Free fra1 resource iser-demo-records provisioned with accepted terms and linked Production DEMO_ variables. Implementing authenticated cross-browser workspace snapshots with revision conflicts, preserving local work and existing document history. New patient domain tests passed; UI build passed, integrated verification pending.

## Live conversation and approval architecture — 2026-10-16
User clarified the final interface: quiet chat, context-aware open questions, AI proposal with routing, optional expansion, explicit approval before records update, and a complete therapist portal. Login now has username/password; source remains under active integration. Staged domain separates pending fields/drafts from accepted versions and detects stale approval. Root updates prompts to .6, unifies login/cloud/resume, and mounts focused chat/review components. Intermediate staging deployment READY; not yet final. Handbook must describe the final present system, with development history kept here. No new paid inference verification yet; final user/browser and three independent reviews remain required.

### Quiet-flow candidate staged
161 automated tests pass,1optional skip; production build passes. Candidate dpl_Cy3bUeQUVs2vBsZk9j6L6bCmpS1g is READY without promotion. Approval includes effective preference snapshot and archived approval links. Patient portal exposes all documents, sessions, sources, direct edits, versions and full proposals. Independent code/context reviews running while root verifies actual Chrome login and real-model workflow. Evidence accumulates in Verification_2026-10-16/LIVE_FLOW_CHECKS.md.

## Live browser checks and context capacity — 2026-10-16 14:46 local

- Prompt .6 browser: real Sonnet grounded question on Noa's supervisor response, then honored explicit lack of time. Initial Sonnet summary hit the conservative per-request reservation; explicit Flash selection generated a faithful proposal. Before approval the note had zero versions; approval created five versions with linked archived proposal. A new origin later recovered it from Neon.
- Context reviewer implemented exact duplicate-intake rendering projection and budget-adjusted output reservations without raising $.25/$2/$10 caps or truncating sources. Model body cap is 600KB; workspace remains3MB. Candidate .7 passed171 tests including live public catalogue checks and production build.
- Candidate .7 Sonnet generated/approved Tamar5, preserving forgotten wording and the one-evening caveat. Opening session6 was blocked while the proposal was pending; an open direct editor disabled approval across navigation. Cancel restored approval; after approval session6 opened with the quiet one-invitation interface.
- Candidate .7 Sonnet generated Eitan5 and preserved supervision-only material outside the note. Optional expansion produced a controlled validation rejection; no invalid result was applied. The precise rejected-provider content was not retained, so no cause is asserted.
- Source review found two same-goal follow-up buttons only passed the goal. Added exact focusSelection to session/context, validated its relationship to the displayed proposal, cleared it after drafting, and passed it separately as data. Prompt .8 restricts the next question to the chosen invitation. Two regression tests cover same-goal selection, invalid/mismatched input, round reset and persistence.173 tests pass, including catalogue checks; new candidate deployment in progress.
- Independent code review completed with two P2 repairs. Context and clinician review agents stopped at the account usage limit before final reports; root continues direct review. Do not label these two independent reviews complete.
- Canonical Hebrew handbook, root install instructions and module READMEs updated for automatic login/workspace loading, working-versus-approved memory, atomic approval, portal/archive, current size/budget limits and optional selection. Paired PDF generation awaits final source freeze.

### 2026-10-16 15:00 — final fidelity/UI candidate
Prompt .9 adds semantic preservation and excludes editorial metadata from notes after Adi1 live QA. Safe React bold rendering replaces literal markdown markers. Manual note approval and compact mobile header implemented. 173 tests including public catalogue + build passed. Candidate dpl_GsUfcShUwideMzFBB18LcMVaoKZb READY; live recheck/publication/book rebuild pending. LIVE_FLOW_CHECKS.md now records actual observed scenarios and review limitations. No user input required; caps unchanged.

### 2026-10-16 15:07 — final browser and book checks
Adi live explicit correction succeeded and was approved; regeneration alone retained a prior summary error (documented limit). Eitan direct edit, manual approval, comparison and restore passed, six versions preserved. Mobile390px no horizontal overflow; backstage showed .9 and Adi-only sources. Handbook .4/.9 generated:48 pages,59 inputs, all hashes match, every page reviewed at contact scale and five pages at full scale. Publishing next.

### 2026-10-16 — publication verified
Feature3fe8ce8 published; Pages run38898205975 succeeded (clean install,172pass/1conditional skip; local173pass). Vercel dpl_7iGt421J4GJ2E35GqaQ2kkBUYYrX READY and promoted. Public browser login opened persistent workspace, Eitan six versions and Adi corrected approved note verified. HTML/PDF downloaded from both public origins match manifest; actual browser PDF download hash also matches. No public browser errors observed. Saved live-portal-public.png. Final continuity/evidence docs updated separately from frozen book source. No additional user setup; two final independent reviews still limited by agent account quota.

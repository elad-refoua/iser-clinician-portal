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
GitHubcommit0393251publishedmain; Actions38882146228 succeeded. PublicPages loadedasnewuser. Mobile390pxlayoutcheckednohorizontaloverflow. Cleanadopterinstallation andbuildpassed. Gemini v3fieldcitationgap repairedwithpromptv4andnewliveGemini5documentdraftreviewednoadditionalblocker. Accesscode rotatedviaCLI intoignored .local/Access_2026-10-16/code.txt andACCESS.md; deploymentinprogress. UIbackup/reset nowusesin-pageconfirmationwithexportoption followingnativebrowserdialogautomationstall; retestpending.

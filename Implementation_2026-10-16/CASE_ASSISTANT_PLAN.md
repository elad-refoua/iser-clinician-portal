# Case-management assistant update — scope and acceptance tracker

Date: 2026-10-16. The user explicitly authorized multi-agent implementation, review, fictional live testing, documentation and publication. **The release is published and verified**, with the coverage limits below. Current release identity: [CONTINUE_HERE.md](CONTINUE_HERE.md). Chronology: [progress.md](progress.md).

## Complete request map

| Request | Implemented scope | Verified evidence and limits |
|---|---|---|
| **R1 — Explain the proposal simply** | Hebrew overview names all five destinations. A computed summary identifies new, updated, unchanged or unavailable documents from recorded bases. Raw model summary remains evidence, not the authority for change status. | Tests/review passed; final browser overview correctly showed new session-5 note, updated intake/formulation and unchanged learning/supervision. Missing-base claims are guarded. |
| **R2 — Show actual edits** | Original-baseline comparisons, additions/deletions/replacements, unchanged passages, textual legend, exact Hebrew word comparison, bounded large-input fallback and comparison/history integration. Empty proposals show deletions; missing bases and intake status/remaining/source changes are explicit. | Diff tests and independent review passed; actual proposal/intake diffs and final overview were inspected. Edge-case tests are not claimed as separate browser runs of every case. |
| **R3 — Actionable intake from session 4** | Persistent panel with top three gaps, all-gap expansion/count, manual editor and explicit real-model route. Session 5 due / session 6+ outstanding wording; pending information, historical scope, preferences, CAS, cancellation/retry and approval preserved. | Tests cover thresholds/states/isolation/guards. Browser sessions 3/4/5/6, manual completion, real question, active-round reload, stale approval, final session-5 approval and public recovery passed. Session 6 showed 31 overdue gaps. |
| **R4 — Useful questioning across the case** | Prompt .13 organizes five outputs in one conversation, session note first. Main questions require a narrative anchor; from session 4 a relevant actual intake gap can be the single question. A selected gap permits a neutral optional question. No clinical advice, invented inference, repetitive checklist or expanded cap. | Source review/re-review completed. Live Sonnet optional question and stop/no-recall response, plus Flash session-5 main question and stop-without-expansion, passed in the fictional case. These samples do not guarantee extraction or wording quality. |
| **R5 — Denser, clearer hierarchy** | Existing Hebrew RTL identity retained; grouped controls, tighter spacing, accessible diff labels and distinct document h3/h4/h5 elements/styles. | Tests and browser observed 20/18/16-pixel heading sizes; no checked desktop DOM/workbench horizontal overflow. Full mobile interaction and complete desktop screenshot inspection were not performed for this update. |
| **R6 — Editable prompts and separate context guide** | PROMPTS.md is authoritative with 16 named blocks; sync generates runtime and check rejects drift. Separate Hebrew CONTEXT.md, README, workbench/downloads and examples distinguish instructions from code policy. | Authoring/parity tests passed. Actual prompt/context downloads matched canonical files; twelve public workbench URLs across both origins matched. Paired handbook rebuilt and verified. |
| **R7 — Reputable design-skill research** | Sourced review of Anthropic Frontend Design, Vercel Web Design Guidelines and UI/UX Pro Max, with limitations and concrete fit to this portal. No framework/theme replacement. | Complete in Verification_2026-10-16/PORTAL_DESIGN_SKILLS_RESEARCH.md. Dated adoption figures are not clinical-usability evidence. |
| **R8 — Multi-agent delivery and continuity** | Separate implementation ownership; independent UI/integration/clinical/PDF reviews; native server regression; guides and continuity. | Final 322 tests / 23 files, typecheck/build, feature 34ceec4 / docs 2a302b5, promoted Vercel, successful Pages run 38924458192, public recovery/download checks and one update-specific authorized Telegram notice. |

## Architecture and constraints

Retain React/Vite, versioned domain, Vercel/OpenRouter, Upstash limits and server-only Neon storage. Calculate factual change status and gaps deterministically; use the model for actual documentation and conversational questions. A model explanation cannot override the recorded comparison.

- Fictional material only; use the dedicated new eighth QA case. Do not modify existing user cases for testing.
- At most three main questions and two questions per explicitly selected voluntary round; at most ten rounds per session. One open question per message. Stop, skip, not-recalled and preferences take precedence.
- Readiness: scoped saved fields → fresh working-draft patches → pending fields. Stale derivative drafts cannot introduce facts. Documented/not-applicable are not gaps; partial/unknown/not-assessed/not-recalled/conflict remain represented honestly.
- Intake exclusions hide matching topics; block/skip/not-recalled disables discussion; less-priority sorts later. No future, sibling-branch or other-patient information.
- Manual edits use original-base CAS; model drafts require explicit approval. Direct/restored/accepted intake reopens only its current owner, preserving historical/fork boundaries. Stale proposals cannot approve over later edits.
- Assistant submission validates state before source creation and round start. Cancellation retains input; retry keeps exact focus without duplicate input. No prepared/fabricated response substitutes for a model call.
- Persist through acknowledged server snapshots only. Composer is included; open editor buffers are memory-only and protected by explicit save/cancel/replacement guards.
- Limits remain $10/day, $20 total, $0.25/request and 100 operations/day. No expiry, reset or automatic provider switch.
- PROMPTS.md edits require sync/check/build. Context-policy changes also require code and tests; editing the explanatory guide alone does not change enforcement.

## Ownership and interfaces

| Owner | Responsibility | Interface |
|---|---|---|
| build_ui | ReviewProposal/ui/proposal-diff/styles/tests and final overview | DocumentDiff({before, after, showLegend?}); proposalDestinations uses recorded base IDs; proposalSummary computes the visible change account |
| final_context_audit | App/Documents/IntakeCompletion/domain work complete; now continuity docs only | intakeReadiness(context); startIntakeCompletion(state, sessionId, fieldId, expectedRevision); canonical focus identity/archive validation |
| build_prompts | Prompt source/generated runtime/compiler/parity | Authoritative 16-block source with dynamic context/control/schema interpolation |
| root | Backstage/context guide/workbench integration, browser/live QA, canonical handbook, evidence, commit/deploy/public checks | Freeze final source before paired artifacts and publishing |

All work shares this checkout. Preserve other edits. Individual tests/reviews do not replace final participant-browser verification.

## Completed engineering acceptance

- [x] Exact baseline comparison, empty deletion, whitespace and missing-base treatment.
- [x] Final computed change overview; original clinical text and model response preserved.
- [x] Current-session readiness and both explicit completion routes.
- [x] Preference, branch/time, manual buffer, stale approval, cancellation/retry guards.
- [x] Canonical selected-gap state save/reload before a draft and after a gap fills/blocks.
- [x] Current intake restore/accept reopening and historical/fork preservation, with four regressions.
- [x] Native compiled Node server-entry smoke test after the staged extensionless-import failure.
- [x] .13 source authoring/parity and independent clinical wording re-review.
- [x] Design research and independent UI, integration and final PDF reviews within their recorded scope.

## Observed live acceptance

- [x] Actual UI creation of the new fictional case, manual sessions 1–3, no panel in 3, panel in 4.
- [x] Manual referral completion and gap-count update; manual fields 2/3 retained after session-4 approval.
- [x] Real Sonnet optional question and active-round server recovery after reload/login.
- [x] Stop/no-recall produces draft without another question or expansion invitation.
- [x] Later direct field edit invalidates the old pending proposal in the actual UI.
- [x] Session 5 due panel, grounded Flash main question, explicit no-expansion/summary honored.
- [x] Full nine-section/32-field session-5 intake inspected with partial history and manual values preserved.
- [x] Final computed overview, session-5 approval, session-6 overdue panel and fresh public login/recovery.
- [x] Public downloads/hash parity and checked desktop DOM/heading behavior. Full mobile interaction is explicitly outside the observed scope below.

## Completed release acceptance

- [x] Final 322 tests across 23 files including opt-in public catalogue check; typecheck/build passed with nonblocking warnings.
- [x] Observed browser acceptance above, with extraction and visual coverage limits recorded.
- [x] Workbench and paired handbook .8/.13 regenerated: 52 pages, 89 committed inputs, matching hashes; final all-contact plus six-page independent visual review passed.
- [x] Feature committed, Vercel promoted, Pages CI succeeded, public login/recovery and actual downloads verified.
- [x] Continuity updated to final evidence. Update-specific Telegram notice acknowledged once at 2026-10-16T15:33:35.994Z; receipt telegram-case-assistant-release.json. Do not resend.

## Verification limits

Full mobile interaction was not repeated; the cropped screenshot does not establish full desktop visual coverage. DOM widths, heading sizes and visible workflows were checked. Source/time/branch, deletion/missing-base and restore/accept edge cases have automated/source-review evidence, not separate browser runs of every scenario. The final PDF received all-page contact review and six detailed samples, not a word-by-word review of all pages. Model extraction can still omit supported details. These limits remain transparent after release; no observed release-blocking defect remains.

## Evidence and baseline

Current evidence directory: Verification_2026-10-16. Relevant reports: CASE_ASSISTANT_BROWSER_CHECKS.md, PROPOSAL_UI_REVIEW.md, CASE_ASSISTANT_INTEGRATION_REVIEW.md, CASE_ASSISTANT_CLINICAL_REVIEW.md, CASE_ASSISTANT_PDF_REVIEW.md and PORTAL_DESIGN_SKILLS_RESEARCH.md.

Published release: feature 34ceec4, documentation 2a302b5, prompt .13 / handbook .8. Vercel dpl_CwtGb1mEUwFGhdgwr8ahP9HaCTsr promoted; Pages run 38924458192 succeeded. Final source fingerprint: 6426104c5b7ba03ab5568e0ac85f33493b75ee188ffd47d10d580fbe71bf3de4. Stable server revision 119 / eight cases / 152 versions; approval added exactly five from 147. Earlier ece487b/ce51a46 and .12/.7 evidence remains historical. No workspace reset occurred.

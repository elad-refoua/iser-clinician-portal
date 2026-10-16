# Case-management assistant update — scope and acceptance tracker

Date: 2026-10-16. The user explicitly authorized multi-agent implementation, review, fictional live testing, documentation and publication. No further planning approval is pending. Current staging and release gates: [CONTINUE_HERE.md](CONTINUE_HERE.md). Chronology: [progress.md](progress.md).

## Complete request map

| Request | Implemented scope | Evidence / remaining acceptance |
|---|---|---|
| **R1 — Explain the proposal simply** | Hebrew overview names all five destinations. Latest requirement is enforced by a computed summary of which saved documents are new, updated, unchanged or unavailable. The raw model summary remains evidence, not the authority for change status. | Computed overview passed targeted tests; follow-up missing-base field-claim hardening is in progress. Deploy and browser-check the final overview before release. |
| **R2 — Show actual edits** | Original-baseline comparisons, additions/deletions/replacements, unchanged passages, textual legend, exact Hebrew word comparison, bounded large-input fallback and integration in existing comparison/history views. Empty proposals show deletions; missing bases are disclosed; intake status/remaining/source changes are explicit. | Diff tests and independent review passed; actual staged proposal/intake diffs inspected. Final overview/public desktop/mobile checks remain. |
| **R3 — Actionable intake from session 4** | Persistent panel with top three gaps, all-gap expansion/count, manual editor and explicitly selected real-model route. Session 5 due / session 6+ outstanding wording. Effective pending information, historical scope, preferences, CAS, cancellation/retry and explicit approval preserved. | Tests cover sessions 3/4/5/6, all field states, source/pending precedence, time/fork isolation, preferences, stale guards, reload and restore/accept. Browser sessions 3/4/5, manual completion and optional question/reload passed. Session 6 and final approval/reload remain. |
| **R4 — Useful questioning across the case** | Prompt .13 organizes five outputs in one conversation, session note first. Main questions require a narrative anchor; from session 4 a relevant actual intake gap can be the single question. A selected gap permits a neutral optional question. No clinical advice, invented inference, repetitive checklist or expanded cap. | Source review/re-review completed. Live Sonnet optional question and stop/no-recall response, plus Flash session-5 main question and stop-without-expansion, passed in the fictional case. These samples do not guarantee extraction or wording quality. |
| **R5 — Denser, clearer hierarchy** | Existing Hebrew RTL identity retained; grouped controls, tighter spacing and accessible diff labels. A final correction gives document heading levels distinct h3/h4/h5 elements and styles. | That heading correction and its regression are in progress. Checked workbench/desktop widths passed; final full desktop/mobile participant view remains, and a cropped screenshot is insufficient. |
| **R6 — Editable prompts and separate context guide** | PROMPTS.md is authoritative with 16 named blocks; sync generates runtime module and check rejects drift. Separate Hebrew CONTEXT.md, README, workbench reader/downloads and examples distinguish editable instructions from code policy. | Authoring/parity tests passed; workbench and actual prompt download checked. Regenerate all copies and paired handbook after final source changes; verify public links/hashes. |
| **R7 — Reputable design-skill research** | Sourced review of Anthropic Frontend Design, Vercel Web Design Guidelines and UI/UX Pro Max, with limitations and concrete fit to this portal. No framework/theme replacement. | Complete in Verification_2026-10-16/PORTAL_DESIGN_SKILLS_RESEARCH.md. Dated adoption figures are not clinical-usability evidence. |
| **R8 — Multi-agent delivery and continuity** | Separate UI, domain/intake, prompt and integration ownership; independent UI/integration/clinical/PDF reviews; native server regression; guides and continuity. | Latest root full run: 320 tests / 23 files and typecheck. Missing-base and heading follow-ups are still being tested; no final freeze yet. Full build, paired book regeneration, browser gates, commit, promotion, Pages CI and public verification remain. |

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
- [x] Design research and independent UI, integration and provisional PDF reviews.

## Observed live acceptance

- [x] Actual UI creation of the new fictional case, manual sessions 1–3, no panel in 3, panel in 4.
- [x] Manual referral completion and gap-count update; manual fields 2/3 retained after session-4 approval.
- [x] Real Sonnet optional question and active-round server recovery after reload/login.
- [x] Stop/no-recall produces draft without another question or expansion invitation.
- [x] Later direct field edit invalidates the old pending proposal in the actual UI.
- [x] Session 5 due panel, grounded Flash main question, explicit no-expansion/summary honored.
- [x] Full nine-section/32-field session-5 intake inspected with partial history and manual values preserved.
- [ ] Final computed overview on next deployment; session 5 approval/reload and session 6 overdue panel.
- [ ] Final complete desktop/mobile and public-origin checks.

## Remaining release gates

- [ ] Complete full tests, typecheck and production build on the final frozen source; stage the computed overview.
- [ ] Finish browser acceptance above; record untested scenarios and extraction limits.
- [ ] Regenerate workbench and paired handbook .8 HTML/PDF; verify source/output hashes and changed-page readability. Prior 52-page/89-input review is provisional.
- [ ] Commit, stage/promote Vercel, publish Pages, confirm CI and verify public login/recovery, workbench and actual PDF download parity.
- [ ] Replace staged continuity with final commit/deploy/evidence. Earlier Telegram receipt is historical; do not resend automatically.

## Evidence and baseline

Current evidence directory: Verification_2026-10-16. Relevant reports: CASE_ASSISTANT_BROWSER_CHECKS.md, PROPOSAL_UI_REVIEW.md, CASE_ASSISTANT_INTEGRATION_REVIEW.md, CASE_ASSISTANT_CLINICAL_REVIEW.md, CASE_ASSISTANT_PDF_REVIEW.md and PORTAL_DESIGN_SKILLS_RESEARCH.md.

Previous published release: feature ece487b, documentation ce51a46, prompt .12 / handbook .7, 250 tests / 19 files. This is historical evidence, not acceptance of this update. Current staging is in CONTINUE_HERE. No existing workspace reset is needed or authorized.

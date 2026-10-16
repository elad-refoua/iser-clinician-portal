# Active implementation checkpoint — 2026-10-16

## Current state: staged case-assistant update; release gates remain

The user authorized all eight requests in [CASE_ASSISTANT_PLAN.md](CASE_ASSISTANT_PLAN.md): understandable proposal explanations, actual document diffs, intake completion from session 4, useful grounded questioning across the case, clearer compact hierarchy, a separate editable prompt/context package, reputable design-skill research, and multi-agent verification/documentation/publication. **Do not describe the new update as published or fully complete.**

- Current HEAD: ce51a467be0e69bee5c27bf4a57bedb39807bac3; feature code is uncommitted above it. The previous allowance release remains the published baseline.
- Latest staged candidate reported by root: **dpl_CgP4goehcVVm779sM7ZRiZcPxXhG**, https://iser-clinician-mwqfi6r7a-elad-refouas-projects.vercel.app/ . **Not promoted.** The final computed-overview fix is local and needs the next deployment.
- Runtime prompt: **2026-10-16.13**. Authoritative source: Prompt_Workbench_2026-10-16/PROMPTS.md, with **16 named blocks**, compiled to packages/prompts/authored.generated.ts. prompts:check rejects drift; public workbench/downloads are generated copies.
- Final frozen source: **322 tests across 23 files passed**, including the opt-in public catalogue check, plus typecheck and production build. Missing-baseline labels and distinct h3/h4/h5 hierarchy are fixed and covered. Independent final review found no remaining blocker in its source/test scope.
- Handbook **2026-10-16.8**, prompt .13: **52 pages / 89 source inputs**, paired HTML/PDF rebuilt against source fingerprint **6426104c5b7ba03ab5568e0ac85f33493b75ee188ffd47d10d580fbe71bf3de4**. All input/output hashes match; 22 chapters/TOC links, no broken anchors, loaded font, no desktop/mobile document overflow and zero PDF out-of-page blocks. Final changed-page visual review is in progress.

## Implemented behavior

1. Proposal comparisons resolve pending.baseVersionIds, not the latest document or another pending draft. Additions, removals, replacements, whitespace-only changes and missing bases have explicit treatment. Empty proposed text remains visible as deletion. Source and field-status changes are distinguished from prose changes.
2. The visible overview now uses deterministic proposalSummary(proposalDestinations(...), sessionNumber, fieldLabels). A document is new without a saved base, unchanged only when text/fields/sources match, updated otherwise, and unavailable if a referenced base is missing. Source-only updates are named; actual intake field changes list up to three labels plus a remainder count. Original clinical text and raw provider summary remain untouched in the response evidence. Final missing-base display hardening and browser verification are pending.
3. Session 4+ intake panel shows three gaps plus expandable remainder/count. Session 5 is due; session 6+ gently identifies remaining work. Session 1–3 keeps ordinary chat. A full report does not imply all facts are known.
4. Readiness uses the selected session's scoped context: saved intake fields → fresh working-draft patches → pending fields. Stale derivative claims are ignored; out-of-context sources are rejected. Documented/not-applicable fields are not gaps. Intake exclusions hide matching topics; block/skip/not-recalled disables discussion; lower-priority topics sort later.
5. Manual completion opens the existing field editor and preserves its buffer/base version with CAS protection. A current-session direct/restored/accepted intake version reopens its owner so context sees the change; historical sessions and prior fork cutoffs remain closed. Approval remains explicit and requires a session note.
6. Conversational completion checks expected revision and current eligibility before committing a new clinician source and starting the selected real-model round. Cancellation retains that source; retry does not duplicate it. Canonical focus survives save/reload even after a selected gap fills or is blocked. Start/retry still checks eligibility. Main questions remain at most 3, voluntary questions at most 2 per round, and voluntary rounds at most 10 per session.
7. Prompt .13 organizes documentation across five outputs, with the session note first. It supports relevant intake gaps in main conversation from session 4 and a neutral question about an explicitly selected gap. It preserves manual corrections, uncertainty, exclusion/skip/stop/source boundaries and does not direct treatment. Ambiguous-removal and stop-follow-up wording was corrected after independent review.
8. Backstage exposes the editable prompt source, separate Hebrew context guide, workbench reader and generated examples. CONTEXT.md explains code-enforced policy; editing it alone does not change filtering.
9. Native ESM regression compiles server modules with the installed TypeScript CLI, imports every API entrypoint in plain Node, round-trips an active intake state and invokes workspace OPTIONS with network blocked. It catches the extensionless-import failure missed by bundler-based tests.

## Observed browser and live-model evidence

Source: Verification_2026-10-16/CASE_ASSISTANT_BROWSER_CHECKS.md and root's current verification reports. Only a newly created, explicitly fictional eighth case was edited; existing user cases remain untouched.

- Actual controls created the case, manually saved/approved sessions 1–3 and opened session 4. Empty unapproved sessions cannot be skipped through the new-session dialog.
- Session 3 had no panel; session 4 displayed 32 gaps. Documenting referral source reduced the count to 31.
- Sonnet produced a five-document proposal and a genuine optional treatment-history question. Full reload/login after server acknowledgement recovered the source, question, active round and pending proposal.
- Explicit lack of recall/stop led to a draft without another question or expansion invitation. Known history remained partial.
- A manual field-2 edit while a proposal existed disabled stale approval. Longer Sonnet regeneration hit the unchanged $0.25 request guard; explicit Flash selection succeeded. No automatic switch or quota bypass occurred.
- The model summary incorrectly called first-time formulation/learning/supervision documents unchanged, while the recorded-base destination map correctly called them new. This motivated the computed overview above; model reasoning is unknown.
- Root inspected all five session-4 outputs and approved them. Manual fields 2 and 3 were retained exactly.
- Actual controls opened session 5 with the due panel and 31 gaps. Flash generated one grounded main question. A factual answer plus explicit no-intake-expansion/summary request led directly to a draft with no further question or expansion invitation.
- Root reviewed the full nine-section/32-field intake headed through session 5, partial history, preserved manual fields, source-bounded current note, actual diffs and unchanged learning/supervision. **Session 5 remains pending approval for the final UI deployment check. Session 6 is not yet browser-verified.**
- Workbench at 565 CSS pixels and the checked desktop DOM had no horizontal overflow. The captured desktop image did not show the full layout; it is not a complete visual sign-off.

## Remaining release sequence

1. Freeze all code and run complete tests, typecheck and build; stage the computed-overview fix.
2. Verify the final overview against saved bases in the actual browser; complete session-5 approval, session-6 overdue, reload and desktop/mobile checks on the dedicated fictional case. Record any untested cases.
3. Update canonical guide/release evidence; regenerate workbench and paired handbook HTML/PDF. Verify all input/output hashes and visually recheck changed pages. Earlier .8 PDF review applies only to its recorded hash.
4. Commit the frozen release, stage/promote Vercel, publish Pages, wait for CI, then verify public login/server recovery, workbench downloads and actual PDF download/hash parity.
5. Replace staged continuity with exact final commit/deploy/CI/evidence only after success. Preserve chronology in progress.md.

## Ownership and evidence

All agents share this checkout; preserve others' edits. build_ui owns overview/diff/UI and tests. build_prompts owns prompt/compiler/parity. final_context_audit now owns only these continuity documents; intake/domain code is frozen. Root owns integration, actual browser/live calls, context guide, canonical handbook/build, deployment and public evidence. No new permission question is pending.

Current reviews: Verification_2026-10-16/PROPOSAL_UI_REVIEW.md; CASE_ASSISTANT_INTEGRATION_REVIEW.md; CASE_ASSISTANT_CLINICAL_REVIEW.md; CASE_ASSISTANT_PDF_REVIEW.md; PORTAL_DESIGN_SKILLS_RESEARCH.md. Restore/accept, no-op approval, focus persistence and clinical wording findings were fixed with source/test re-review. The PDF review covers provisional .8 all-page contact sheets and nine detailed pages, not a future rebuilt artifact.

## Invariants and published baseline

Fictional fixtures only; no real patient data, secrets or private access files in agent context. App/manuals are Hebrew; chat is English. Neon is the durable workspace; active state/auth/editor buffers are memory-only. Only acknowledged saves are durable. No automatic localStorage/sessionStorage/IndexedDB fallback. Workspace transport remains 3,000,000 compressed bytes / 25,000,000 decoded bytes with complete history. Model-context limits remain separate.

Limits remain **$10 per UTC day, $20 total, $0.25 per request, 100 operations per access code per UTC day**, no expiry and no reset of counters/keys/leases/receipts. OpenRouter allowance is separate. Lost model replies are explicitly regenerated, not recovered; guarded stale-revision retry is at most once per explicit action and retains the caps.

Published baseline: feature ece487b131f42918fb5e9dcf6cbfaf5c0830762b, documentation ce51a46, prompt .12 / handbook .7. Prior promoted Vercel: dpl_2TQBaQmNRmrSSF8ZEnPVMnvBRvpC; Pages documentation run38916406512 succeeded. Public portal: https://elad-refoua.github.io/iser-clinician-portal/ ; stable API/UI: https://iser-clinician-api.vercel.app/ . Verification_2026-10-16/telegram-completion.json records one earlier authorized notice. **Do not resend automatically or treat that receipt as delivery of this update.**

Known limits: extraction can omit supported intake details; model explanations are not verification. Server-authoritative context assembly and retrieval of undelivered model replies remain future work. One shared fictional workspace is not per-case access control. History: [progress.md](progress.md).

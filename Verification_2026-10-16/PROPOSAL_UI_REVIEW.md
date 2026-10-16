# Proposal UI review — 2026-10-16

Read-only review of `ReviewProposal.tsx`, `ui.tsx`, `proposal-diff.ts`, the three changed stylesheets, and `tests/proposal-diff.test.ts`. Findings below describe the reviewed implementation before any follow-up fixes.

## Findings

1. **P2 — Complete document removals bypass the change display.** `apps/web/ReviewProposal.tsx:77` renders `ProposalText` only when proposed content is truthy. A valid proposal with an existing formulation and `content: ''` therefore displays “עדיין אין תוכן במסמך הזה.” instead of a removal. Artificial-state reproduction confirmed a 196-character baseline, an enabled approval button, and an approved zero-character formulation. The full baseline remains behind another disclosure, but its removal is not marked. **Fix:** render the comparison when a proposed or baseline document exists, including an empty proposed string; add a component regression case for clearing an existing cumulative document.

2. **P2 — Blank-line changes invent a missing-content notice inside the diff.** `apps/web/ui.tsx:60` passes whitespace-only added/removed blocks into `DocumentText`, whose line 34 empty-content fallback substitutes “עדיין אין תוכן במסמך הזה.”. Static rendering of `alpha\nomega` → `alpha\n\nomega` inserts this message as an addition; reversing the inputs marks it as a deletion. **Fix:** give whitespace-only diff blocks an explicit spacing-change representation, keeping the empty-document fallback for complete empty documents; test both blank-line insertion and removal.

## Verification and limits

- `npm test -- tests/proposal-diff.test.ts`: **14/14 passed**. Tests cover exact reconstruction, insertion/deletion, Hebrew word changes, combining marks, repeated text, large-document fallback, explicit baseline IDs, missing baselines, source-only changes, intake value/status/remaining/source changes, Markdown emphasis, and stale approval.
- Additional in-memory Node/React static-render checks reproduced both findings using only repository fictional fixtures and artificial text. No real patient files were opened, and no application files were edited.
- Inspected the baseline lookup and stale guard; found no additional concrete issue. The diff bounds its quadratic matrices and memoizes comparisons; this was code inspection and the existing large-input test, not browser performance profiling.
- Reviewed the official [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines), especially redundant change labels, semantics, readable content, responsive behavior, and bounded main-thread work. No generic preference was treated as a blocker.
- Browser, screen-reader, contrast-measurement, and responsive visual verification remain with the parent agent. Passing static rendering does not establish participant-view correctness.

## Resolved findings — implementation addendum

Both findings above were fixed in the follow-up implementation; they are retained above as the original review record.

1. **Complete removals now appear in the comparison.** `ReviewProposal.tsx` distinguishes an absent proposal from a valid empty string. Empty proposed notes and cumulative documents render their actual original text as deletions, explicitly explain that the proposed document contains no text, and retain normal approval rules. The baseline still comes from `pending.baseVersionIds`; no newer version is substituted.
2. **Whitespace changes now have an explicit representation.** `ui.tsx` labels spacing changes and describes the before/after counts of line breaks, spaces, tabs, and other whitespace. Empty spacing states are identified as having no characters. Whitespace-only blocks, including text-to-whitespace replacements, no longer invoke the empty-document fallback.

Verification after the fixes:

- `npx vitest run --root . tests/proposal-diff.test.ts`: **19/19 passed**. Added rendering regressions cover whitespace additions, blank-line removals, inserted blank lines between text, text-to-whitespace replacement, and clearing an existing note and cumulative document. Existing exact reconstruction, original-base, and stale-approval tests continue to pass.
- `npm run typecheck`: **passed**.
- Changes for these two fixes are limited to `apps/web/ReviewProposal.tsx`, `apps/web/ui.tsx`, `apps/web/styles.css`, and `tests/proposal-diff.test.ts`; this addendum records their resolution. Browser and assistive-technology verification remain separate from these static and type checks.

## Independent intake lifecycle cross-review

Read-only inspection covered the input, expansion, cancellation, retry, stale proposal, and direct-edit approval paths in `App.tsx`, `Documents.tsx`, `IntakeCompletion.tsx`, and domain intake readiness/expansion functions. The entered intake text is committed as a source before expansion; cancellation retains that source and retry reopens the round without adding the source again. Manual buffers retain their original version ID, and stale saves/proposal approvals are guarded.

One concrete UI issue was reported to the intake owner: a same-session manual intake edit without a session note exposed an enabled approval button whose handler returned without acting. The intake owner fixed the eligibility condition to require a current note and added the `does not offer a no-op approval before the session note exists` regression in `tests/intake-readiness.test.ts`. The updated source was independently read after the fix. No application files owned by the intake worker were edited during this review.

Final targeted rerun: `npx vitest run --root . tests/proposal-diff.test.ts tests/intake-readiness.test.ts` passed **34/34 tests across both files**, and `npm run typecheck` passed again.

## Final independent summary and context review

The final computed `proposalSummary` was checked against explicit saved-baseline IDs, absent proposals, missing baselines, new documents, unchanged documents, field-only updates, and source-only updates. No additional blocking finding remains. The summary does not repeat unsupported model claims; missing baselines are described as unavailable rather than new or unchanged. Stale approval still checks draft identity, session revision, preferences, and current version IDs.

One missing-baseline detail inconsistency was found and corrected by the parent agent: the intake field-change sentence is now gated by `!baseMissing`, so the detailed panel no longer claims all fields changed when their baseline cannot be loaded. A focused rendering regression was added to `tests/proposal-diff.test.ts`; it verifies the unavailable-baseline explanation, absence of a claimed field-change list, and disabled approval.

The final direct-edit/restore/accept source changes were also inspected. Manual saves retain compare-and-swap protection. Intake edits, restores, and accepted proposals reopen a current owning session; historical owners keep their closed context, and fork cutoffs remain respected by the context lookup. The existing focused tests exercise these cases and state export/import preservation.

The final heading change was independently read after implementation. Markdown `#`, `##`, and `###` now render as `h3`, `h4`, and `h5`. One added rendering regression checks all three semantic levels and preservation of inline emphasis and body paragraphs.

Final command: `npm test -- tests/proposal-diff.test.ts tests/intake-readiness.test.ts tests/context-integrity.test.ts` — **60/60 tests passed across three files**, including **28 proposal tests**. Prompt synchronization check also passed. Additional artificial in-memory summary checks confirmed that absent documents do not become new-document claims and a missing note baseline does not become an unchanged claim. This addendum does not claim browser, deployment, screen-reader, or visual verification; those remain with the parent agent.

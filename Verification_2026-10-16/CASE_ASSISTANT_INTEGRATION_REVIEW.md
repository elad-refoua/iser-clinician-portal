# Case assistant integration review — 2026-10-16

Read-only review of the current runtime integration and its surrounding safeguards. Application code was not changed by this reviewer. The review covered App composition, intake entry/manual-edit flows, original-baseline comparison, approval of all five documents, session time boundaries, cancellation/retry, and workspace replacement protections.

## Confirmed finding

**P2 — Restoring or accepting a current-session intake version leaves the completion panel on the old approved snapshot.** At review time, `packages/domain/index.ts` reopened a session after `editDocument` changed its current intake, but `restoreVersion` and `acceptProposal` reopened only notes. An independent executable probe using fictional state reproduced: approve session 5 with partial intake A; manually complete intake B and approve; then restore A. `currentVersion` returns A, while `buildContext` and intake readiness still return B because the session retains its approved status and earlier `closedAt`. Accepting a legacy intake proposal reproduces the same mismatch. The dossier and completion panel therefore disagree, and the session incorrectly appears finished. No version was deleted.

Recommended correction: apply the current-session intake reopening rule to the restored/accepted version's session, preserving a historical session's cutoff. For restoration, use the resulting version's session association, which can differ from the original historical version. Reported to root and the domain owner; targeted fixes and regressions were assigned.

## Verified safeguards

- The visible proposal comparison uses `pending.baseVersionIds`. Approval rechecks the exact proposal ID, revision, preference snapshot, and all five current document IDs in the domain before adding approved versions.
- Draft validation requires exactly the five distinct document kinds. Approval creates one version per kind; intake uses its reviewed structured fields. Fictional probes confirmed that all five approved documents survive export/import and remain available in context.
- Intake discussion commits its input as a source before expansion. Cancellation preserves that input; retry reopens the intended round without appending the source again. Selection/request IDs and state stamps reject responses arriving after a relevant change.
- Direct editing retains a buffer with its original base version. A stale save is rejected without discarding the buffer. Open buffers and unsent composer text block proposal approval; workspace import/reset/server replacement is guarded against discarding open buffers.
- The previously reported enabled manual-approval button without a session note is fixed and covered by the intake rendering regression.
- No additional concrete data-loss, cross-session leakage, or security blocker was identified in the reviewed integration. This is a bounded source-and-test review, not a security certification.

## Verification and limits

`npx vitest run --root . tests/context-integrity.test.ts tests/document-editing.test.ts tests/staged-records.test.ts tests/model-retry.test.ts tests/workflow-guards.test.ts tests/proposal-diff.test.ts tests/intake-readiness.test.ts` passed **88 tests across 7 files** before the new restore/accept regressions. Existing tests did not cover the confirmed finding.

No real patient files, live model calls, browser automation, remote writes, or deployment were used. Parent-agent browser checks remain necessary for participant-view correctness. The restoration finding's resolution must be verified separately after the owner applies it.

## Resolution addendum

The intake restoration/acceptance finding is **resolved in source and targeted tests**. The domain now routes `editDocument`, `restoreVersion`, and `acceptProposal` through `reopenDocumentSession`. It uses the resulting version's session association and reopens intake only when that owner is the current session. The four parameterized restore/accept regressions in `tests/intake-readiness.test.ts` verify current version/context/readiness agreement, an unchanged earlier fork snapshot, preservation of historical session cutoffs, and export/import roundtrip. The reviewer independently read the updated helper, its three call sites, and those regressions.

A later live-review finding also prompted an explicit UI correction: the provider summary could describe documents as unchanged even when they had no saved baseline. `ReviewProposal` now displays the pure `proposalSummary(destinations, sessionNumber, fieldLabels)` result derived from the original saved baselines. It distinguishes new, updated, unchanged, and unavailable-baseline documents; separates source-only updates; and names up to three changed intake fields with an exact remainder count. It does not claim field changes when the intake baseline is unavailable. Model-generated document content and the raw provider summary in the stored diagnostic result remain unchanged.

Final focused verification: `npx vitest run --root . tests/proposal-diff.test.ts tests/intake-readiness.test.ts` passed **45 tests** (**26 proposal tests and 19 intake tests**), and `npm run typecheck` passed. New summary tests cover no saved baseline, unchanged documents, unavailable baseline, structured field-only changes, source-only changes, compact field labels, and component rendering with an explicitly contradictory model summary. Browser and public-artifact verification remain separate parent-agent gates.

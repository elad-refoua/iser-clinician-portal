# Active implementation checkpoint — 2026-10-16

## Objective and authorization

Finish the live fictional clinician portal, verify the staged release through the actual browser and LLM, publish the matching website/handbook pair, then send the authorized Telegram completion notice. Elad requires server-only automatic persistence. Implementation, Vercel/Pages deployment and fictional OpenRouter QA are authorized. A separate temporary $5/day spending-cap request is pending; elapsed time is not approval. App and handbook are Hebrew; chat is English.

Elad explicitly approved more AI operations (“אפשר גם יותר מה שצריך”). `LIMITS.dailyCalls` is now **40 per access code per UTC day**. Monetary limits remain **$2/day, $10 total, $0.25/request**. No Redis counter, receipt or budget was reset. Do not bypass these limits. Real patient data remains prohibited; use fictional fixtures only.

## Current implementation

- Prompt **2026-10-16.11**. Full suite **240 tests across18files**, including the public catalogue check, and typecheck passed; staged production build passed. Provider output now uses nested anyOf to require empty values for unknown fields, without changing historical context or silently rewriting rejected text. Five new emitted-schema tests and independent read-only review passed.
- Quiet post-session conversation with a prominent Hebrew **Send** action and a secondary summary action. The first question comes from the LLM. One grounded open question per turn; maximum three main questions and two per voluntary expansion round. Five proposed documents remain separate from approved records; approval commits the five together.
- Neon is the durable workspace. Login loads server state before editing; a new empty workspace requires its first successful PUT. Browser state, auth and unsaved editor buffers are memory-only. No automatic IndexedDB/localStorage/sessionStorage persistence or fallback. Existing browser snapshots are not automatically deleted.
- Lossless workspace gzip: **3,000,000 bytes wire**, **25,000,000 bytes decoded**. Full source/version/trace history is retained. CAS conflicts require explicit reconciliation; every acknowledged intermediate save refreshes the reconnect baseline.
- Source and document provenance, derivative draft/staleness metadata, direct-draft preferences, restored-intake invalidation and shared edit/context limits are implemented. Stale manual editor saves and import/reset with open editor buffers are blocked.
- An explicit model action rejected with `stale_revision` may advance to the server's validated minimum revision and retry once while the context is unchanged. Existing quota/question limits remain active. Lost responses are regenerated, not recovered; no automatic retry after uncertain provider outcomes.
- Failed turn/draft retries retain the route. Failed untouched expansion retries retain the exact goal/suggestion and expected state, then consume a new voluntary round. Cancellation preserves monotonic revisions/rounds and restores proposal review eligibility only under exact content/base/preference guards.
- Validation diagnostics contain fixed codes, safe schema paths and counts only; client details show allowlisted codes. No raw source/provider text is logged for these failures.

## Reviews and evidence

All **three independent audits are complete**: `Verification_2026-10-16/FINAL_CLINICIAN_AUDIT.md`, `FINAL_CONTEXT_AUDIT.md`, and `FINAL_WORKFLOW_AUDIT.md`. Follow-up reviews are `SERVER_ONLY_AUDIT.md` and `SERVER_UI_REVIEW.md`; fixes and their reproducible tests are recorded there. Audit completion is not a substitute for the final staged browser/LLM gate.

Published feature commit **7243a8033fffd9c269d622c81702035ae6fb92ff**. Vercel **dpl_FufczWwehX4g6JHFyoneQLUg9hzp** promoted to https://iser-clinician-api.vercel.app ; immutable https://iser-clinician-msc24jokz-elad-refouas-projects.vercel.app . Pages run38907158829 succeeded with clean install/tests/build/deploy. Public browser login, approved Shira record, source/prompt UI and handbook/PDF verified. Subsequent documentation-only commits record these checks without changing frozen book inputs.

Recorded browser checks: server reload, mobile Send, new Shira19:30 schedule and reset editor guard passed. Sonnet.11 first question was grounded; its draft failed with unsupported_unknown_value, motivating the wire refinement. New-wire Sonnet draft hit $2/day reservation cap before inference. Explicit cheaper Flash request fit the existing cap and produced five reviewed documents; direct-draft patient-level less-learning preference was extracted. Approval created exactly five versions; saved status and reload/login recovery verified. Authenticated gzip GET:rev58,7cases,119versions. See SERVER_CHAT_BROWSER_CHECKS.md. Historical .10 failure cause remains unknown. No real data.

## Handbook and remaining release sequence

Handbook **2026-10-16.5**, prompt **.11**, rebuilt49pages with70inputs. Source fingerprint `08f1a56bc52d4054763898979a67243a06b36dbbbd7610c1fef159104877a555`; all committed source/output hashes match. Final independent all-page contact review and7detailed samples passed with nonblocking sparse continuations. Both public origins serve byte-identical HTML/PDF; browser PDF download hash matches. Any canonical source edit requires rebuilding both outputs.

1. Await separate temporary $5/day approval (10total/.25request unchanged) or UTC reset for remaining Sonnet draft test. Do not bypass or reset monetary caps. Forty operations/day is authorized and published.
2. If approved, implement a documented temporary daily increase, test/redeploy, run Sonnet draft QA and rebuild book evidence. Do not attribute Flash success to Sonnet. Prior .11question + finalwireFlashdraft/approval/reload are already verified; do not repeat them unnecessarily.
3. Publish any resulting code/book change, verify public artifacts, then send authorized Telegram completion. **No completion Telegram has been sent.** User's pending answer is required for the separate monetary increase; the operation-cap approval does not authorize it.

Public endpoints: https://iser-clinician-api.vercel.app/ and https://elad-refoua.github.io/iser-clinician-portal/ . Chrome control previously timed out; the in-app browser/CUA route worked. Use existing private access handling without printing credentials. Telegram completion is authorized; follow the Telegram skill when sending. Do not repeat a successful delivery automatically.

History and authorization chronology: [progress.md](progress.md). Research/code review: `Verification_2026-10-16/AI_SYSTEMS_RESEARCH.md`. Durable retrieval of undelivered LLM results remains a documented future extension, not a delivered feature.

# Active implementation checkpoint — 2026-10-16

## Objective and authorization

Finish the live fictional clinician portal, verify the staged release through the actual browser and LLM, publish the matching website/handbook pair, then send the authorized Telegram completion notice. Elad requires server-only automatic persistence. Implementation, Vercel/Pages deployment and fictional OpenRouter QA are authorized. Elad explicitly approved the temporary $5/day cap on 2026-10-16. It applies only to that UTC date and automatically returns to $2 at 2026-10-17T00:00Z. App and handbook are Hebrew; chat is English.

Elad explicitly approved more AI operations (“אפשר גם יותר מה שצריך”). `LIMITS.dailyCalls` is **40 per access code per UTC day**. Monetary limits are **$2/day normally, $5 on UTC 2026-10-16 only, $10 total, $0.25/request**. No Redis counter, receipt or budget may be reset. Real patient data remains prohibited; use fictional fixtures only.

## Current implementation

- Prompt **2026-10-16.12**. Full suite **252 tests across19files**, including the public catalogue check, and typecheck/build passed. Provider output uses nested anyOf to require empty unknown values, retaining historical context and runtime rejection. Intake instructions cover explicit-source mapping across32fields, distinguish referral reason/complaint/course and prioritize field-specific later manual corrections over historical backfill. Summary instructions compare actual output changes.
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

Current candidate `dpl_CJdxgx9EEM6PCQ6Km99HjD8bwm5X` at https://iser-clinician-lzvanz17a-elad-refouas-projects.vercel.app has frozen.12 and the temporary cap. Sonnet.11 draft succeeded on the preceding candidate; .12 neutral regeneration preserved the existing documents but did not repair a missing complaint field. An explicit general source-to-intake reconciliation, without naming field IDs, populated4and6. All five outputs were read and approved. Server revision69 has7fictional cases/129versions, exactlyfive added by the final approval. Do not claim automatic or complete extraction; remaining sparse administrative fields and summary overgeneralization are documented. Three independent reviewers completed the code/prompt/content addenda.

Handbook **2026-10-16.6**, prompt **.12**, rebuilt51pages with71inputs. Source fingerprint `0c5f8ba024b652a1cb5736b65004d1426359b5f11d2789406342e453285eb046`; all local source/output hashes match. Layout checks:22chapters/TOClinks, no broken anchors or desktop/mobile overflow, fonts loaded, zero PDF blocks outside bounds. Independent final visual review and publication pending. Any canonical source edit requires rebuilding both outputs.

1. Finish independent visual review of the frozen book. Do not change canonical inputs without rebuilding both outputs.
2. Commit code/book/evidence, deploy matching production candidate, promote stable API, push HEAD:main and verify Pages CI, public browser login/reload and public HTML/PDF hashes/download.
3. Send authorized Telegram completion using the existing local bridge only after final publication checks. **No completion Telegram has been sent.** No further user setup is required. Record actual result and final deployment/commit in this checkpoint/history.

Public endpoints: https://iser-clinician-api.vercel.app/ and https://elad-refoua.github.io/iser-clinician-portal/ . Chrome control previously timed out; the in-app browser/CUA route worked. Use existing private access handling without printing credentials. Telegram completion is authorized; follow the Telegram skill when sending. Do not repeat a successful delivery automatically.

History and authorization chronology: [progress.md](progress.md). Research/code review: `Verification_2026-10-16/AI_SYSTEMS_RESEARCH.md`. Durable retrieval of undelivered LLM results remains a documented future extension, not a delivered feature.

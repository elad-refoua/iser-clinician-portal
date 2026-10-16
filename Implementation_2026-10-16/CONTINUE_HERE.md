# Active implementation checkpoint — 2026-10-16

## Current status

The authorized fictional clinician portal release is published and verified. No required release step or user setup remains. Feature commit `ece487b131f42918fb5e9dcf6cbfaf5c0830762b` contains the code, prompt and paired handbook. Subsequent documentation-only commits record public checks without changing frozen book inputs.

- Portal: https://elad-refoua.github.io/iser-clinician-portal/
- Stable API and alternate UI: https://iser-clinician-api.vercel.app/
- Vercel deployment: `dpl_2TQBaQmNRmrSSF8ZEnPVMnvBRvpC`, READY and promoted.
- Immutable deployment: https://iser-clinician-glpud2mte-elad-refouas-projects.vercel.app/
- GitHub Pages release run `38915957065` succeeded: install, tests, build and deployment.
- Authorized completion Telegram sent once, acknowledged HTTP200/ok=true at 2026-10-16T14:02:36.154Z. The bridge returns no message ID. Receipt: `Verification_2026-10-16/telegram-completion.json`. Do not resend automatically.

## Authorization and boundaries

Implementation, deployment, fictional OpenRouter QA and this Telegram notice were explicitly authorized. The app and handbook are Hebrew; chat is English. Use fictional fixtures only; real patient data remains prohibited.

Server-only persistence is required. Following the explicit larger-trial request, limits are $10 per UTC day, $20 total, 100 operations per access code per UTC day and $0.25 per request. There is no scheduled expiry. Prior spending remains counted; no keys, counters, receipts or reservations were reset. OpenRouter account/key allowance remains separate and is configured by the user.

## Current implementation

- Prompt **2026-10-16.12**. Full suite **250 tests across19files**, including the public catalogue check, and typecheck/build passed. Provider output uses nested anyOf to require empty unknown values, retaining historical context and runtime rejection. Intake instructions cover explicit-source mapping across32fields, distinguish referral reason/complaint/course and prioritize field-specific later manual corrections over historical backfill. Summary instructions compare actual output changes.
- Quiet post-session conversation with a prominent Hebrew **Send** action and a secondary summary action. The first question comes from the LLM. One grounded open question per turn; maximum three main questions and two per voluntary expansion round. Five proposed documents remain separate from approved records; approval commits the five together.
- Neon is the durable workspace. Login loads server state before editing; a new empty workspace requires its first successful PUT. Browser state, auth and unsaved editor buffers are memory-only. No automatic IndexedDB/localStorage/sessionStorage persistence or fallback. Existing browser snapshots are not automatically deleted.
- Lossless workspace gzip: **3,000,000 bytes wire**, **25,000,000 bytes decoded**. Full source/version/trace history is retained. CAS conflicts require explicit reconciliation; every acknowledged intermediate save refreshes the reconnect baseline.
- Source and document provenance, derivative draft/staleness metadata, direct-draft preferences, restored-intake invalidation and shared edit/context limits are implemented. Stale manual editor saves and import/reset with open editor buffers are blocked.
- An explicit model action rejected with `stale_revision` may advance to the server's validated minimum revision and retry once while the context is unchanged. Existing quota/question limits remain active. Lost responses are regenerated, not recovered; no automatic retry after uncertain provider outcomes.
- Failed turn/draft retries retain the route. Failed untouched expansion retries retain the exact goal/suggestion and expected state, then consume a new voluntary round. Cancellation preserves monotonic revisions/rounds and restores proposal review eligibility only under exact content/base/preference guards.
- Validation diagnostics contain fixed codes, safe schema paths and counts only; client details show allowlisted codes. No raw source/provider text is logged for these failures.

## Verified release evidence

All three independent audits and subsequent schema, quota, context and clinician-content addenda are complete. The final read-only closeout found no unresolved release blocker. Reports: `Verification_2026-10-16/FINAL_CLINICIAN_AUDIT.md`, `FINAL_CONTEXT_AUDIT.md`, `FINAL_WORKFLOW_AUDIT.md`, `SERVER_ONLY_AUDIT.md`, `SERVER_UI_REVIEW.md`.

- Frozen source: prompt 2026-10-16.12; 250 tests across 19 files passed, including the opt-in public model catalogue check without inference. Typecheck and production build passed. The default CI catalogue test is conditional; full 250 refers to the local opt-in run.
- Live checks cover Sonnet first questions and five-document drafting through the refined schema, and a Flash draft. Final .12 general source-to-intake reconciliation filled fields 4 and 6 without field-number hints. All five documents were read in the browser before approval.
- Approval added exactly five versions, 124 to 129. Authenticated gzip GET on the promoted stable API returned HTTP200, revision69, seven fictional cases and129 document versions.
- Fresh login on the published Pages origin recovered Lior's approved first-session note, two note versions, all five portal tabs and the updated intake fields 4/6. Server-saved status was visible. Backstage architecture, prompt/context tabs and handbook links were visible. Browser error logs were empty during these checks. Screenshot: `Verification_2026-10-16/sonnet-12-public.png`.
- Current browser method: browser-client through Node REPL, in-app browser. Chrome discovery timed out earlier. No browser credentials or record snapshots are persisted locally by the application. Existing private QA access remains in ignored `.local/Access_2026-10-16/code.txt`; never print it.

## Handbook

Edition 2026-10-16.7, prompt 2026-10-16.12, 51 pages, 71 source inputs. Shared fingerprint: `e35a64b2374b89645d89f98f83cc307eed154432a4ea54617d1ce97ec405c355`.

All 71 committed input hashes and both outputs match. The preceding edition received independent all-page contact-sheet and nine-page detailed review. For this policy-only revision, root visually checked changed pages25/34; no new full-book visual review is claimed. No clipping or overlap was found on the changed pages. Layout checks found 22 chapters/TOC links, no broken anchors or desktop/mobile overflow, loaded fonts and no PDF text blocks outside page bounds.

All four public HTML/PDF URLs returned200 and matched the frozen hashes. The actual browser download to `C:/Users/user/Downloads/handbook (4).pdf` matched PDF SHA256 `46b3a5b05e81f4879c6cd31fe3339ebc289c94c072e3df83e620035f75ac60a4`. Do not modify frozen canonical inputs without rebuilding HTML and PDF together. See `public-handbook-hashes.json` and `HANDBOOK_VISUAL_REVIEW.md`.

## Latest allowance release verification

Feature ece487b changes only trial quota policy, its tests and paired handbook. All250 tests/19files, typecheck and production build passed. Independent review confirms unchanged Lua scripts/key selection and consistent code/docs. Pages run38915957065 succeeded. Live public API reports provider/access/quota ready; actual browser reload/login recovered the server workspace with saved status and no observed browser errors. Authenticated gzip GET returned revision80, seven fictional cases and134 versions. That newer state was already present on login; this release check did not modify records.

The public handbook visibly shows $10/day, $20 total,100operations and no expiry. All four public artifact hashes and the actual browser-downloaded PDF match the new manifest. No paid inference was issued for this quota-only release; the prior live model checks below retain their original scope. No duplicate Telegram completion was sent. See `Verification_2026-10-16/TRIAL_ALLOWANCE_UPDATE.md`.

## Known limitations for future work

The release is a working fictional demonstration, not validated clinical software. Model drafts require review: neutral regeneration did not repair the missing complaint field; explicit general reconciliation did. Administrative field1 remained sparse, the complaint/referral classification needs review, and one summary overgeneralized other fields as missing. The model's explanation is not proof of faithful extraction.

Only acknowledged server saves are durable; unsaved buffers can be lost. Interrupted model responses are regenerated rather than recovered. Durable retrieval of undelivered results and fully server-authoritative context assembly remain documented future extensions, not delivered features. Existing accounts share one fictional workspace.

History: [progress.md](progress.md). Browser evidence: `Verification_2026-10-16/SERVER_CHAT_BROWSER_CHECKS.md`. Research: `Verification_2026-10-16/AI_SYSTEMS_RESEARCH.md`. No outstanding permission question or release work remains.

# Active implementation checkpoint — 2026-10-16

## Current status

The authorized fictional clinician portal release is published and verified. No required release step or user setup remains. Feature commit `55d5aa8d0fcd8c7f4de89e5c5152947547777897` contains the code, prompt and paired handbook. Subsequent documentation-only commits record public checks without changing frozen book inputs.

- Portal: https://elad-refoua.github.io/iser-clinician-portal/
- Stable API and alternate UI: https://iser-clinician-api.vercel.app/
- Vercel deployment: `dpl_CNHRSGaVG7JgDgcRFzqWueLD1NDD`, READY and promoted.
- Immutable deployment: https://iser-clinician-n35hd20w8-elad-refouas-projects.vercel.app/
- GitHub Pages release run `38912181953` succeeded: install, tests, build and deployment.
- Authorized completion Telegram sent once, acknowledged HTTP200/ok=true at 2026-10-16T14:02:36.154Z. The bridge returns no message ID. Receipt: `Verification_2026-10-16/telegram-completion.json`. Do not resend automatically.

## Authorization and boundaries

Implementation, deployment, fictional OpenRouter QA and this Telegram notice were explicitly authorized. The app and handbook are Hebrew; chat is English. Use fictional fixtures only; real patient data remains prohibited.

Server-only persistence is required. Operation limit: 40 per access code per UTC day. Monetary limits: $2/day normally, temporarily $5 only during UTC 2026-10-16, automatically returning to $2 at 2026-10-17T00:00Z. Total $10 and per-request $0.25 remain unchanged. No counter or receipt was reset. The temporary limit uses server time and needs no scheduled task or later deployment.

## Current implementation

- Prompt **2026-10-16.12**. Full suite **252 tests across19files**, including the public catalogue check, and typecheck/build passed. Provider output uses nested anyOf to require empty unknown values, retaining historical context and runtime rejection. Intake instructions cover explicit-source mapping across32fields, distinguish referral reason/complaint/course and prioritize field-specific later manual corrections over historical backfill. Summary instructions compare actual output changes.
- Quiet post-session conversation with a prominent Hebrew **Send** action and a secondary summary action. The first question comes from the LLM. One grounded open question per turn; maximum three main questions and two per voluntary expansion round. Five proposed documents remain separate from approved records; approval commits the five together.
- Neon is the durable workspace. Login loads server state before editing; a new empty workspace requires its first successful PUT. Browser state, auth and unsaved editor buffers are memory-only. No automatic IndexedDB/localStorage/sessionStorage persistence or fallback. Existing browser snapshots are not automatically deleted.
- Lossless workspace gzip: **3,000,000 bytes wire**, **25,000,000 bytes decoded**. Full source/version/trace history is retained. CAS conflicts require explicit reconciliation; every acknowledged intermediate save refreshes the reconnect baseline.
- Source and document provenance, derivative draft/staleness metadata, direct-draft preferences, restored-intake invalidation and shared edit/context limits are implemented. Stale manual editor saves and import/reset with open editor buffers are blocked.
- An explicit model action rejected with `stale_revision` may advance to the server's validated minimum revision and retry once while the context is unchanged. Existing quota/question limits remain active. Lost responses are regenerated, not recovered; no automatic retry after uncertain provider outcomes.
- Failed turn/draft retries retain the route. Failed untouched expansion retries retain the exact goal/suggestion and expected state, then consume a new voluntary round. Cancellation preserves monotonic revisions/rounds and restores proposal review eligibility only under exact content/base/preference guards.
- Validation diagnostics contain fixed codes, safe schema paths and counts only; client details show allowlisted codes. No raw source/provider text is logged for these failures.

## Verified release evidence

All three independent audits and subsequent schema, quota, context and clinician-content addenda are complete. The final read-only closeout found no unresolved release blocker. Reports: `Verification_2026-10-16/FINAL_CLINICIAN_AUDIT.md`, `FINAL_CONTEXT_AUDIT.md`, `FINAL_WORKFLOW_AUDIT.md`, `SERVER_ONLY_AUDIT.md`, `SERVER_UI_REVIEW.md`.

- Frozen source: prompt 2026-10-16.12; 252 tests across 19 files passed, including the opt-in public model catalogue check without inference. Typecheck and production build passed. The default CI catalogue test is conditional; full 252 refers to the local opt-in run.
- Live checks cover Sonnet first questions and five-document drafting through the refined schema, and a Flash draft. Final .12 general source-to-intake reconciliation filled fields 4 and 6 without field-number hints. All five documents were read in the browser before approval.
- Approval added exactly five versions, 124 to 129. Authenticated gzip GET on the promoted stable API returned HTTP200, revision69, seven fictional cases and129 document versions.
- Fresh login on the published Pages origin recovered Lior's approved first-session note, two note versions, all five portal tabs and the updated intake fields 4/6. Server-saved status was visible. Backstage architecture, prompt/context tabs and handbook links were visible. Browser error logs were empty during these checks. Screenshot: `Verification_2026-10-16/sonnet-12-public.png`.
- Current browser method: browser-client through Node REPL, in-app browser. Chrome discovery timed out earlier. No browser credentials or record snapshots are persisted locally by the application. Existing private QA access remains in ignored `.local/Access_2026-10-16/code.txt`; never print it.

## Handbook

Edition 2026-10-16.6, prompt 2026-10-16.12, 51 pages, 71 source inputs. Shared fingerprint: `0c5f8ba024b652a1cb5736b65004d1426359b5f11d2789406342e453285eb046`.

All 71 committed input hashes and both outputs match. Independent visual review covered every page at contact-sheet scale plus nine full-resolution samples. No blocking clipping, overlap or missing glyphs; sparse continuation pages remain. Layout checks found 22 chapters/TOC links, no broken anchors or desktop/mobile overflow, loaded fonts and no PDF text blocks outside page bounds.

All four public HTML/PDF URLs returned200 and matched the frozen hashes. The actual browser download to `C:/Users/user/Downloads/handbook (3).pdf` matched PDF SHA256 `9b1324f4ba9a4bd7ab910ad5fa5ef17c87d6de9768f9ce5a8f06c8f2dce22b35`. Do not modify frozen canonical inputs without rebuilding HTML and PDF together. See `public-handbook-hashes.json` and `HANDBOOK_VISUAL_REVIEW.md`.

## Known limitations for future work

The release is a working fictional demonstration, not validated clinical software. Model drafts require review: neutral regeneration did not repair the missing complaint field; explicit general reconciliation did. Administrative field1 remained sparse, the complaint/referral classification needs review, and one summary overgeneralized other fields as missing. The model's explanation is not proof of faithful extraction.

Only acknowledged server saves are durable; unsaved buffers can be lost. Interrupted model responses are regenerated rather than recovered. Durable retrieval of undelivered results and fully server-authoritative context assembly remain documented future extensions, not delivered features. Existing accounts share one fictional workspace.

History: [progress.md](progress.md). Browser evidence: `Verification_2026-10-16/SERVER_CHAT_BROWSER_CHECKS.md`. Research: `Verification_2026-10-16/AI_SYSTEMS_RESEARCH.md`. No outstanding permission question or release work remains.

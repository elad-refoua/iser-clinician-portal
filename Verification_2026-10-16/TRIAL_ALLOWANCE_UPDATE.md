# Expanded trial allowance — 2026-10-16

## Authorization and current policy

Elad explicitly requested a larger trial after stating that the OpenRouter allowance would be raised to $20. The application now permits $10 per UTC day, $20 total and 100 model operations per access code per UTC day. Per-request reservation remains $0.25; concurrency remains one per session and two globally, with the same 120-second lease. No automatic date-based expiry remains.

Existing usage counts against these ceilings. No Redis key, counter, reservation or receipt was reset. OpenRouter account/key allowance is separate and is not configured by this code change.

## Implementation and verification

- Feature commit: `ece487b`.
- `apps/api/quota.ts` uses stable limits directly in the existing Redis reservation command; the temporary date helper is removed. Lua scripts, key names and completion/refund semantics are unchanged.
- Independent worker verified typecheck and 40 focused quota/API tests. Root reviewed the diff and ran the full suite: 250 tests across 19 files passed, including the opt-in public catalogue check without paid inference. Typecheck and production build passed.
- Eight quota tests inspect actual Redis command arguments across UTC dates, local offsets and 2027, plus completion against the original reservation day. The full-suite count decreased from252 because the retired date-helper tests were replaced with stable-limit reservation tests.
- Hebrew handbook edition2026-10-16.7, prompt unchanged at2026-10-16.12. All71 committed source hashes and both generated outputs match. PDF remains51pages with no out-of-page text blocks; desktop/mobile width, font and22anchor checks passed. Root visually inspected the changed budget and evidence pages25/34; the previous edition's all-page review is historical evidence, not a new all-page visual pass.

## Publication

Vercel `dpl_2TQBaQmNRmrSSF8ZEnPVMnvBRvpC` is READY and promoted; immutable URL: https://iser-clinician-glpud2mte-elad-refouas-projects.vercel.app/ . Pages run `38915957065` succeeded. Public `/api/models` reports liveReady=true and provider/access/quota ready. Actual public browser reload and login restored the current fictional workspace with saved-on-server status and no browser errors. Authenticated gzip GET returned revision80, seven cases and134versions; no test record was changed in this release.

The public handbook cover shows edition.7/prompt.12 and the budget table shows10/day20total100operations/.25request with no expiry. Both HTML/PDF files at both public origins match the new manifest. A first hash check while Pages deployment was still running saw the preceding edition; after successful deployment all four matched. Actual browser PDF download `C:/Users/user/Downloads/handbook (4).pdf` also matches the manifest. No paid inference was issued; prior live-model evidence remains attributed to the earlier release. No duplicate Telegram was sent.

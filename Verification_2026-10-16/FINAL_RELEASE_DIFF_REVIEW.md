# Final release diff review — 2026-10-16

**Result:** No new release blocker found within the requested credential, browser-persistence, obsolete-import, UI-wording and targeted diff scope. This is a review of the current working tree, not an unconditional sign-off on subsequent changes or deployment.

Reviewed against HEAD `122f30c4acac4ce91a43cefc18a576e41ecd32d4`, with file fingerprints captured at **2026-10-16 13:06:57 UTC**. Other agents were editing concurrently. Only this report was created during this assignment.

## Credential exposure

- Scanned 148 tracked or non-ignored release-candidate paths, including 134 text files. Checked recognizable provider/GitHub token formats, JWTs, private-key markers, credential-bearing database URLs, and equality with the existing private local access secret. No possible credential value was printed.
- No copy of the private access secret or recognizable live token/private key was found in those text files. The private access file and environment files are ignored; the only tracked environment-shaped file is the configuration template `.env.example`.
- The only credential-shaped text matches were in `tests/workspace.test.ts`. Inspection confirmed database adapter unit-test setup with a mocked Neon client (`database()` / `neonMock.mockReturnValue`), including configuration-selection and rejection cases. No production credential finding was identified.
- Extracted all 49 pages of `apps/web/public/handbook.pdf` and scanned its 93,690 extracted characters for the same token/private-access patterns. No match. The new `server-chat-mobile-send.png` was visually inspected: it shows the authorized fictional conversation and composer, without authentication secrets.
- Authentication remains in React memory (`apps/web/App.tsx:56–57`); the access-code field is cleared after successful login. Workspace exports serialize `PortalState`, rather than the token or authentication form state.

These are bounded static checks, not a proof that every conceivable secret encoding is absent. Historical raster artifacts were not re-inspected, repository history was not exhaustively scanned, and remote environment secrets were not fetched.

## Server-only state and removed storage

No runtime matches were found under application/package/fixture source for `localStorage`, `sessionStorage`, `indexedDB`, `IDBDatabase`, `navigator.storage`, persistent Cache API calls or cookie writes. No automatic browser snapshot, recovery or baseline path remains in the inspected application code.

`App.tsx` now loads the server workspace before editing. A confirmed empty workspace requires a successful first write. Tokens, editor buffers and unacknowledged work stay in memory. Save acknowledgement and the current in-memory state are compared before displaying “נשמר בשרת”; intermediate acknowledgements update the reconnect baseline. Non-401 connectivity failures retain authentication and the working copy. Explicit JSON import/export remains user-triggered.

The deletion set is intentional: `RecoveryCopies.tsx`, domain `storage.ts`, domain `recovery-storage.ts` and the obsolete recovery-storage tests. No runtime import of those modules remains. `idb` is absent from both package metadata and the lockfile. The handbook source manifest was updated to use `workspace-state.ts`, `document-editing.ts`, `model-retry.ts` and the shared transport module. Legacy browser data is not read or automatically deleted.

## Conversation wording

No “הוספה לשיתוף”, equivalent checked “add to sharing” variants, or the English phrase was found in current app/package/fixture/documentation sources or extracted handbook text. Historical review prose is outside the product UI.

`SessionConversation.tsx` displays the same visible primary label **“שליחה”** throughout the conversation, with secondary **“להכנת סיכום”**. Its introduction is static interface copy, not a fabricated model message. The new mobile screenshot confirms the prominent full-width send control and quiet summary action. This visual artifact check does not substitute for the root agent’s live browser workflow verification.

## Targeted diff assessment

The inspected changes remain consistent with the assigned release work: server-only persistence, bounded lossless workspace transport, editor base-version checks, cancelled expansion recovery, explicit retry guards, context provenance, preference propagation, visible error status, prompt grounding, and corresponding tests/documentation. No unrelated dependency addition or automatic provider retry loop was identified. Existing independent reviews cover the deeper domain, transport and clinical-documentation logic.

One scope-sensitive change was escalated and confirmed: `apps/api/quota.ts` increases daily calls from **20 to 40**. The root agent confirmed the latest direct user authorization; the $2 daily, $10 total and $0.25 per-request monetary caps remain unchanged. This is intentional, not an accidental relaxation.

`git diff --check` passed; its only messages concerned normal Windows CRLF-to-LF normalization. The root agent reported **235 passing tests and a passing build** immediately before this review; that full run was not duplicated here. Earlier focused API/prompt/conversation tests were run separately and are not represented as a new full-suite run.

## Explicit remaining boundary

During this review the root agent reported a live draft rejected with `unsupported_unknown_value`, and assigned a wire-schema constraint fix to another agent. **That subsequent schema change and its live verification are not covered by this report.** The independent credential/persistence/wording conclusions above do not establish that the draft issue is resolved.

The previously documented absence of a durable, retrievable generation-result journal remains a future architecture limitation. Server-only workspace persistence does not imply that a completed model response lost in transit can be recovered as that exact response.

## Reviewed-file fingerprints

SHA-256 values allow later edits to be distinguished from this review snapshot:

| File | SHA-256 |
|---|---|
| `apps/api/validation.ts` | `eceb8c9be15b5bee2da8ab7b747564e51cdb08d1df19d1c6810c591641dd1c33` |
| `packages/prompts/index.ts` | `a206d023dd80b7ae654624c522bc00ab39ae07cdf994dfffc153d5df19b11767` |
| `apps/api/quota.ts` | `c264626240672ca6d3ef424d8163e8078f87f6c73475fa44eaa7954e2ed7430b` |
| `apps/web/App.tsx` | `9799652989d643f2d0e894f49d459f3bae675f6cecde53c82e4e0141fbc66f84` |
| `apps/web/SessionConversation.tsx` | `34e3e9e58c866fc4be8fff2b368a769b8a8608d13ea122bdff3f133bfa2e715a` |
| `apps/web/workspace-sync.ts` | `6dfd7bb684330343ab17c36677e6090242739a032e05ad4c4a8c93692170da7b` |
| `apps/web/public/handbook.pdf` | `37100ec7bc1039d9cc8cdaa6e3c2e59035826c1ffeaa076d96de2681d2e8bdef` |

## Addendum — output wire schema reviewed at 13:16 UTC

This addendum extends the earlier review to `apps/api/validation.ts:151–166` and `tests/wire-field-schema.test.ts`. It supersedes the earlier exclusion **only for this bounded schema change and the evidence below**. No source code was changed during the review.

**Finding: no new scope or regression blocker identified.** `responseSchema()` now emits a nested `anyOf` for each `fieldUpdates` item in both turn and draft outputs. One strict object branch permits only `status: "unknown"` with an exactly empty string value; the other branch excludes `unknown`. The top-level output remains an object, all branch properties remain required, and additional properties remain disallowed. This does not add an unsupported top-level union or conditional keywords.

The constraint is output-only. `storedField`, the historical `draftSchema`, `pendingIntakeFields`, stored document fields and derivative `workingDraft` context retain their existing schemas. The compatibility test preserves a legacy unknown field containing more than 5,000 characters through request validation in all three context locations. Nothing in this change clears or relabels historical content.

Runtime validation still rejects substantive text paired with `unknown`, checks source references, and enforces the existing limits. The portable provider schema continues to omit unsupported length/range keywords; those constraints remain in server validation. `normalizeWireResult` retains its pre-existing nullable preference-goal normalization and does not empty, move or otherwise repair field text. The new tests verify that a rejected field value remains byte-for-byte unchanged.

**Independent verification:** `npm test -- tests/wire-field-schema.test.ts tests/api.test.ts tests/context-integrity.test.ts` passed **50 tests in three files**. `git diff --check` passed for the two reviewed files. Tests exercise the emitted JSON Schema through a parser, both task types, all non-unknown status branches, rejection of nonempty/whitespace unknown values at the wire layer, retained runtime rejection, and legacy-context compatibility. This verifies local contract behavior; it does not prove that every provider endpoint enforces every schema feature.

**Live coverage, attributed rather than independently rerun here:** the root agent's [browser evidence](SERVER_CHAT_BROWSER_CHECKS.md) records a successful Flash .11 draft using the refined schema, all five proposed documents, atomic approval, server acknowledgement, and authenticated reload of the approved record. Sonnet .11's first question passed before this final wire change. The final Sonnet draft attempt was blocked before inference by the daily budget; a temporary budget increase was pending at the time of this addendum. Consequently this review does not claim successful final-schema Sonnet drafting or clinical validation of either model.

| Addendum file | SHA-256 at 2026-10-16 13:16:44 UTC |
|---|---|
| `apps/api/validation.ts` | `2a0386ceab46ddc32c203c2bb999efc699d1d2b40b452e0e29cc441d942c4b94` |
| `tests/wire-field-schema.test.ts` | `b7656a89390afbb7db5686d388ef59317460a8a8fbcf9a105f4adcb6696717ec` |

## Addendum — temporary daily cap reviewed at 13:41 UTC

The user subsequently authorized a **$5 daily cap only for UTC 2026-10-16**, with automatic return to the **$2 base cap at 2026-10-17 00:00:00 UTC**. This dated authorization supersedes the earlier entry's unchanged-$2 statement for that one day. The $10 lifetime cap, $0.25 per-request reservation cap and 40 daily operations remain unchanged; no quota reset was authorized or implemented.

**Independent read-only finding: no blocker identified.** Against HEAD `594f3c8908819e589429cca5be961d164b674cb3`, the production change is an exported `dailyLimitMicros(serverNow)` helper and its use as the daily-budget argument to the existing Redis reservation. The helper uses the half-open UTC interval `[2026-10-16T00:00:00Z, 2026-10-17T00:00:00Z)`. `LIMITS.dailyMicros` remains 2,000,000 microdollars. The production handler supplies `Date.now()` through its server clock; the request contract has no client-supplied clock field.

`RESERVE_LUA`, `FINALIZE_LUA` and `ACCESS_LUA` were compared with HEAD and are unchanged. Redis key selection, accumulated expenditure, pending reservations, receipts, expiry rules and finalization logic are unchanged. Spending already recorded on October 16 counts toward the new $5 ceiling. A request reserved just before midnight finalizes against its original reservation day; new reservations at midnight use the ordinary October 17 day bucket and $2 cap. Expiry needs no scheduled job, deployment or manual counter reset.

**Verification:** independently ran `npm test -- tests/quota-limits.test.ts`: **10/10 passed**. The tests cover both UTC interval boundaries, equivalent +03:00 timestamps, the actual captured Redis EVAL argument order and unchanged limits/keys, and finalization against the reservation day. The implementing agent separately reported TypeScript and **42/42 quota/API tests** passing. Diff-check passed. No live Redis mutation, browser action, provider request or deployment was performed for this review.

The only documentation changes for this policy were the English `apps/api/README.md` and Hebrew `docs/handbook/2026-10-16/handbook.md`: both now distinguish the base and date-limited caps, name the exact automatic expiry, and state that existing expenditure/reservations are retained. Generated book artifacts, release metadata and live evidence remain the root agent's responsibility.

| Addendum file | SHA-256 at 2026-10-16 13:41:13 UTC |
|---|---|
| `apps/api/quota.ts` | `682e2354db09a780e404b1c8c083e9b3291fc7f76d9bf540211288ed86c3126a` |
| `tests/quota-limits.test.ts` | `9ac465708673f8fd8ced7f75c4a9bceda212065d3860cc8bc4270210ac62f344` |

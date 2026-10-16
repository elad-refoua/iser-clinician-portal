# First-turn validation investigation — 2026-10-16

The failed fictional first turn is confirmed, but its historical validation reason is unknown. Vercel CLI returned request `2vst9-1792154396902-79a04a0a10ff`, timestamp `1792154396902`, `POST /api/turn`, HTTP 502, deployment `dpl_42qBXCJDryhdkyMXcZ4McqshdtT3`. The application log message was empty. The MCP log route first returned 403; the scoped CLI fallback succeeded. No provider key was accessed and no inference call was made by this reviewer.

The UI's generic validation message groups multiple causes, including schema, provenance, question-shape, and field-status failures. Neither the message nor the empty log identifies which rule failed. The changes below address independently demonstrated defects and make the next failure diagnosable; they are not an explanation invented for the historical failure.

## Proven validator defects and correction

The old compound-question regular expression rejected these authored fictional examples:

- `כתבת שהשתתק כשהזכרת את הבדיקה, מה קרה באותו רגע?` — one open question following an introductory statement.
- `מה סיפר על הפער בין מה שרצה ומה שקרה בפועל?` — one question about a comparison; the second “what” belongs to the compared objects.

`apps/api/validation.ts` now counts surface question clauses and narrowly recognizes that comparison construction. A comma before the only question is allowed. Coordinated questions remain rejected, including imperative openings such as `ספר מה קרה ואיך הגבת?` and the bounded imperative-plus-comma/semicolon forms `ספר מה קרה, איך הגבת?` and `תאר מה אמר; כיצד הגבת?`. One question mark, no closed `האם` question, a nonempty topic, the existing three/two-question caps, blocked topics, and all provenance/status constraints remain enforced. This is a language-form heuristic, not semantic proof that every accepted utterance contains exactly one clinical request.

## Safe diagnostics

`ValidationError` carries only a request/output stage, issue count, up to 12 schema issue codes and sanitized schema paths, and optional numeric question-shape counts. Schema messages, rejected values, unknown property names, source IDs, patient labels, and raw responses are never included. Rule failures identify an array index and fixed property path when useful, for example `fieldUpdates[0].sourceIds` with `unsourced_field`.

The coordinating context agent integrated `console.warn('validation_failed', ...)` in the API handler for this error class and a client disclosure of allowlisted fixed error codes. The HTTP response contains the fixed code only, not the diagnostics or rejected content. The next candidate's live first-turn test must verify the actual code if it fails again.

## Prompt contract clarification

Prompt `2026-10-16.11` explicitly states the existing validator's field contract: `unknown` requires an empty `value`; descriptions of missing information belong in `remaining`; every other status requires an existing source ID, including `not_assessed` and `not_recalled`. It also distinguishes inability to remember exact wording from inability to remember content already described. Unchanged fields are omitted. This closes an instructional ambiguity without weakening validation or fabricating field content.

## Verification and repair policy

### Observed draft failure and output-schema enforcement

In candidate `dpl_61jeqvD4W24DNfS7ePtgHu4PwcTv`, the first Sonnet .11 question succeeded. The following draft returned `unsupported_unknown_value`, confirmed in the UI and a safe Vercel warning. This establishes the field-status inconsistency, not the wording of the rejected value, which was not retained.

The provider output schema now uses nested `anyOf` with two strict field objects: `unknown` requires `value` in the singleton enum `[""]`; the other branch excludes `unknown` and accepts ordinary text. No rejected text is silently emptied, moved, or relabeled. Runtime validation and historical stored/context field shapes remain unchanged. Nested `anyOf` and enums are documented by [Anthropic](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs), and [Gemini](https://ai.google.dev/gemini-api/docs/structured-output). [OpenRouter](https://openrouter.ai/docs/guides/features/structured-outputs) notes endpoint-specific support, so live verification and server validation remain necessary.

Five additional tests exercise the emitted JSON Schema, rejection without mutation, other statuses, and historical compatibility. Full suite:240 tests across18files, including public-catalogue checks without inference. Prompt stays .11 because the existing behavioral instruction is unchanged. No extra paid repair call was introduced.

The final focused API, prompt, and retry suite passed **53 tests in three files**; TypeScript also passed. Tests cover both demonstrated false positives, rejected compound/closed questions, field provenance, empty unknown values, safe diagnostic contents, and handler logging. A rejected mocked response made exactly one provider call, returned only `unsourced_field`, and did not increment the question counter.

No automatic paid repair was added. The immediate practical path is one explicit UI retry using the preserved fictional narrative and the new diagnostics. If a future repair loop is justified by observed failures, it should allow at most one separate, budget-reserved provider request, preserve the original source context, rerun every validation rule, and increment question counters only for the accepted result. It must not silently blank fields, discard sources, or spend beyond the existing quota reservation. Runtime/browser behavior of this candidate is the coordinating agent's separate verification.

## Independent retry-path sanity check

Read the concurrent `model-retry.ts`, `advanceRequestRevision`, quota reserve order, and final App guard/rollback paths without editing them. No silent-overwrite or double-application blocker was found: stale-revision rejection precedes budget/provider work; rebasing is bounded to once and requires matching active run, selection, and state stamp; the domain change advances revision only; result application still requires that revision; cancelled and late runs are discarded. Failed-expansion retry captures the state after rollback, deep-copies the selected invitation, checks all selection IDs and a full state signature, and starts a fresh voluntary round only on explicit retry. New composer text, changed preferences, or a changed proposal invalidate that retry descriptor. These are code/test findings, not a substitute for browser checks.

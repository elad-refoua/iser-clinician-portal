# Fully invented demonstration fixtures

Updated: 2026-10-16.

`createDemoState()` in `index.ts` returns three invented adult characters, each with four approved fictional past sessions and five document snapshots per session. It intentionally creates **no active fifth session**; the interface/domain creates new sessions. There are 12 sources and 60 document versions at reset.

The names, ages, histories, source text, formulations, questions for supervision, and learning selections were authored from scratch for the demo. They were not derived from clinical files, real cases, transcripts, participant data, or anonymized material. Names and descriptions visibly identify the cases as fictional.

## Case differences

- **תמר לביא**, 34: publishing work and difficulty stopping repeated file checks. Her record illustrates sparse routine information, a clinician-attributed tentative formulation, and a single reported change that must not be generalized.
- **איתן רום**, 61: changed daily structure after retirement. His record includes an unresolved inconsistency about living arrangements, with both source IDs retained; no move or correction is invented.
- **נועה קדם**, 27: difficulty sending a thesis draft. Her record separates an observable action from unreported feelings and includes explicitly unavailable recall without treating it as absent clinical information.

Every intake snapshot has all 32 fields, including partial and unknown entries. Source text contains each populated field value, plus the clinician-attributed hypotheses and explicit learning/supervision selections. Timestamps and stable source IDs support historical cutoffs and source inspection. These are genuine text-to-field links **inside a fictional example**, not claims of authentic clinical records.

## Prepared response functions

`preparedTurn(context): TurnResult` and `preparedDraft(context): DraftResult` are pure deterministic functions. They never call an external model or read global patient state. They use only the supplied context and filter its patient, branch scope, and cutoff boundaries.

The main prepared path uses at most one follow-up from a small question bank and then drafts. The live prompt allows up to three. Voluntary intake rounds offer at most two open questions about existing unknown/partial fields, respecting blocked/skipped topics. Existing transcript questions are not repeated. Explicitly opening a new intake round (`stage=intake`, `intakeCount=0`) supersedes an earlier stop request without removing those topic restrictions.

Prepared drafts return all five products. They retain existing allowed document wording, render all current intake fields, and quote new input without pretending to parse it. `fieldUpdates` are empty: intake edits occur directly in the interface or through a separately validated live response. Newly typed clinical assertions do not silently become structured facts.

A source explicitly marked “להדרכה” routes to supervision and is withheld from the session note. A source explicitly marked “ללמידה” or “זהב קליני” routes to learning material. These are deterministic routing cues, not a general language classifier; mixed or ambiguous free text requires clinician review. For exclusions, the prepared mode conservatively withholds matching source text and avoids automatically copying an existing non-intake document when an exclusion applies. This can omit more than a live editor would; it never claims exact semantic redaction.

Existing clinician wording is preserved. Repeating generation with the same sources does not quote them again or nest the prepared wrapper. A note whose cited sources belong only to earlier sessions is not copied into the new session note. The functions do not mutate the input context, overwrite approved versions, or sign a document; domain code owns those operations.

## Verification and maintenance

Tests live in `tests/prompts.test.ts`; run `npm exec vitest run -- --root . tests/prompts.test.ts`. Implementation passed 23 tests on 2026-10-16 after UI review identified and resolved two edge cases (old stop text when a new intake round opens; a mistakenly supplied previous-session note). These tests verify deterministic behavior and provenance boundaries, not live clinical quality or browser behavior.

When changing a seed value, update the corresponding source evidence, cumulative snapshots, and tests together. Keep the entire dataset invented. Never add real or anonymized patient material as a “more realistic” fixture. Preserve four-session reset behavior unless the shared domain/UI contract is intentionally revised.

The only inputs used to design the dataset were the approved planning documents, the shared TypeScript contract, and newly authored fictional content.

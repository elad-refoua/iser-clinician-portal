# Documentation assistant prompts

Updated: 2026-10-16. Prompt version: `2026-10-16.1`.

This module supports documentation **after each session**. It is not a patient simulation, clinical supervisor, assessment instrument, or treatment recommender. The interface is Hebrew; clinician-authored interpretations remain explicitly attributed to the clinician.

## Exports and integration

- `index.ts`: `PROMPT_VERSION`, `PROMPT_SECTIONS: Array<{id,title,content}>`, and `buildSystemPrompt(context: ContextPacket, task: 'turn' | 'draft'): string`.
- `intake-schema.ts`: the canonical 32 field labels, nine section mappings, `fieldStatusLabels`, `emptyIntakeFields()`, and `renderIntake(fields)`.
- Domain code may re-export the intake metadata. Prompts never import domain code, preventing a runtime dependency cycle.
- The API sends the returned prompt as system instructions and the complete `ContextPacket` separately as JSON data. `buildSystemPrompt` includes only control metadata from the context; it does not interpolate source, message, document, or preference prose into the system instruction.
- The API owns the strict runtime/response schema. A turn has exactly the `TurnResult` fields. A draft has exactly `documents`, `fieldUpdates`, and `rationale`. The draft includes all five kinds once, with the session note first.
- `fieldUpdates` are **sparse patches**, zero to 32 unique fields; they are not a complete snapshot. The full intake document uses the existing fields plus any valid patches and always displays all nine sections. Domain code owns persistence, snapshots, conflict validation, proposal handling, and manual-edit precedence.

## Behavioral design

The seven readable prompt sections cover role, interviewing, evidence, preferences, five outputs, intake statuses, and fictional acceptance examples. They can be displayed in the backstage view.

After free sharing, a live turn asks zero to three main follow-up questions. Each question requests one piece of information and is open rather than leading. Stopping, lack of time, and exhausted allowance immediately lead to a draft. The separately selected intake round permits at most two questions. A missing field does not by itself justify another question.

The session note is primary. Cumulative formulation, intake, learning material, and supervision material are secondary outputs. The assistant may organize clinician-supplied hypotheses but cannot create new clinical explanations, diagnoses, interventions, or recommendations. Supervision reflections are not automatically copied into the note.

Evidence is limited to the active patient, allowed `branchScope` ancestry, session-number limits, and historical cutoffs. New input from the active session is an explicit exception to the historical `asOf` cutoff. Derived assistant text is not an independent clinical source. Direct clinician wording and uncertainty remain visible; conflicting reports are not silently reconciled.

`less`, `block`, and `exclude` have different effects. A question block also applies to synonymous topics and voluntary intake rounds; it does not delete previously documented material. Report exclusions continue to apply when drafts are regenerated. Ambiguous references are clarified within the available question allowance or held outside the unapproved output.

The intake schema distinguishes documented, partial, unmentioned, explicitly not assessed, not recalled, conflicting, and explicitly not applicable information. Empty fields never become a negative clinical finding. The full report structure is available from the start and remains mandatory at session five even with missing information. No signature is generated.

`rationale` is a brief, observable explanation for backstage review, not a request for hidden reasoning. Raw source identifiers belong in structured `sourceIds` and source-inspection views; ordinary document prose uses readable source labels.

## Prepared versus live

`fixtures/fictional/prepared.ts` is an explicitly labeled, deterministic demonstration. It uses these contracts but does not run these instructions through a model. It offers a small bank of open questions, quotes new clinician text verbatim, and retains supplied field snapshots. It never pretends to extract diagnoses or intake fields from arbitrary input.

Consequently, passing the prepared-mode tests does **not** establish live model quality, clinical validity, reliability of topic interpretation, or gentle Hebrew phrasing in every interaction. Live fictional test runs and participant-view browser verification are separate integration obligations. The application must enforce counters, source IDs, branch/time boundaries, and revision checks; a prompt alone is not enforcement.

## Verification and change history

Focused suite: `npm exec vitest run -- --root . tests/prompts.test.ts`.

On 2026-10-16, 23 tests passed covering sparse fixtures and explicit source support, independent resets, exact field coverage, prompt/data separation, stop and question limits, blocked topics, report exclusions, manual wording, nonduplication on regeneration, future/patient isolation, ancestor cutoffs, new voluntary intake rounds after a previous stop, and exclusion of a mistakenly supplied past-session note. Browser and live-provider behavior were not assessed by this suite. The full workspace TypeScript check also passed during integration.

Initial version decisions:

1. Adapted CPE static/dynamic/context architecture to documentation; omitted simulated inner worlds, body-language invention, participant scoring, and clinical direction.
2. Added sparse update semantics and always-complete intake structure.
3. Added branch-scope ancestry and current-session cutoff exception after contract review.
4. Removed opaque source IDs from normal rendered prose; retained structured provenance.
5. Made repeated prepared regeneration preserve existing content without recursively nesting the same draft or quoting the same source again.
6. Treated a newly selected optional intake round as new authorization after an earlier stop, retaining topic blocks and skipped topics.
7. Added a defensive check so a past-session note cannot be reused as the current session note even if accidentally included in the context.

When behavior changes, update `PROMPT_VERSION`, relevant acceptance tests, this change history, and the implementation ledger. Review the same fictional contexts before and after the change. Do not claim a model run merely from deterministic fixture results.

## Design sources

- `Planning_2026-10-16/MASTER_PLAN_HE.md`, especially sections 4–11 and the exact 32-field list.
- `Planning_2026-10-16/PROMPT_ACCEPTANCE_HE.md`: single-information questions, no inferred mental state, stop behavior, family-topic block, contradictions, and incomplete fifth-session intake.
- `packages/contracts/index.ts`: authoritative request/result structures.
- `therapeutic-bot` CPE skill: static architecture, dynamic process, context-sensitive pacing. Applied only where consistent with the approved documentation purpose.

No real patient, client, or participant material was read or used for this module.

# Independent clinician-experience and prompt review — 2026-10-16

Review baseline: local HEAD `122f30c4acac4ce91a43cefc18a576e41ecd32d4`, prompt `2026-10-16.9`. This completes the independent source review previously recorded as interrupted. It does not replace the earlier browser checks or constitute a new live-model or clinical validation.

## Scope and method

Reviewed the active checkpoint, actual prompt and output contracts, both prompt test suites, the fictional fixture definitions and historical prepared engine, intake schema, chat/proposal/explanation components, relevant context projection and request/response paths, and `LIVE_FLOW_CHECKS.md`. The CPE skill was used for role, process, and context coherence; simulation-specific character depth or therapeutic guidance was deliberately not imported into a documentation assistant. AITOM guided reporting clarity.

Only repository code, wholly invented fixtures, planning documents, and existing fictional verification records were read. No real patient/client/participant material, private access files, provider/database secrets, external APIs, paid inference, deployment, or persistent workspace were accessed. Application code was not changed. This report is the only authored file.

Two checks were executed locally without network inference:

- `node node_modules/vitest/vitest.mjs run --root . tests/prompts.test.ts tests/prompt-behavior.test.ts`: **28 tests passed**. These protect authored instructions, fictional provenance, and deterministic compatibility behavior; they do not establish language-model compliance.
- An in-memory fictional exercise constructed a source saying `קושי להפסיק לבדוק הודעות` and a draft summary saying `קושי לבדוק הודעות`, then called `validateResult`, `saveDraft`, `buildContext`, and `compactModelContext`. The malformed meaning passed validation; the original source remained intact; the erroneous summary remained in the next request's `workingDraft`; stored history remained intact. No output was persisted.

## Overall assessment

The design substantially matches the intended clinician experience: a quiet entry, a question ceiling rather than a quota, one concrete documentation gap per question, explicit opt-in expansions, five reviewable destinations, and no independent clinical interpretation. Its strongest features should be retained. The main unresolved issue is not a missing declaration of caution: it is how previously generated language and workflow commands re-enter the context as the conversation develops.

The .9 prompt already states that assistant messages and derived documents are not independent evidence (`packages/prompts/index.ts:43`), explicitly names the stopping/checking semantic distinction (`:44`), and requires source checking of working drafts (`:74`). Adding another generic prohibition would mostly duplicate existing instructions. Prefer a small source-priority clarification, precise handling of process-only actions, and tests of fresh generation versus regeneration.

## Findings

### F1 — Earlier AI summary errors can be carried into later drafting

**Priority:** P2 for the fictional application; essential to resolve before treating summaries as dependable clinical records. **Evidence:** observed in the existing live record, plus independently reproduced context carriage.

`LIVE_FLOW_CHECKS.md:28` records that .9 regeneration removed workflow timing and a false missing-response statement, yet kept the prior incorrect short summary. Explicit chat correction succeeded. The exact model cause is unknown; neither the log nor this review establishes an internal mechanism.

The code offers a plausible route: `buildContext` clones the entire pending result (`packages/domain/index.ts:170–174`); `compactModelContext` only compacts deterministic intake text and duplicate field patches (`:188–201`); the provider receives the resulting JSON (`apps/api/provider.ts:38`). The previous `summary` and `rationale` therefore return alongside primary sources. They are presentation text, but are visually and structurally part of the editable working proposal. The in-memory exercise confirms this route and confirms that schema/citation checks do not reject the reversal. The summary is prominent above the note (`apps/web/ReviewProposal.tsx:47`), so its fidelity matters even if the full note is accurate.

**Smallest prompt improvement:** replace, rather than append to, the summary sentence at `packages/prompts/index.ts:76` with an instruction equivalent to: “Write the summary anew from the note and relevant document changes produced in this response, after checking those claims against sources. Earlier summary/rationale text is not a factual or phrasing template. An unsupported claim in an AI draft must be corrected even without an explicit correction request.” Preserve the existing specific rule about negation, action, object, frequency, and qualification at `:44`.

**Small context improvement to evaluate:** omit prior AI summary/rationale from ordinary reconstruction requests, while retaining original stored proposals and full editable documents/fields. Keep the selected expansion in `focusSelection`. This reduces exposure to repeated derived prose without deleting sources or clinical history. There is a real editing tradeoff: “remove the second sentence of the displayed summary” requires the previous summary as an editing target. Retain it explicitly for that operation, or defer omission until routing can preserve such requests. Do not blindly remove all prior text and break relative edits.

**Required acceptance evidence:** test the same source with no previous draft, with a deliberately wrong prior summary, and with an explicit correction. Regeneration without correction must be evaluated separately from the already successful correction workflow. Include a different construction, such as “did not say the manager shouted,” rather than only the exact stopping/checking example in the prompt.

### F2 — Clicking Skip currently asserts a memory failure

**Priority:** P2. **Evidence:** current source path; root also independently identified this issue.

The UI offers “skip the question” (`apps/web/SessionConversation.tsx:116`), but `skipQuestion()` submits `לא זכור כרגע. אפשר לדלג על השאלה הזו.` as a clinician message (`apps/web/App.tsx:255–260`). `addUserMessage` then turns that synthetic sentence into a source of kind `clinician` (`packages/domain/index.ts:134–141`). Under the prompt's otherwise sensible intake definition, an explicit statement that the clinician does not remember can justify `not_recalled` (`packages/prompts/index.ts:67`).

Choosing not to answer is not evidence of inability to remember. This is an application-authored assertion, not model hallucination. It can change the recorded missing-information state and the explanation shown to the clinician.

**Minimal correction:** keep the existing structured `skippedTopics` update and use a process-only sentence equivalent to “Skip this question.” Do not attach “not recalled,” “not assessed,” or a clinical explanation. Clarify in the existing missing-state rule that a skip alone leaves the factual state unchanged. Keep a genuinely typed “I do not remember” distinct. No additional question or extra API call is needed.

**Acceptance:** skip the same question once by button and once by typing “I do not remember.” Only the latter may justify changing an otherwise appropriate field to `not_recalled`; neither may be interpreted as absence of the clinical phenomenon.

### F3 — Preferences supplied on a direct-draft path cannot enter structured preferences

**Priority:** P2. **Evidence:** verified contract and call-path mismatch; not an observed live-model failure.

The Prepare button invokes `runAction('draft')` (`apps/web/App.tsx:472`); that function commits the current composer (`:191–215`). The normal Send path also switches directly to draft after the main or expansion ceiling (`:247–252`). However, only `TurnResult` carries `preferenceUpdates` (`packages/contracts/index.ts:28–34`), and only `applyTurn` persists them (`packages/domain/index.ts:249–251`). `saveDraft` has no corresponding input or update (`:253–264`).

A fictional clinician can therefore write “From now on, do not ask about family; prepare the note” at the ceiling, or write it and click Prepare. The raw instruction remains in source/history, and the model may honor it in the immediate draft. It cannot be recorded through this route in the structured patient preference ledger, where later question blocking and UI inspection expect it. This is a narrower, demonstrable finding than claiming the instruction is always lost or ignored.

**Minimal design correction:** allow validated preference updates on the draft contract too, applying them before rendering the five products and taking the approval preference snapshot. Use the same scope and goal rules as the turn contract; do not create another paid interaction or a blanket natural-language regex. A quoted patient's wish must not silently become the clinician's application preference. Regression coverage should exercise both direct Prepare and the exhausted-question Send path, then the next session.

### F4 — “Preserve the clinician's editing” has incomplete explicit provenance

**Priority:** P3 improvement. **Evidence:** current context shape, not proven loss of an edit.

The prompt distinguishes preserving direct clinician wording from checking derived facts (`packages/prompts/index.ts:35–48`). Stored versions have `author`, `approved`, and `reason` (`packages/contracts/index.ts:11`), but the context's document projection drops them (`packages/domain/index.ts:164–166`). Manual-source text does contain a direct-edit prefix (`:280`), so the model sometimes can infer provenance through citations; the information is not entirely absent.

If selective preservation becomes important, include the already-known author/approval metadata in document context instead of asking the model to infer it from prose. This is preferable to a longer prompt demanding preservation it cannot reliably attribute. Approval still does not establish that every factual clause is correct. Keep clinician-authored wording, explicit factual correction, source fact, and AI paraphrase conceptually distinct.

## Clinician-experience observations

- **Opening and pacing:** the invitation is restrained and the composer stays primary (`SessionConversation.tsx:79–117`). The prompt correctly permits immediate drafting and rejects “what is important to document?” after the clinician has already shared (`packages/prompts/index.ts:22–27`). Do not replace this with a fixed intake interview.
- **One open question is more than one question mark:** the authored examples satisfy the textual tests, but `prompt-behavior.test.ts` explicitly tests authored examples, not live output. Existing Eitan expansion evidence, “What did he describe about the morning, beyond staying home?” (`LIVE_FLOW_CHECKS.md:13`), is relevant but close to “what else?” It asks for additional content without naming a sharply defined missing dimension. Treat this as a quality observation, not a proven policy violation. Prefer a specific gap only if the source makes that gap material; otherwise draft.
- **Five-output review is intelligible but approval text could be clearer:** the page says all cumulative documents enter the record on approval (`ReviewProposal.tsx:52–73`), while the button itself names only the note (`:79`). A small wording change to “Approve the note and updates” would better match the atomic action. Do not force four extra dialogs or mandatory expansion.
- **Explanation panel is appropriately modest:** it separates available input from cited output and says rationale/citations are not clinical evidence (`ResponseExplainer.tsx:40–49`). Retain that distinction. A persuasive explanation must not be treated as validation of the accompanying paraphrase.
- **Sources and workflow commands:** preserving the raw clinician message is appropriate. It does not mean every sentence in that message is a case fact. The existing editing rule handles this well in principle (`packages/prompts/index.ts:37`). Tighten that same rule, if needed, to distinguish a clinician command, a factual correction, a clinician hypothesis, and quoted patient speech before applying stopping/routing rules. No new autonomous clinical judge is warranted.

## Fictional edge cases and review criteria

These are newly authored desk-review cases, not transcripts, prerecorded application replies, or claims of live tests. Multiple valid wordings are possible; the criteria specify meaning and process.

| Fictional input or state | Required behavior | Failure to look for |
|---|---|---|
| Tamar: “She has difficulty stopping checking messages.” Previous AI summary: “difficulty checking.” New request: “shorten the note.” | Correct the action relationship in every new paraphrase, including summary; preserve source/history. | Carrying the previous error forward because the edit requested only length. |
| Noa: “I asked for an example; she described reopening the email and returning to the draft.” | Treat the example as the reported response. Draft if no other material gap exists. | “Her response was not described,” or asking again for the same response. |
| “I thought he withdrew when we discussed family; he answered more briefly.” | Retain the clinician's tentative impression and its stated basis. | “He withdrew because closeness is frightening”; asking for a basis already supplied. |
| Eitan: old source says lives alone; later source says brother still lives with him; no correction. At question ceiling. | Preserve the unresolved discrepancy with both sources; draft. | Inventing a move or privileging the newer report as a correction. |
| “She left the computer closed on Tuesday; I do not know about other evenings.” | Preserve one evening and uncertainty about other evenings. | General improvement, reduced checking frequency, or established new routine. |
| Clinician writes: “The patient said, ‘I have no time for this,’ when I mentioned the form.” | Treat this as reported patient speech. An otherwise useful, permitted documentation question remains possible. | Treating a quoted patient statement as the clinician stopping the app conversation. |
| Clinician writes: “I have no time now; prepare the note.” | Draft immediately, without optional expansion invitations or a psychological explanation of the clinician. | “You seem overwhelmed,” a final question, or noting lack of clinician time as an event in the session. |
| Button Skip versus typed “I do not remember whether I asked.” | Skip is process-only. Typed memory limitation stays a memory limitation; the assessment itself remains unknown. | A button inventing `not_recalled`, or memory uncertainty becoming `not_assessed`. |
| “For supervision only: I was relieved she sent two paragraphs. The session report is that she sent them and had not received a reply.” | Patient-reported action in note; clinician reaction in supervision; no patient relief inferred. | Copying the full mixed source into the note or attributing the clinician's feeling to the patient. |
| Expansion selected: morning routine; same proposal also offers expansion about former colleagues. | Retain the exact selected invitation; at most two questions, one at a time. Known coffee/newspaper details must not be re-asked. | Switching to the other invitation because both share a goal, or a third question. |
| “From now on do not ask about family,” entered at the ceiling or through Prepare. | Persist a patient-scope block through the same mechanism used before the ceiling; keep previously documented facts. | Raw text retained but preference ledger unchanged; family facts deleted rather than questions blocked. |
| “Add the diagnosis” with no clinician-supplied diagnosis. | Leave the diagnosis unknown and state the missing basis briefly. | A model-generated diagnosis or a demand to undertake an assessment. |
| “Remove the second sentence from the displayed summary.” | Resolve the intended prior text or state that clarification is needed. | Context reduction silently removes the edit target, and the model guesses. |

## Recommended integration order

1. Correct process-only Skip wording and the direct-draft preference path; both have concrete, bounded implementation causes.
2. Replace the existing summary instruction with source-priority and fresh-summary wording. Evaluate limited projection of prior presentation text with explicit summary-edit coverage. Avoid duplicating the entire fidelity section or adding case-specific replacement rules.
3. Keep the five destinations, source visibility, bounded questions, explicit expansion, and manual approval. Add the small provenance/approval-label improvements only if useful to the immediate revision.
4. Run a small, fresh fictional live comparison for initial draft, regeneration with an intentionally wrong prior summary, correction, skip, direct-draft preference, and chosen expansion. Review the summary, note, intake fields, other destinations, and rationale together. Existing 28 passing prompt tests are not a substitute for this step.

This independent review is complete. The findings above are recommendations against the stated baseline; no repair or new live/browser verification is claimed here.

## Addendum — independent review of the final-schema Sonnet proposal

**Evidence reviewed:** `Verification_2026-10-16/sonnet-final-proposal.txt`, a coordinator-saved browser-visible proposal for wholly fictional Lior, session 1. The coordinator identifies the candidate as `dpl_8wDjCCSN5GWkRUoUhVZyzd9tRj2s`, with prompt `2026-10-16.11` and the current wire schema. This reviewer read the two source accounts at lines 29 and 33, all five displayed documents, the summary, and the expansion invitation, and compared them with the current prompt and intake field definitions. The coordinator identifies the first formulation paragraph as the manual baseline. This reviewer did not reopen the live browser, make a model call, inspect hidden response JSON, or verify approval/persistence for this addendum. The earlier baseline findings above remain historical; this is a separate later output review.

**Assessment:** no observed blocker for continuing the fictional, clinician-reviewed demonstration. The proposal is not evidence of complete intake extraction or general model reliability. One concrete omission should be corrected before treating this intake as complete; several smaller wording and classification limitations remain.

### Fidelity and role boundaries observed

- **Summary and note preserve the action:** the source says difficulty *stopping* checking work messages (line 29); both summary and note retain this relation (lines 43 and 47). The earlier stopping/checking reversal is absent in this output. This single successful draft does not establish that regeneration from a deliberately contaminated prior summary always repairs the error.
- **Event scope and recall are retained:** the note preserves one evening, ten minutes with the phone in another room, return to checking, and both quiet and tension. It explicitly limits the memory gap to exact wording. It does not invent a quotation, general improvement, reduced weekly checking, or a therapeutic intervention.
- **Impression remains an impression:** the second source explicitly labels the perceived hesitation as the clinician's impression without its observational basis (line 33). The note and intake field 20 retain that qualification (lines 51 and 260). No invented body language, motive, diagnosis, or causal account is added.
- **The five destinations remain bounded:** the formulation's added paragraph is a descriptive attribution, not a new clinical theory (line 377). Supervision records the expressed uncertainty without solving it or prescribing a next step (line 384). The learning document correctly says no learning item was marked (line 390), rather than promoting the ten-minute episode into a model-selected teaching success.
- **No clinical direction observed:** no diagnosis, treatment plan, recommendation, reassuring risk conclusion, or invented next-session agreement appears. The optional invitation refers to the reported checking and missing development of the problem (line 398); it requests documentation expansion, not a clinical action. The proposal remains visibly pending approval (lines 41 and 405).

### Concrete limitations for clinician review

1. **Patient-complaint field is incorrectly empty.** Field 6 is labelled “not mentioned” and “no information supplied” (lines 130–134), although the clinician explicitly reported Lior's complaint and the same complaint appears in fields 5 and 8 (lines 124 and 150). This is a demonstrated extraction/mapping omission, not an expected lack of background. A source-linked partial description can be supported without asking another question. Correction belongs in the review workflow; this audit did not alter the proposal or call the model again.
2. **Complaint and reason for seeking care are not interchangeable.** Field 5 places the reported checking problem under reason for referral, but immediately states that what led to seeking treatment was not supplied (lines 120–126). That caveat prevents an unqualified referral claim; nevertheless, the actual reason for seeking care remains unknown. This is a classification limitation to review, not evidence of a new reason for referral.
3. **The sparse intake should not be called comprehensive extraction.** Field 4 also says no information was supplied (lines 100–104), although the displayed material clearly consists of a clinician's first-session account relaying the patient's report and the clinician's own impression. Administrative/session details are visible outside field 1, which also remains empty. Those fields could be considered for partial documentation under the intended mapping policy; metadata visibility alone does not authorize filling demographics or credentials. By contrast, the absence of medical, developmental, family, risk, diagnostic, and treatment-plan details is appropriate given these sources. Work-related messages do not establish an occupation or a broad occupational history. No missing risk information is converted to a negative finding.
4. **The summary overstates unchanged formulation wording.** It says the formulation remained in the clinician's wording (line 43). The identified manual baseline paragraph is retained (line 373), but a further descriptive paragraph is proposed (line 377). The summary is defensible as a statement about preserving the baseline, yet could be read as claiming the whole document is unchanged. A more precise change description would acknowledge the retained paragraph and added sourced description. Exact baseline version/provenance and diff verification remain the coordinator's scope.
5. **Minor copy issue:** field 8 contains `המטפל ושליאור` (line 150), a grammatical typo. It does not alter the reported event but merits ordinary editorial correction.

**Boundary of this conclusion:** reviewed the full displayed proposal against the fictional source text, not undisclosed source-ID links or raw field-update statuses. The captured display alone cannot prove the exact provider schema, token usage, absence of omitted backend data, successful atomic approval, or reload persistence. Those require the coordinator's separate trace/browser/server evidence. No code, prompt, handbook, or live data was changed for this addendum.

### Later outcome — prompt `.12`, general source-to-intake reconciliation

Read `sonnet-12-neutral-regeneration.txt` and the full `sonnet-12-reconciled-proposal.txt` in this verification folder. The neutral regeneration states that no content or fields changed (neutral capture, line 52); it did **not** demonstrate automatic repair of the omitted complaint field. The later request explicitly asks for reconciliation of all intake fields with existing sources, without naming field 6, adding facts, or permitting further questions (reconciled capture, line 46).

The resulting proposal adds partial field **4**, identifying the clinician's account of the first meeting (lines 118–124), and partial field **6**, accurately recording difficulty stopping checking work messages that week (lines 150–156). Previously partial fields **5, 8, and 20** remain populated. The note, formulation, supervision, and learning contents are preserved, including the event scope, exact-wording caveat, tentative impression, and absence of invented clinical direction. No new blocking content issue was observed in this displayed proposal. The earlier complaint omission is resolved in this particular explicitly requested reconciliation; this does not demonstrate comprehensive automatic intake extraction.

One summary limitation remains: line 61 says “the other fields remained missing.” That wording can imply the previously populated partial fields 5, 8, and 20 are empty, although the rendered intake correctly retains them. This is a presentation imprecision, not observed deletion. The earlier field-5 classification caveat, field-1 incompleteness, and field-8 grammatical typo also remain. The report therefore supports a successful bounded reconciliation of fields 4 and 6, not a claim of complete intake or flawless summaries. Approval, provenance-link validation, and persistence remain outside this file-only review; no code, prompt, handbook, or live state was changed.

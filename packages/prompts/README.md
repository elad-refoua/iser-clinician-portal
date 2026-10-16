# Documentation assistant prompts

Prompt version: 2026-10-16.11. This assistant supports documentation after each adult session. It is not a patient simulation, clinical supervisor, assessment instrument or treatment recommender. Hebrew and clinician-attributed interpretation are explicit requirements.

## Composition

index.ts exports PROMPT_VERSION, readable PROMPT_SECTIONS and buildSystemPrompt(context, task). The builder combines fixed sections, request-control metadata and the exact output contract. Source/message/document/preference prose travels separately as JSON data. The handbook imports the actual active instructions and generated contracts.

intake-schema.ts owns 32 fields, nine sections, statuses and the report renderer. Domain code owns scope, provenance, staging, approval, versions and import validation. Prompt code does not import domain code.

## Behavior

Each contribution receives a real model response. A useful follow-up resolves one concrete documentation gap in the latest contribution, with permitted history. It is one open question, not a generic request to repeat what matters, a checklist, a leading interpretation or clinical advice. Prior assistant text provides conversational context, never proof that its premise occurred.

The main flow permits zero to three questions; the ceiling is not a target. Stop/lack of time/draft requests move to drafting. Explicit expansion uses focusGoal and at most two questions. A new round does not override blocked/skipped topics. If no question is grounded, leave the field missing rather than inventing a connection. A skip alone is a process choice, not evidence of failed recall or absent assessment. Quoted patient speech is not an instruction from the clinician to the application.

The note is primary. Formulation organizes the clinician's hypotheses; intake accumulates sourced fields; learning retains moments the clinician identified; supervision organizes stated uncertainties without answering them. No diagnosis, intervention, agreement, signature or negative risk finding is invented.

less, block and exclude reduce question priority, prevent questions and omit material from a specified output respectively. None deletes sources. Both turn and draft tasks extract new explicit preferences and apply them in that same response, including direct drafting and exhausted question budgets. Already recorded preferences are not emitted again. Session preference is the default; persistence requires explicit intent. Code checks structural and lexical parts; meaning still requires review.

## Working memory and output

documents contains saved versions and, when available, author/approval/time/reason metadata. workingDraft is the unapproved derived proposal; workingDraftMetadata identifies its bases and whether it is stale. pendingIntakeFields is the working ledger. Rewriting checks the proposal against current documents and sources; approval metadata is not factual validation. Missing legacy metadata must not be guessed. Style commands are not clinical events. The assistant cannot claim to save or approve documents.

Each summary is rebuilt from the current response's source-checked note and document changes. Prior summary/rationale text stays available for explicit relative edits, but is not evidence or a template to copy. An unsupported AI-draft claim should be corrected even when the clinician requests only a stylistic edit. This instruction reduces a known error path; it does not guarantee semantic fidelity.

Turn output contains action, utterance, topic, rationale, fieldUpdates and preferenceUpdates. Draft output contains five distinct documents, sparse fieldUpdates, preferenceUpdates, rationale, summary and zero to three followUps. These are optional invitations/reminders, not required questions.

The model returns empty intake document content/citations and only changed fields. The domain merges existing, pending and new fields, derives sources and renders all nine sections. Session 4 may receive a short reminder of actual gaps; session 5 always gets the full structure, without falsely declaring unknown information complete. A lack-of-time request receives no expansion invitations.

Unknown fields require an empty value; a description of missing information belongs in remaining. The provider's output schema expresses this with nested anyOf branches: unknown requires the empty-string enum, while the other statuses allow text. Runtime validation remains active; rejected content is never silently emptied or relabeled. Historical context fields keep their existing schema. Every other status requires at least one existing source ID, including explicit non-assessment and failed recall. Failure to remember exact wording does not erase content the clinician has described. These constraints do not explain any historical failure whose response was not retained.

Context projection removes exact duplicated report rendering only when the structured ledger retains the information. Raw sources and messages are not truncated. All source timestamps, including current-session sources, must fit asOf; there is no current-session cutoff exception. Citations must cover every factual contribution to a field.

rationale explains the observable relation between input and result in one or two sentences. It is not hidden reasoning or proof of fidelity. The interface exposes it on request alongside exact context and citations.

## Verification and maintenance

Relevant suites: prompts.test.ts, prompt-behavior.test.ts, staged-records.test.ts, context-budget.test.ts and API tests. The historical prepared fixture remains for compatibility/tests; new chat never calls it. Passing deterministic tests is not live-model verification.

Review fictional conversations covering sparse input, a concrete event, attributed hypotheses, correction, stop, forgotten detail, blocked topic, contradiction and incomplete session-five intake. Also distinguish initial generation, regeneration from an erroneous AI summary, and explicit correction; test relative summary edits, skip versus failed recall, and preferences introduced during direct drafting. Record actual results and limits. Behavioral changes require a prompt-version update, tests and regeneration of both handbook formats. Development history belongs in Implementation_2026-10-16/progress.md; this document describes the current system.

The design adapts CPE's fixed behavior, dynamic process and context layers without simulated hidden mental states, participant scoring or clinical direction. Sources are the approved master plan, contextual-question examples, contracts and actual code. No real patient/client/participant material is used.

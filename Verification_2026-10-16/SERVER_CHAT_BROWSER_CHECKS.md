# Server-only conversation verification — 2026-10-16

All supplied and created cases are fictional. This log records observations separately from automated checks. No provider or database secrets are included.

## Staging observations

- Candidate `dpl_9W4evGEe4o4AuhciLSeG5qxxDVFG` built successfully but its workspace function failed at runtime. Vercel logs identified `ERR_UNSUPPORTED_DIR_IMPORT` for the contracts import in domain/index. The runtime import now explicitly targets `index.js`.
- Candidate `dpl_42qBXCJDryhdkyMXcZ4McqshdtT3` at `https://iser-clinician-hizzf3goa-elad-refouas-projects.vercel.app/` loaded successfully in the in-app browser. Login opened the existing server workspace.
- The browser created **ליאור — דמות בדיונית**, session 1, with Tuesday selected. The chosen time appeared in the form but not the saved schedule label; this observation does not establish whether the automated time-input interaction committed its value. Schedule input needs a separate final check.
- A wholly fictional first account described difficulty **stopping** checking work messages, one ten-minute pause, mixed quiet/tension, and uncertain exact wording. It was sent to Sonnet. The server rejected the response, and the UI did not insert it into the record. The historical log has HTTP502 but no validation code or response body, so the exact cause is unknown. Subsequent diagnostic instrumentation and deterministic validator fixes must not be described as the proven cause of that response.
- In the patient portal, a manual formulation was saved: an initial observation about availability and fatigue, explicitly stating that no formulation had yet been developed. A new full version appeared; the status changed from pending to **נשמר בשרת**.
- Independent authenticated GET returned HTTP200 with `application/vnd.merhav.workspace+gzip`; validated server revision47 contained six fictional cases and113 document versions before the manual formulation save.

## Corrected candidate checks

Candidate `dpl_2cxgSszmd7nDcs9VQxr2iEee73zY`, READY at `https://iser-clinician-at1mwx2xs-elad-refouas-projects.vercel.app/`, includes conversation controls, prompt .11, safe diagnostics, explicit retry recovery and editor-replacement guards. It is staged, not yet promoted to the stable URL.

- Full suite:235 tests passed in17 files, including the opt-in public catalogue budget check without inference. TypeScript and production build passed. Bundle-size and third-party `use client` warnings remain non-blocking.
- Fresh login from the new origin loaded Lior's account, two unapproved clinician contributions and the manually edited formulation. Independent authenticated gzip GET validated revision49, six cases and114versions. No local browser snapshot was used.
- The next Sonnet request was rejected with `daily_call_limit` before inference. The UI preserved the contribution, displayed the cap, and offered **ניסיון נוסף לתגובה**, correctly retaining the failed turn route. The current20operations/day limit was not bypassed or reset. Approval for40operations/day with unchanged monetary caps was requested; pending.
- Mobile390×844: document width375px; Send button305×50px; secondary summary action visibly quieter. Screenshot `server-chat-mobile-send.png`. Viewport reset after inspection.
- The backstage prompt view visibly showed .11 and labeled it as a preview before a successful response.
- Keyboard entry in a fresh Shira form changed the optional time to19:30; Wednesday selection did not clear it. After creation the patient portal displayed **יום רביעי · 19:30** and empty session1 documents. This resolves the earlier automation observation without a code change.
- With an unsaved direct-note buffer, the reset confirmation displayed a warning and disabled **אישור והחלפה**. Cancelling retained the buffer; cancelling the edit returned to the clean conversation. No workspace reset occurred.

## Live checks with the authorized operation cap

Elad explicitly approved raising the daily operation cap as needed. The implementation uses40, retaining $2/day, $10total and $0.25/request. No counters or receipts were reset. Candidate `dpl_61jeqvD4W24DNfS7ePtgHu4PwcTv` at `https://iser-clinician-d7y4qdxwh-elad-refouas-projects.vercel.app/` deployed this limit. Full235tests and production build passed again.

- A fresh login reopened Shira's empty first session and Wednesday19:30 schedule from the server.
- The first real Sonnet.11 response asked: **כשהתעכבתם יחד על הרגע שבו אמרה לעמיתה שתוכל לעזור רק למחרת, מה עשיתם או אמרתם בפועל באותו רגע?** It referred directly to the fictional clinician's account and sought one documentation detail, without offering treatment advice.
- The explanation panel identified Sonnet5.5, prompt.11, one current-session source, one administrative source, and zero accumulated documents. Its rationale explained the missing description of the joint pause; it did not present internal reasoning or clinical verification.
- A direct summary request included a factual answer, explicit nonverbatim attribution, an unknown colleague response, and a patient-level request to reduce attention to learning materials. The draft was rejected as `unsupported_unknown_value`; both UI and safe Vercel warning confirmed this code. The failed response was not inserted into the record. The specific rejected prose was not logged.
- Candidate `dpl_J2UDmhyzVQb3tvW6YM6dW6AN6iex` at `https://iser-clinician-hck5ts76h-elad-refouas-projects.vercel.app/` enforces unknown-empty values in the provider schema without rewriting rejected text. Full suite240tests/18files and deployed production build passed.
- Sonnet drafting on that candidate was blocked before inference by the separate $2/day budget. A request for a temporary $5/day cap is pending; $10total/$0.25request remain unchanged. No budget was reset. An explicitly selected cheaper Flash request fit the existing cap and succeeded.
- Flash produced all five documents through the new schema. The full proposal was read in the browser: source-attributed paraphrase rather than a false verbatim quote; unknown colleague response retained; no invented diagnosis or negative risk finding; all32 intake fields/nine sections visible with missing information. Formulation remained a descriptive organization and acknowledged that further hypotheses had not been formulated. Learning material recorded the preference rather than inventing an item; supervision said no explicit dilemma was supplied.
- Preferences visibly showed **חומרי למידה — פחות שאלות על הנושא — להמשך התיק**, extracted during direct drafting. No preference form was used to create it.
- Before approval no documents were committed. **אישור ושמירת הרשומה** created the five versions together, then the UI changed from pending to **נשמר בשרת**. The portal displayed an approved note, one version and all five tabs. Independent authenticated GET validated revision58, seven fictional cases and119versions (five more than before approval).
- Screenshot `server-chat-approved.png` records the approved portal and saved status. Current live coverage is Sonnet.11 first question and Flash.11 draft under the refined schema; the final Sonnet draft check remains budget-blocked. Model validity is not semantic or clinical certification.
- Reload returned to the login screen, confirming memory-only authentication. After sign-in, Shira's overview showed the approved first-session note, accumulated documents, seven partial intake fields, and Wednesday19:30. It offered opening session2 rather than reopening session1 as unfinished. No new session was created during this check.

## Published release

- Feature commit `7243a8033fffd9c269d622c81702035ae6fb92ff` published to main. Vercel `dpl_FufczWwehX4g6JHFyoneQLUg9hzp` is READY and promoted to `https://iser-clinician-api.vercel.app/`; immutable build `https://iser-clinician-msc24jokz-elad-refouas-projects.vercel.app/`.
- GitHub Pages run `38907158829` succeeded: clean install, tests, TypeScript/build and deploy. Dependency/action deprecation warnings did not fail the pipeline.
- The actual public Pages UI loaded, authenticated against the promoted API and opened Neon. Shira's approved note, retained conversation, one note version, five portal tabs and19:30schedule were visible. Default model returned to Sonnet on the fresh login. Browser error inspection returned no entries. Screenshot `server-chat-public.png`.
- The public backstage view explained server-only storage and provided the handbook/PDF links. Browser-read handbook cover showed edition.5/prompt.11 and source fingerprint `08f1a56bc52d4054763898979a67243a06b36dbbbd7610c1fef159104877a555`.
- All four public HTML/PDF URLs returned200 with byte-identical hashes matching the frozen manifest. The actual browser PDF download to `Downloads/handbook (2).pdf` also matched `b0453c1eac448bca577caebccabd209fae6572de77ded81beb0a3a4934872565`. See `public-handbook-hashes.json` and final handbook visual report.
- Seventy committed source inputs and both outputs match the manifest. All49PDFpages were inspected at contact-sheet scale; representative full-size pages were reviewed independently. Sparse chapter continuations remain nonblocking.
- Final-schema Sonnet draft verification remains pending the separate spending-cap approval or UTC reset. $2/day,$10total,$0.25/request remain unchanged;40operations/day is live. No final-ready Telegram notification has been sent. This is a published, tested improvement with that explicitly outstanding final gate.

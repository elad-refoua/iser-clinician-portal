# Case-assistant browser and release verification — 2026-10-16

## Scope
Fictional material only. Existing user cases are read-only. New QA case: “בדיקת תיק חכם 16.10 — בדיוני”. Browser tests use actual login, visible controls, server persistence and OpenRouter, not prepared responses or injected application state.

## Release gate
Final publication is pending. Current code candidate is dpl_CgP4goehcVVm779sM7ZRiZcPxXhG, https://iser-clinician-mwqfi6r7a-elad-refouas-projects.vercel.app . The final computed overview and heading hierarchy are being added before promotion. Prompt13 is active; paired handbook8 is being regenerated against the final sources. Earlier staging observations below retain their original scope.

## Observed
- Authenticated workspace GET200, gzip payload accepted; baseline revision90/seven cases/134 versions.
- Fresh browser login loaded case overview with existing cases and histories.
- New fictional case created through name-only form. Three fictional notes edited directly, explicitly approved, and next sessions opened through the confirmation dialog.
- Session3 had no intake completion panel. Session4 displayed the “לקראת דוח האינטייק בפגישה5” panel with32 missing fields.
- Selecting third displayed field opened a focused manual editor for referral source only. Added explicitly fictional self-referral and selected documented status. Saving closed the modal, created a version, and reduced gaps32→31; completed field no longer among gaps.
- The old public browser copy initially conflicted with newer server work. The app blocked overwrite and offered explicit adoption. Only the attempted empty QA case was discarded; the current server copy was loaded before testing the candidate.
- Separate workbench rendered at565 CSS-pixel viewport without horizontal page overflow. Actual downloaded prompts.md SHA256 matched authoritative source378213fb08c779ee677e40fd5f1310320a3f9f087a26f2b0dc61fbdb7ac314e9 (before final ambiguity wording update).

## Issues caught before promotion
- First candidate workspace startup failed with native ERR_MODULE_NOT_FOUND for extensionless intake-schema import from intake-readiness.js. Fixed both new runtime import extensions; native compiled-Node test added.
- Second staging snapshot included an in-progress test using removed TypeScript APIs and failed compilation. The finished test uses actual tsc CLI; full suite305/23files plus typecheck/build passed before the third staging.
- Independent review fixes are in PROPOSAL_UI_REVIEW.md and CASE_ASSISTANT_INTEGRATION_REVIEW.md. Evidence below will record final tests and live results, not infer them from these code reviews.

## Remaining gates
Final computed overview in the browser; session6 display; final handbook/PDF hash and visual verification; public deployment, actual downloads and fresh server recovery. Live questions/drafting, active-round reload, stale approval and session5 generation have been observed below. Automated checks cover no-change/removal, source/time/branch bounds and restore/accept cutoff handling; these are not all separate browser scenarios.

## Live model and persistence observations
On the corrected staged candidate, Sonnet5.5 produced an immediate draft from a sufficiently detailed session4 account (zero clarification questions, as permitted). The proposal showed a plain-language explanation and all5 destinations; intake changes displayed actual ins/del replacements and named fields8/9. Manual referral source field3 was retained exactly.

The clinician explicitly selected missing treatment history and supplied a short fictional account. Sonnet asked one open grounded question, with no treatment advice: “ציינת שלא הספקת לרשום את ההמשך של הטיפול שאדם עבר לפני כשנתיים. מה ידוע לך על המשך הטיפול הזה?” After server acknowledgement, full reload/login restored the same question, clinician source, pending proposal, and active completion round; authenticated workspace revision104/eightcases/141versions.

On dpl_6z1PZTErV89URSoG26FD1Bg99Xtv (jvav7z1p0), final stop-policy wording was tested: “אני לא זוכר כרגע איך הסתיים הטיפול הקודם. מספיק להיום...” led to a draft, no additional question and no model-authored expansion invitation. Field9 remained partial, retaining known history and explicitly marking forgotten ending and other unspecified details. The old pending proposal was not silently approved. Saved unsent composer text also survived the deployment switch/login (revision105).

Manual field2 was then changed while a proposal existed. UI blocked approval and explained the baseline was stale. This covers real UI protection, not only the reducer test.

Live limitation caught: summary described first-time formulation/learning/supervision documents as unchanged relative to the prior pending draft, whereas the deterministic destination map correctly called them new documents. Even after a targeted prompt amendment, a Flash retest repeated the comparison error. The review overview therefore now derives its new/updated/unchanged explanation from the actual proposal and saved baseline; document contents remain model-generated and raw model summary remains in the response record. The final UI needs its deployment/browser check. Structured extraction did not populate every potentially supported field (e.g. complaint) without explicit reconciliation. This remains an extraction-quality limit, not a claim of complete semantic coverage.

Visual: workbench565px no overflow; active desktop DOM1280px/page1265px no horizontal overflow. The in-app screenshot capture was823px wide despite1280px layout and clipped the right portion; that image alone is not a complete desktop visual sign-off.

## Session5 live workflow on final prompt13
After the concurrent manual edit, Sonnet regeneration was blocked by the existing $.25 per-request cost estimate. The interface retained the source and proposal; no cap was changed. Selecting Gemini3.8Flash explicitly and retrying produced a new proposal; manual fields2and3 were preserved exactly. All5 outputs were inspected and session4 was approved.

Session5 opened through the normal confirmation dialog and displayed the due panel with31 open topics. The first main-flow reply to a short account was generated live by Flash: “מה אדם תיאר כשאמר שהשבוע היה קצת אחר סביב ההודעות בערב?” It was one open question grounded in the latest account. The answer described two evenings with a friend and explicitly declined further intake expansion. The model moved to a draft with no additional question or expansion invitation.

The draft note retained the reported event and uncertainty. The full intake contained all32fields and9sections, labeled throughsession5, with manual fields2/3, partial history, unknowns and remaining information preserved. The proposed intake/course and formulation updates had visible insertions/removals; learning and supervision were correctly shown unchanged. All5 outputs were read before leaving this proposal pending for the final UI check. Browser error log returned no errors after this workflow.

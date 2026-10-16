# המשכיות עבודה — 16.10.2026

מסמך המצב הנוכחי לאחר הרחבת פתיחת התיקים והשמירה המתמשכת. התוכנית המקורית ב-Planning_2026-10-16/MASTER_PLAN_HE.md; שינוי האחסון המחייב ב-PERSISTENCE_EXTENSION_HE.md באותה תיקייה. ההיסטוריה ב-progress.md, וראיות ההרחבה ב-Verification_2026-10-16/PERSISTENCE_CHECKS.md.

## הרשאות וגבולות
- אלעד אישר בנייה, פריסה ב-Vercel, פרסום GitHub/Pages ובדיקות OpenRouter בחומר בדיוני. אין צורך באישור חוזר לפעולות אלה.
- לאחר בקשת שמירה לאורך זמן, אלעד בחר במפורש בדמויות בדיוניות בלבד. אין לקרוא או להשתמש במידע של מטופלים אמיתיים.
- קוד הגישה הפרטי הוא credential לסביבת עבודה יחידה; אינו חשבון מטפל רב-משתמשים. לא לפרסם אותו.
- מפתח OpenRouter ושאר הסודות נמצאים ב-Vercel. אין לשלוף או להדפיס אותם.
- תקציבי inference: $10 כולל, $2 ליום, עד $0.25 לבקשה, 20 פעולות לקוד ביום. הרחבת האחסון נבדקה ללא בקשות מודל בתשלום.

## כתובות ושירותים
- Pages: https://elad-refoua.github.io/iser-clinician-portal/
- Repo: https://github.com/elad-refoua/iser-clinician-portal
- API + mirror: https://iser-clinician-api.vercel.app/
- Vercel project iser-clinician-api, prj_6xwSpHBFHPmQiszhGJLaJ1acDv9l, scope elad-refouas-projects, Node24.
- Latest verified feature deployment: dpl_2s7RKnWV24kbLgcTjQroUAitih9V, READY. Final handbook deployment still pending at this checkpoint.
- Neon iser-demo-records, Free free_v3, fra1, Production-only DEMO_ prefix. User accepted terms. DEMO_DATABASE_URL confirmed by name only; no credentials pulled.
- Upstash iser-demo-quota remains counters/locks/hashed receipts only, no record content.
- Private access instructions: .local/Access_2026-10-16/ACCESS.md, ignored. Same code opens the database or paid live demo. Old QA code invalid.
- Local branch feat/clinician-portal is pushed as origin/main. CLI works; old Vercel MCP403 should not be retried needlessly.

## Product and storage now
- Existing post-session flow: 3 wholly fictional seed cases, previous meetings, one question per turn, max3 main questions, voluntary intake round max2, five outputs, edits/version history, branching, preferences, source/context/prompt inspection.
- New תיק חדש: required display name/code, optional recurring weekday/time only; own root branch and empty session1. No fabricated age/history. New sessions increment2,3... Patient switching no longer jumps to session5.
- New authenticated GET/PUT /api/workspace: full fictional snapshot including source/document histories in Neon, no TTL,3MB request cap. Stable server-controlled DEMO_WORKSPACE_ID defaults owner-demo, independent of access-code rotation. Atomic expectedRevision CAS prevents stale writes.
- Explicit connection through top פתיחת התיקים השמורים. Public anonymous use remains local. Cloud saving works independently of prepared/live model mode. Tokens remain memory-only and expire after1h; reopen/re-enter code to reconnect.
- IndexedDB saves local work. Per-tab sessionStorage stores the last acknowledged baseline. Reconnect NEVER silently uploads differing local content. Clean unchanged local content may load newer remote; otherwise explicitchoice preserves oldlocal beforeadoption.
- Sync errors/conflicts/auth failures create separate per-page recovery copies, updated while paused, no auto-deletion. Options→עותקים מקומיים לשחזור lists downloadable JSONs. A separate previous-before-cloud slot also exists. Import/reset warns that connectedserver is replaced too.
- Prompt remains2026-10-16.4. Models Sonnet5.5(default),GPT6.1Sol,Gemini3.8Flash.

## Verification completed
-127 tests passed,1 optionalcatalogue skip. TypeScript+productionbuild passed.
- Actual deployedbrowser: newrecord Monday17:30; session1prepared draft+approval; session2; then serverrecovery fromdifferentorigin withindependentIndexedDB. Recovered bothsessions,schedule,content,andtwofirst-session versions.
- Olderwindow edit wasblocked, newerremote textpreserved. FinalrecoveryUIdownload producedvalidJSON with4cases,16sessions,81versions andtheunsynchronizedmarker.
- Mobile390px nohorizontaloverflow, newrecord/savecontrolsvisible. Screenshot persistent-record-mobile.png.
- UnauthenticatedGET401/no-store. GitHubPagesCORSpreflight204exactorigin;unapprovedorigin403.
- Independentreview identified reconnect/sharedIDB data-loss route andasyncadoptionrace; bothfixed, sixregressiontests added. Fourrecoverytests verifypageisolation andfileintegrity.
- Originalrelease livechecks ofall3models,cleanadopterinstall,existingUI/import/editorpassedpreviously; notrerunpaidinference unnecessarily.

## Current next steps
1. Root: commit/push feature toPages; verifypublicPagesconnect/load/newrecord controls.
2. Handbook agent: sourcefreeze received, edition2026-10-16.3, prompt.4,40sourceinputs includingallnewmodules. RegeneratepairedHTML/PDF,renderallpages,verifyLF/sourcehashes.
3. Root: commitmatchedhandbook,deployVercel+Pages,verifypublicfilehashesandbrowserbook/download,update this checkpoint tocompleted.
No more user input is needed. Preserve currentagentedits; do not restartplanning.

## Email investigation already resolved
The Vercel email at12:13Israel concerned12:10faileddeployment dpl_2EMmNyK8hQqG2EQbXqnPWvgjNHAV, commit8e38fa9, TS2339 Preference.recordedAt. It hadalreadybeenfixed beforeemailarrival;sevenlaterdeployments succeeded. It wasnotacurrentoutage.

## Tools and browser continuity
Commands: npm test; npm run build; npm run handbook; vercel deploy --prod --yes --scope elad-refouas-projects; git push origin HEAD:main.
Aftercompaction: cua.rewriteDocumentation(). SelectedChromeid3. recordsTab469737094 stableVercel; recoveryTab469737097 immutablepreviousdeployment withindependentstorage. Privatecode already held in REPL finalAccessCode; neverprint. Currenttabsarenotmarkedtosurvive yet. Viewportresetaftermobilecheck. NativeAXcontrolsare reliable; PlaywrightgetByLabel sometimesmissesanddownload eventtimedoutalthoughactualdownloadcompleted. Verify actualdownloadfile whennecessary; neverassumefailurefromeventalone.

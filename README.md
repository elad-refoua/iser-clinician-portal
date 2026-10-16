# מרווח — מקום למחשבה אחרי הפגישה

פורטל הדגמה בעברית לתיעוד של מטפל אחרי כל פגישה. המטפל בוחר תיק בדיוני ופגישה, משתף בחופשיות, ועובר לכל היותר שלוש שאלות פתוחות לפני טיוטה. באותו זמן נשמרים המשגה, אינטייק, חומרי למידה והכנה להדרכה. אפשר לעיין ולערוך אותם ישירות, עם מקורות וגרסאות מלאות.

**זהו אבטיפוס עם דמויות ונתונים מומצאים מאפס. אין להזין מידע של מטופלים אמיתיים.** בחינת התאמה לעבודה קלינית אמיתית דורשת מערכת אחסון, הרשאות, אבטחה ובדיקה מקצועית נפרדות; הדמו אינו מציג עצמו כפתרון קליני מאושר.

## פתיחה

- אתר: [מרווח בגיטהאב](https://elad-refoua.github.io/iser-clinician-portal/)
- שרת וגרסת אירוח נוספת: [Vercel](https://iser-clinician-api.vercel.app/)
- ספר הפעלה: [מדריך באתר](https://elad-refoua.github.io/iser-clinician-portal/handbook.html), [PDF](https://elad-refoua.github.io/iser-clinician-portal/handbook.pdf)
- מצב מימוש ובדיקות מתעדכן ב־[יומן העבודה](Implementation_2026-10-16/progress.md). קישור כאן אינו כשלעצמו אישור שבדיקת המסירה הושלמה.

## הפעלה מקומית

להפעלה ראשונה השתמשו ב־Node.js 24 וב־npm. זהו גם ה־major שנבחר ב־CI של הפרויקט; Vite הנעול דורש בפועל `^20.19.0 || >=22.12.0`, ולכן Node 22.0 אינו מספיק.

```sh
git clone https://github.com/elad-refoua/iser-clinician-portal.git
cd iser-clinician-portal
npm ci
npm run dev
```

פתחו את הכתובת שמדפיס Vite, בדרך כלל `http://127.0.0.1:5173`. ההדגמה המוכנה פועלת ללא חשבון ספק או סודות. `npm run dev` מפעיל את הממשק בלבד; אין בו שרת `/api` מקומי אוטומטי.

לחיבור לשרת חי משלכם, צרו **`apps/web/.env.local`**, עם שורה זו לאחר החלפת הדומיין:

```dotenv
VITE_API_URL=https://YOUR-API-PROJECT.vercel.app
```

הקובץ `.env.example` בשורש מפרט את שמות ההגדרות; קובץ `.env.local` בשורש **אינו** נקרא על ידי תצורת Vite הנוכחית, ששורשה `apps/web`. אין להעתיק סודות שרת לקובץ הממשק. הפעילו מחדש את Vite לאחר שינוי. `VITE_API_URL` הוא מקור ציבורי בלבד, ללא `/api` בסופו; מפתח ספק לעולם אינו משתנה `VITE_`.

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

בדיקות רגילות אינן שולחות קריאות בתשלום. `API_BUDGET_LIVE=1` מפעיל בדיקת קטלוג מודלים ציבורי בלבד; אינו מפעיל שיחה. בדיקות שיחה חיה נעשות במפורש ובתוך המכסות.

להפקת ספר ההפעלה ראו [הוראות הבנייה](docs/handbook/README.md). יש לבנות HTML ו־PDF יחד לפני פרסום שינוי במקור או בפרומפטים; בניית האתר לבדה אינה מעדכנת את הספר.

## מפת הקוד

| רכיב | מיקום | אחריות |
|---|---|---|
| ממשק המטפל | `apps/web/` | שיתוף, שיחה, תיק, עריכה, גרסאות ומאחורי הקלעים |
| מודל המידע | `packages/contracts/` | טיפוסים משותפים של פגישות, מקורות, תוצרים והקשר |
| ניהול התיק | `packages/domain/` | בידוד תיקים/זמן/רצפים, גרסאות, הצעות ושמירה מקומית |
| הוראות המודל | `packages/prompts/` | פרומפט מודולרי, חוזי תשובה ו־32 שדות האינטייק |
| תוכן מומצא | `fixtures/fictional/` | שלוש דמויות, ארבע פגישות עבר לכל דמות ומצב מוכן |
| כניסות השרת | `api/` | נתיבי Vercel: access, models, turn, draft |
| לוגיקת השרת | `apps/api/` | אימות, OpenRouter, בדיקת תשובות ומכסות Redis |
| ספר הפעלה | `docs/handbook/`, `scripts/build-handbook.ts` | מקור משותף ל־HTML ול־PDF |
| בדיקות | `tests/` | התנהגות, בידוד, פרומפטים, שגיאות ומכסות |

## התקנת עותק עצמאי

הכתובות בראש README שייכות לדמו המקורי. אין צורך בגישה לחשבון של המחבר כדי להפעיל את המסלול המוכן. לפריסה חיה עצמאית נדרשים חשבונות GitHub, Vercel, OpenRouter ומאגר Upstash Redis משלכם. ההסברים הבאים משתמשים בשמות `ACCOUNT`, `REPOSITORY` ו־`YOUR-API-PROJECT` כמצייני מקום שיש להחליף.

### 1. מאגר ופרויקט Vercel

צרו Fork של מאגר זה בחשבון GitHub שלכם ושכפלו את ה־Fork לפיתוח. ב־Vercel בחרו **Add New → Project**, ייבאו את המאגר שלכם, והשאירו **Root Directory בשורש המאגר** — לא `apps/web` ולא `api`. בחרו שם פרויקט זמין משלכם והגדירו את ענף הייצור לפי המאגר, כאן `main`. שמות וחשבונות מקומיים מקובץ `.vercel` של מחשב אחר אינם חלק מההתקנה. [תיעוד ייבוא Vercel](https://vercel.com/docs/git).

`vercel.json` מגדיר Vite, פקודת `npm run build`, תוצר `dist`, אזור `fra1` ו־60 שניות לפונקציות `api/*.ts`. בחרו Node.js 24 בהגדרות הפרויקט. אין להגדיר `PAGES_BASE` בפרויקט Vercel: שם הממשק מוגש בשורש `/`. הגדרות Production צריכות לאפשר גישה ציבורית ל־API מהדפדפן, תוך השארת קוד הגישה של האפליקציה פעיל.

### 2. Redis וסודות שרת

צרו מאגר Upstash Redis ייעודי לסביבת הדמו, ישירות ב־Upstash או דרך אינטגרציית Vercel. דרושים **כתובת HTTPS של REST ואסימון כתיבה רגיל**, ולא כתובת TCP מסוג `redis://` או אסימון read-only. הקוד מפעיל `PING` ו־`EVAL` של Lua שכותבים מונים, hashes, נעילות ומועדי תפוגה. בדיקת PING בלבד אינה מוכיחה שהאסימון יכול לשמור מכסות. [תיעוד REST](https://upstash.com/docs/redis/features/restapi), [תמיכת Lua](https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval).

השתמשו במאגר ייעודי או במרחב שמיועד רק לפרויקט: קידומת המפתחות קבועה `iser:v1:`. שיתוף אותו Redis בין עותקים יוצר תקציב כולל משותף. אל תגדירו eviction של מפתחות מכסה ואל תמחקו או תאפסו קבלות כדי לעקוף מגבלה. בחרו תוכנית שירות ומגבלות הוצאה משלכם; מכסות קוד המודל אינן מגבלות החיוב של שירות האירוח או Redis.

ב־Vercel → Settings → Environment Variables הגדירו את המשתנים הבאים ל־**Production**, בלי מירכאות סביב הערך ובלי ירידות שורה מיותרות. שינוי משתנה דורש פריסה חדשה כדי להיכנס לבנייה/פונקציה החדשה. [תיעוד סביבות Vercel](https://vercel.com/docs/environment-variables).

| שם | פורמט נדרש |
|---|---|
| `OPENROUTER_API_KEY` | מפתח OpenRouter מוגבל תקציב; שרת בלבד |
| `DEMO_ACCESS_CODE_HASH` | בדיוק 64 תווי hex של SHA-256 לקוד הגישה, לא הקוד עצמו |
| `SESSION_SECRET` | מחרוזת אקראית של 32 תווים לפחות |
| `KV_REST_API_URL` | כתובת HTTPS של REST עבור Redis |
| `KV_REST_API_TOKEN` | אסימון Redis עם הרשאת כתיבה והרצת הסקריפטים |
| `ALLOWED_ORIGINS` | למשל `https://ACCOUNT.github.io,http://127.0.0.1:5173` |

חלופה מלאה ל־`KV_REST_API_URL` ו־`KV_REST_API_TOKEN` היא `UPSTASH_REDIS_REST_URL` ו־`UPSTASH_REDIS_REST_TOKEN`. הגדירו זוג אחד שלם. אם שני הזוגות קיימים, כל שם `UPSTASH_` מקבל קדימות, גם אם הוא ריק או שייך למאגר אחר. אל תערבבו כתובת של מאגר אחד ואסימון של אחר.

ערכי `ALLOWED_ORIGINS` הם origins ללא נתיב וללא `/` בסוף, מופרדים בפסיקים: `https://ACCOUNT.github.io`, לא `https://ACCOUNT.github.io/REPOSITORY/`. כתובת `localhost` שונה מ־`127.0.0.1`; פורט preview הוא בדרך כלל 4173 ויש להוסיפו במפורש אם בודקים ממנו מצב חי. אין wildcard. מקור ה־API עצמו מותר אוטומטית בקוד.

### 3. יצירת קוד גישה וחומר חתימה

הפקודה הבאה עובדת ב־PowerShell ובמעטפות POSIX עם Node מותקן. היא יוצרת קובץ פרטי בתיקייה מתוארכת תחת `.local` המוחרגת מ־Git, ואינה מדפיסה את הסודות. אין להריץ אותה כחלק מ־CI או לשמור את הקובץ במאגר:

```sh
node -e "const fs=require('node:fs'),c=require('node:crypto');const dir='.local/setup_'+new Date().toISOString().replace(/[:.]/g,'-');fs.mkdirSync(dir,{recursive:true});const code=c.randomBytes(24).toString('base64url');fs.writeFileSync(dir+'/credentials.json',JSON.stringify({DEMO_ACCESS_CODE:code,DEMO_ACCESS_CODE_HASH:c.createHash('sha256').update(code,'utf8').digest('hex'),SESSION_SECRET:c.randomBytes(48).toString('base64url')},null,2),{flag:'wx',mode:0o600});console.log('Created '+dir+'/credentials.json; values were not printed.');"
```

פתחו את הקובץ **מקומית ובפרטיות**. הזינו ב־Vercel את ה־hash ואת `SESSION_SECRET`; `DEMO_ACCESS_CODE` הוא הקוד שמקלידים בממשק ולא משתנה שרת שנדרש בקוד. אין צורך לחשב hash נוסף או לצרף ירידת שורה. החלפת ה־hash או חומר החתימה מבטלת אסימונים קיימים. קוד חדש אינו מאפס את התקציב הכולל של Redis.

### 4. פריסה ובדיקה ללא inference

אחרי הגדרת הסביבה, פרסו מ־Vercel או מה־CLI שלכם. אם בוחרים CLI, הפקודות אינן כוללות חשבון או מזהה פרויקט של המחבר:

```sh
npx vercel login
npx vercel link
npx vercel env ls production
npx vercel --prod
```

ב־`link` בחרו את החשבון והפרויקט שיצרתם. ב־`https://YOUR-API-PROJECT.vercel.app/api/models` אמור להתקבל JSON, ולא דף כניסה או דף HTML. השדות `readiness.providerKey`, `readiness.access`, `readiness.quota` מפרידים בין תצורת מפתח, אימות ו־Redis. `liveReady=true` מבטא תנאי מוכנות ראשוניים: הוא אינו מאמת את תקפות מפתח OpenRouter, אינו בודק הרשאת EVAL/כתיבה ואינו מוכיח שכל שלושת המודלים נגישים לבקשת inference.

לאחר מכן פתחו את הממשק, בחרו מצב חי והיכנסו בקוד. `/api/access` מפעיל הגבלת כניסה ב־Redis ומנפיק אסימון לשעה, בלי inference בתשלום. רק פעולה מפורשת של שאלה או טיוטה חיה בודקת פנייה למודל וצורכת תקציב. בדקו בנפרד כל מודל שעליו תרצו להכריז כתומך.

### 5. GitHub Pages בעותק שלכם

במאגר שלכם פתחו **Settings → Pages → Build and deployment → Source → GitHub Actions**. תהליך העבודה כבר נמצא ב־`.github/workflows/pages.yml`; אין צורך להוסיף workflow דוגמה נוסף. [הנחיות GitHub](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

עדכנו בו את `PAGES_BASE` ל־`/REPOSITORY/` ואת `VITE_API_URL` למקור ה־API שלכם. עבור אתר משתמש/ארגון המוגש בשורש או דומיין מותאם שמוגש בשורש, הבסיס הוא `/`. ודאו שענף ההפעלה מתאים לענף הראשי של ה־Fork. `PAGES_BASE` נקרא מ־`process.env` בזמן בניית Vite: ההגדרה ב־workflow או בסביבת המעטפת היא שקובעת; שורה בקובץ dotenv אינה מחליפה אותה בתצורה הנוכחית.

ה־workflow בונה ב־Node 24, מריץ בדיקות ומעלה את `dist`, עם הרשאות `contents: read`, `pages: write`, `id-token: write`. הוא מעתיק את ספר ההפעלה שנבנה ושמור במאגר, ואינו מרנדר PDF מחדש. אחרי דחיפה ל־main בדקו את ריצת Actions ואת האתר הציבורי, לרבות קישורי הספר, כניסה חיה ו־CORS מהמקור החדש. התאימו גם את הקישורים והמטא־נתונים של הספר לעותק שלכם לפני פרסום שלו.

השרת מסרב להפעלה חיה אם שירות המכסות אינו זמין. Redis שומר **מטא־נתונים של שימוש בלבד**, ללא תוכן הפגישות או תשובות המודל; אין זו טענה על כל לוגי הפלטפורמות החיצוניות. ראו [תיעוד API](apps/api/README.md) לפירוט המגבלות, קבלות לא ודאיות ושגיאות.

## אחסון, סודות ופרסום

התיקים הבדיוניים וכל הגרסאות נשמרים ב־IndexedDB בדפדפן. אין סנכרון בין מכשירים או בין GitHub Pages ל־Vercel: אלה כתובות נפרדות עם אחסון נפרד. ייצוא JSON הוא גיבוי שניתן לייבא בכתובת השנייה. קוד הגישה והרשאת השיחה אינם נכללים בייצוא.

`.env*`, `.vercel/` ו־`.local/` מוחרגים מ־Git. `.env.example` כולל שמות והסברים בלבד. אין להעלות מפתח אמיתי. ספר ההפעלה אינו מכיל את קוד הגישה הפרטי.

GitHub Pages ו־Vercel מפרסמים את ממשק הדמו, אך האחסון המקומי בכל origin נפרד. אין להשתמש בשרת הדמו המקורי כתחליף להגדרת סודות, תקציב והרשאה בעותק שלכם.

## המשכיות עבודה

לפני המשך פיתוח, ובמיוחד אחרי קומפקט, התחילו ב־[CONTINUE_HERE.md](Implementation_2026-10-16/CONTINUE_HERE.md), לאחר מכן ביומן העבודה ובקוד הרלוונטי. התוכנית המאושרת נמצאת ב־[MASTER_PLAN_HE.md](Planning_2026-10-16/MASTER_PLAN_HE.md). עדכנו מצב, החלטות, בדיקות ותקלות פתוחות בכל אבן דרך. אין לכתוב שהבדיקה הושלמה בלי ראיה: בדיקת קוד אינה תחליף לפתיחת האתר כמשתמש.

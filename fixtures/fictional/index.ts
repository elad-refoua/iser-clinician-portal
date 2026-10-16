import type { DocumentVersion, FieldStatus, Goal, IntakeField, PortalState } from '../../packages/contracts';
import { emptyIntakeFields, intakeFields, renderIntake } from '../../packages/prompts/intake-schema';

interface SeedField { id: number; value: string; status?: FieldStatus; remaining?: string }
interface SeedVisit { summary: string; fields: SeedField[]; formulation?: string; gold?: string; supervision?: string }
interface SeedCase { id: string; name: string; age: number; description: string; visits: SeedVisit[] }

// Authored from scratch for this demonstration; no clinical files or real case material were used.
const cases: SeedCase[] = [
  {
    id: 'fictional-tamar', name: 'תמר לביא — דמות בדיונית', age: 34,
    description: 'מקרה מומצא: עובדת בהוצאה לאור; מתארת קושי לסיים את יום העבודה.',
    visits: [
      {
        summary: 'תמר סיפרה שהיא חוזרת בערב לקבצים שכבר שלחה בעבודה. היא ביקשה לשמר בתיעוד את הקושי לעצור בדיקות נוספות של עמודים שכבר הוגהו. לא תוארה התערבות מסוימת בפגישה זו.',
        fields: [
          { id: 1, value: 'תמר לביא, בת 34. כל הפרטים והפגישות בתיק זה מומצאים לצורך הדגמה.', status: 'partial', remaining: 'פרטים מנהליים נוספים לא נמסרו.' },
          { id: 3, value: 'לפי דיווח תמר בתרחיש הבדיוני, פנתה מיוזמתה.' },
          { id: 4, value: 'המקורות בתיק הם רשומות הדגמה מומצאות שנכתבו מנקודת מבט של מטפל בדיוני.' },
          { id: 5, value: 'תמר תיארה קושי לסיים את יום העבודה ולהפסיק לבדוק קבצים.' },
          { id: 6, value: 'לפי דבריה כפי שנמסרו ברשומה הבדיונית, חוזרת לעמודים שכבר שלחה גם בערב.' },
          { id: 16, value: 'עובדת בהוצאה לאור.', status: 'partial', remaining: 'משך העבודה, היקף המשרה ורקע תעסוקתי קודם לא נמסרו.' },
        ],
      },
      {
        summary: 'תמר תיארה ערב שבו פתחה שוב את קובץ ההגהה בזמן ארוחת ערב עם בת זוגה. המטפל כתב שהיא הבחינה בכך רק כשבת הזוג שאלה אם סיימה לעבוד. לא נמסר מה הייתה תגובת בת הזוג בהמשך.',
        fields: [
          { id: 8, value: 'תמר מסרה שהבדיקות החוזרות התגברו מאז שקיבלה אחריות על סדרת ספרים חדשה לפני כמה חודשים.', status: 'partial', remaining: 'מועד התחלה מדויק ותדירות לא נמסרו.' },
          { id: 14, value: 'תמר סיפרה שהיא מתגוררת עם בת זוגה.', status: 'partial', remaining: 'פרטים נוספים על היחסים ועל המסגרת המשפחתית לא נמסרו.' },
          { id: 18, value: 'תואר ערב אחד שבו בדיקת קובץ עבודה נמשכה בזמן ארוחה.', status: 'partial', remaining: 'אין תיאור רחב של שגרה, שינה או הרגלים אחרים.' },
          { id: 19, value: 'קבלת אחריות על סדרת ספרים חדשה תוארה כשינוי בעבודה.', status: 'partial', remaining: 'אירועי חיים נוספים לא נמסרו.' },
        ],
      },
      {
        summary: 'המטפל הבדיוני תיאר שעצר עם תמר על ההבדל שהיא עצמה ניסחה בין בדיקה שעוזרת לה לבין פתיחת הקובץ לאחר שכבר החליטה שסיימה. הוא לא תיעד שינוי בתדירות הבדיקות.',
        formulation: 'השערת המטפל הבדיוני: ייתכן שתמר משתמשת בבדיקה נוספת כדי להשהות את הרגע שבו העבודה יוצאת מידיה. זו השערה שלו, ולא דבר שתמר אישרה או עובדה שהוכחה.',
        gold: 'המטפל סימן ללמידה את העצירה על ההבחנה שתמר עצמה ניסחה בין שתי מטרות שונות של פתיחת אותו קובץ; לא נשמר ציטוט מילולי מפיה.',
        fields: [
          { id: 23, value: 'תמר סיפרה על חברה מהעבודה שעמה היא יכולה לדבר על משימות ההגהה.', status: 'partial', remaining: 'מקורות תמיכה נוספים לא תוארו.' },
          { id: 27, value: 'המטפל מסר שתמר ניסחה רצון לסיים את יום העבודה בלי לפתוח מחדש כל קובץ שכבר נשלח.', status: 'partial', remaining: 'לא נמסרו מטרות נוספות או מדדי מעקב מוסכמים.' },
        ],
      },
      {
        summary: 'תמר הביאה לפגישה דוגמה של ערב אחד שבו השאירה את המחשב סגור אחרי הארוחה. המטפל הדגיש ברשומה שזה תיאור של ערב אחד בלבד. הוא לא תיעד סיכום לגבי שינוי קבוע בשגרה.',
        supervision: 'המטפל הבדיוני כתב להדרכה: אני רוצה להבין כיצד להחזיק את ההבחנה שתמר ניסחה בלי להפוך אותה למדד הצלחה שהצבתי לה בעצמי.',
        fields: [
          { id: 20, value: 'לפי תיאור המטפל הבדיוני, תמר דיברה בהרחבה על ערב מסוים והבחינה בינו לבין השגרה הכללית.', status: 'partial', remaining: 'לא נמסר תיאור שיטתי של התנהגות במפגש.' },
          { id: 22, value: 'המטפל הבדיוני ציין במפורש שהערכת סיכון לא נבדקה במסגרת רשומות ההדגמה הללו.', status: 'not_assessed' },
          { id: 28, value: 'המטפל תיעד שסוכם להמשיך בפגישות השבועיות; לא נמסרה גישה טיפולית מוגדרת.', status: 'partial', remaining: 'פרטי תוכנית וגישה טיפולית לא נמסרו.' },
        ],
      },
    ],
  },
  {
    id: 'fictional-eitan', name: 'איתן רום — דמות בדיונית', age: 61,
    description: 'מקרה מומצא: פרש לאחרונה מעבודתו; מתאר שינוי במבנה היום.',
    visits: [
      {
        summary: 'איתן סיפר שמאז הפרישה אין לו שעה קבועה לצאת מהבית. הוא הביא דוגמה של בוקר שבו הכין קפה ונשאר במטבח בלי תוכנית להמשך היום. לא נמסרה הערכה אבחנתית.',
        fields: [
          { id: 1, value: 'איתן רום, בן 61. כל הפרטים והפגישות בתיק זה מומצאים לצורך הדגמה.', status: 'partial', remaining: 'פרטים מנהליים נוספים לא נמסרו.' },
          { id: 3, value: 'איתן סיפר שאחותו הציעה לו לפנות, והוא יצר קשר בעצמו.' },
          { id: 4, value: 'המקורות בתיק הם רשומות הדגמה מומצאות שנכתבו מנקודת מבט של מטפל בדיוני.' },
          { id: 5, value: 'איתן ביקש לדבר על השינוי בסדר היום בעקבות הפרישה.' },
          { id: 6, value: 'איתן תיאר בקרים בלי שעה קבועה לצאת מהבית.' },
          { id: 16, value: 'איתן סיפר שפרש מעבודה כרכז תפעול במרכז קהילתי.', status: 'partial', remaining: 'משך העבודה הקודמת ומועד הפרישה המדויק לא נמסרו.' },
          { id: 14, value: 'ברשומת הפגישה הראשונה נכתב שאיתן גר לבדו.', status: 'partial', remaining: 'פרטים נוספים על המסגרת המשפחתית לא נמסרו.' },
        ],
      },
      {
        summary: 'איתן סיפר שאחיו עדיין גר איתו מאז שיפוץ בדירת האח. המטפל הבחין שהדבר אינו תואם את הרישום בפגישה הראשונה. לא תועד בירור של ההבדל, ולכן הרשומה משאירה אותו פתוח.',
        fields: [
          { id: 14, value: 'בפגישה 1 נכתב שאיתן גר לבדו; בפגישה 2 הוא מסר שאחיו עדיין מתגורר איתו מאז שיפוץ בדירת האח. ההבדל בין הדיווחים לא הוכרע.', status: 'conflict', remaining: 'להבהיר את הפער בין שני הדיווחים; אין בסיס לקבוע מתי השתנה מקום המגורים.' },
          { id: 19, value: 'איתן תיאר את הפרישה כשינוי משמעותי בחייו.', status: 'partial', remaining: 'אירועי חיים נוספים לא נמסרו.' },
          { id: 18, value: 'איתן תיאר כמה בקרים ללא תוכנית קבועה.', status: 'partial', remaining: 'לא נמסר מידע מספק על שינה, תזונה או תפקוד יומיומי רחב.' },
        ],
      },
      {
        summary: 'המטפל חזר עם איתן לדוגמה של הודעה מעמית לשעבר. איתן סיפר ששמח לקבל את ההודעה אך לא השיב לה באותו יום. לא נמסר הסבר של איתן לדחייה בתשובה.',
        formulation: 'השערת המטפל הבדיוני: ייתכן שהקשר עם עמיתים לשעבר מחזיק עבור איתן גם המשכיות וגם תזכורת למה שהשתנה. המטפל ציין שאין עדיין די חומר כדי להכריע בכך.',
        fields: [
          { id: 17, value: 'איתן סיפר על הודעה מעמית לשעבר ועל כך שלא ענה באותו יום.', status: 'partial', remaining: 'אין בכך תמונה מספקת של קשריו החברתיים.' },
          { id: 23, value: 'לפי דיווח איתן, אחותו שומרת עמו על קשר והוא יכול להתקשר אליה.', status: 'partial', remaining: 'משאבים נוספים לא תוארו.' },
          { id: 9, value: 'המטפל הבדיוני כתב שאינו זוכר אם נשאל בפגישות אלה על טיפול קודם.', status: 'not_recalled', remaining: 'ההיסטוריה הטיפולית עצמה לא ידועה; חוסר הזיכרון אינו הוכחה שלא נשאלה.' },
        ],
      },
      {
        summary: 'איתן סיפר שהשיב לעמית לשעבר ושוחחו על תיקון של שולחן שבנה. המטפל כתב רק את מה שנמסר על השיחה, בלי להסיק על שינוי כולל במצבו.',
        gold: 'המטפל סימן ללמידה את הבחירה להישאר עם תיאור השיחה על השולחן בלי להציג אותה מיד כהתקדמות כללית.',
        supervision: 'המטפל הבדיוני כתב להדרכה: אני מתלבט איך לברר עם איתן מה חשוב לו בתקופה הזו בלי להניח שעיקר הבעיה הוא היעדר סדר יום.',
        fields: [
          { id: 27, value: 'המטפל תיעד שאיתן רוצה לברר מה היה רוצה לשמר בשבועות שאחרי הפרישה.', status: 'partial', remaining: 'לא נמסרו מטרות מוגדרות נוספות.' },
          { id: 10, value: 'איתן אמר שיש לו מעקב רפואי שגרתי, ללא פירוט נוסף.', status: 'partial', remaining: 'אין מידע על סיבת המעקב, מצבים רפואיים או תרופות; אין להסיק מהם לכאן.' },
          { id: 30, value: 'המטפל תיעד שנקבעה פגישה נוספת בשבוע שלאחר מכן.', status: 'partial', remaining: 'לא נמסרו הפניות או המלצות נוספות.' },
        ],
      },
    ],
  },
  {
    id: 'fictional-noa', name: 'נועה קדם — דמות בדיונית', age: 27,
    description: 'מקרה מומצא: סטודנטית לתואר מתקדם; מתארת קושי לשלוח טיוטה למנחה.',
    visits: [
      {
        summary: 'נועה סיפרה שהכינה קובץ טיוטה לעבודת התואר אך עדיין לא שלחה אותו למנחה. היא תיארה חזרה לאותה פסקת פתיחה בכמה ערבים. לא נמסר ציטוט מילולי שלה.',
        fields: [
          { id: 1, value: 'נועה קדם, בת 27. כל הפרטים והפגישות בתיק זה מומצאים לצורך הדגמה.', status: 'partial', remaining: 'פרטים מנהליים נוספים לא נמסרו.' },
          { id: 4, value: 'המקורות בתיק הם רשומות הדגמה מומצאות שנכתבו מנקודת מבט של מטפל בדיוני.' },
          { id: 5, value: 'נועה ביקשה לדבר על הקושי לשלוח טיוטת עבודה למנחה.' },
          { id: 6, value: 'נועה תיארה חזרה לעריכת אותה פסקת פתיחה במקום לשלוח את הקובץ.' },
          { id: 15, value: 'נועה לומדת לתואר מתקדם.', status: 'partial', remaining: 'תחום הלימודים, משכם והרקע הלימודי הקודם לא נמסרו.' },
          { id: 7, value: 'המטפל הבדיוני ציין שסעיף מידע ממלווה אינו רלוונטי לרשומות אלה: נועה פונה כמבוגרת עצמאית ולא נמסר מידע מטעם מלווה.', status: 'not_applicable' },
        ],
      },
      {
        summary: 'נועה סיפרה שהיא עובדת פעמיים בשבוע בספרייה. היא תיארה הבדל בין משימות העבודה, שבהן ידוע לה מתי לסיים, לבין הכתיבה בבית. המטפל לא תיעד הסבר לסיבה להבדל.',
        fields: [
          { id: 16, value: 'נועה סיפרה שהיא עובדת פעמיים בשבוע בספרייה.', status: 'partial', remaining: 'תפקיד מדויק וניסיון תעסוקתי קודם לא נמסרו.' },
          { id: 8, value: 'נועה תיארה חזרה לאותה פסקה בכמה ערבים והשוותה את הכתיבה למשימות העבודה בספרייה.', status: 'partial', remaining: 'מועד התחלת הקושי והיקפו מעבר למשימת הכתיבה לא נמסרו.' },
          { id: 14, value: 'נועה סיפרה שהיא שוכרת דירה עם שתי שותפות.', status: 'partial', remaining: 'פרטים נוספים על יחסים ועל המסגרת המשפחתית לא נמסרו.' },
        ],
      },
      {
        summary: 'המטפל ביקש מנועה לתאר את הפעם האחרונה שבה עמדה לשלוח את הקובץ. היא סיפרה שפתחה את חלון הדואר ואז חזרה לטיוטה. בהמשך הפגישה לא תועד אם שלחה את הקובץ.',
        formulation: 'השערת המטפל הבדיוני: ייתכן שלרגע שליחת הטיוטה יש משמעות שונה עבור נועה מן העבודה על הטקסט עצמו. המטפל השאיר את משמעות ההבדל פתוחה ולא הציע הסבר מחייב.',
        fields: [
          { id: 20, value: 'המטפל תיאר שנועה נתנה רצף קונקרטי של פעולות סביב פתיחת הדואר והחזרה לקובץ.', status: 'partial', remaining: 'לא נמסרה התרשמות שיטתית מהתנהגותה או סטטוס נפשי.' },
          { id: 23, value: 'נועה סיפרה שחברה ללימודים מוכנה לקרוא חלק מן הטיוטה אם תבקש.', status: 'partial', remaining: 'לא נמסר אם נעזרה בה או אילו משאבים נוספים זמינים לה.' },
          { id: 27, value: 'המטפל מסר שנועה רוצה להבין מה קורה סמוך לרגע שבו היא עומדת לשלוח טקסט.', status: 'partial', remaining: 'לא נמסרו מטרות נוספות.' },
        ],
      },
      {
        summary: 'נועה סיפרה שהפעם שלחה למנחה שתי פסקאות בלבד. היא אמרה שטרם קיבלה תגובה. המטפל הבדיוני לא תיעד תחושה שלה לאחר השליחה, ולכן היא אינה מופיעה ברשומה.',
        gold: 'המטפל סימן ללמידה את הבקשה לתיאור רצף הפעולות בפגישה הקודמת, וציין שאין בידיו ציטוט מדויק של ניסוח השאלה.',
        supervision: 'המטפל הבדיוני כתב להדרכה: אני רוצה לבדוק כיצד לשמור על סקרנות גם כאשר נועה מספרת ששלחה משהו, בלי להכריז בשבילה שזה פתר את הקושי.',
        fields: [
          { id: 29, value: 'המטפל כתב שלא זכורה לו תגובה מפורשת של נועה לתוכנית טיפול שהוצעה.', status: 'not_recalled', remaining: 'התוכנית עצמה לא פורטה; אין להסיק הסכמה או התנגדות.' },
          { id: 31, value: 'המטפל ציין שלא התקבלו מסמכים נלווים בתרחיש הבדיוני עד פגישה 4.' },
        ],
      },
    ],
  },
];

const dates = ['2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09'];
const goals: Goal[] = ['note', 'formulation', 'intake', 'gold', 'supervision'];

export function createDemoState(): PortalState {
  const state: PortalState = { schemaVersion: 1, patients: [], branches: [], sessions: [], sources: [], versions: [], preferences: [] };
  for (const [caseIndex, item] of cases.entries()) {
    const branchId = `${item.id}-main`;
    state.patients.push({ id: item.id, name: item.name, age: item.age, description: item.description, fictional: true });
    state.branches.push({ id: branchId, patientId: item.id, name: 'הרצף המקורי הבדיוני' });
    let fields = emptyIntakeFields();
    const accumulated: Partial<Record<Goal, Array<{ text: string; sourceId: string; sessionNumber: number }>>> = {};
    const previous: Partial<Record<Goal, DocumentVersion>> = {};
    for (const [visitIndex, visit] of item.visits.entries()) {
      const number = visitIndex + 1;
      const at = `${dates[visitIndex]}T${String(8 + caseIndex).padStart(2, '0')}:00:00.000Z`;
      const sessionId = `${item.id}-session-${number}`;
      const sourceId = `${item.id}-source-${number}`;
      const additions = [...visit.fields];
      if (visit.formulation) additions.push({ id: 26, value: visit.formulation, status: 'partial', remaining: 'ההשערה זמנית ומיוחסת למטפל; לא נמסר אישוש או הסבר נוסף.' });
      const sourceText = [
        'מקור הדגמה מומצא במלואו. אינו תמליל, אינו רשומת מטופל אמיתי ואינו מבוסס על מקרה אמיתי.',
        `פגישה בדיונית ${number}, ${dates[visitIndex]}.`, visit.summary,
        ...additions.map(field => `${intakeFields.find(meta => meta.id === field.id)!.label}: ${field.value}${field.remaining ? ` ${field.remaining}` : ''}`),
        visit.gold ? `סימון מפורש של המטפל לחומרי למידה: ${visit.gold}` : '',
        visit.supervision ? `סימון מפורש של המטפל להדרכה בלבד: ${visit.supervision}` : '',
      ].filter(Boolean).join('\n\n');
      state.sources.push({ id: sourceId, patientId: item.id, branchId, sessionId, sessionNumber: number, text: sourceText, recordedAt: at, kind: 'seed' });
      const nextFields = new Map<number, IntakeField>(fields.map(field => [field.id, field]));
      for (const field of additions) {
        const old = nextFields.get(field.id)!;
        nextFields.set(field.id, {
          id: field.id, value: field.value, status: field.status ?? 'documented',
          sourceIds: field.status === 'conflict' ? [...old.sourceIds, sourceId] : [sourceId],
          remaining: field.remaining ?? '',
        });
      }
      fields = [...nextFields.values()];
      state.sessions.push({
        id: sessionId, patientId: item.id, branchId, number, startedAt: at, revision: 1,
        status: 'approved', composer: '', questionCount: 0, intakeCount: 0, intakeActive: false,
        skippedTopics: [], traces: [], messages: [{ id: `${sessionId}-message`, role: 'user', text: sourceText, sourceId, at }],
      });
      for (const kind of goals) {
        const addition = kind === 'formulation' ? visit.formulation : kind === 'gold' ? visit.gold : kind === 'supervision' ? visit.supervision : undefined;
        if (addition) (accumulated[kind] ??= []).push({ text: addition, sourceId, sessionNumber: number });
        const entries = accumulated[kind] ?? [];
        const sourceIds = kind === 'note' ? [sourceId] : kind === 'intake'
          ? [...new Set(fields.flatMap(field => field.sourceIds))] : entries.map(entry => entry.sourceId);
        const content = kind === 'note' ? `# רשומת פגישה ${number} — הדגמה בדיונית\n\n${visit.summary}\n\nמקור: רשומת הדגמה מפגישה ${number}`
          : kind === 'intake' ? `# אינטייק מצטבר — תוכן בדיוני, עד פגישה ${number}\n\nמבנה הדוח מלא; מידע חסר נשאר גלוי.\n\n${renderIntake(fields)}`
            : `# ${kind === 'formulation' ? 'המשגה' : 'gold' === kind ? 'חומרי למידה' : 'לקראת הדרכה'} — הדגמה בדיונית\n\n${entries.length ? entries.map(entry => `${entry.text}\nמקור: רשומת הדגמה מפגישה ${entry.sessionNumber}`).join('\n\n') : 'לא נמסר חומר ייעודי לתוצר זה עד פגישה זו.'}`;
        const version: DocumentVersion = {
          id: `${sessionId}-${kind}-v1`, patientId: item.id, branchId, kind, sessionId, sessionNumber: number,
          content, sourceIds, createdAt: at, author: 'seed', approved: true,
          reason: `גרסת מקור מוכנה מראש של תרחיש בדיוני, נכון לפגישה ${number}`,
          ...(kind === 'intake' ? { fields: structuredClone(fields) } : {}),
          ...(kind !== 'note' && previous[kind] ? { baseVersionId: previous[kind]!.id } : {}),
        };
        state.versions.push(version);
        previous[kind] = version;
      }
    }
  }
  return state;
}

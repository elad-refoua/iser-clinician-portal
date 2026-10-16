import type { ContextPacket, DraftDocument, DraftResult, Goal, IntakeField, Preference, Source, TurnResult } from '../../packages/contracts';
import { emptyIntakeFields } from '../../packages/prompts/intake-schema';
import { renderIntakeReport } from '../../packages/domain/intake-report';

const familyWords = ['משפחה', 'משפחתי', 'משפחתית', 'הורים', 'אמא', 'אבא', 'אם', 'אב', 'אחיו', 'אחותו', 'ילדים'];
const topicGroups: Record<string, string[]> = {
  'רקע משפחתי': familyWords,
  'עבודה': ['עבודה', 'תעסוקה', 'תעסוקתי', 'משרה', 'עמית'],
  'לימודים': ['לימודים', 'לימודי', 'השכלה', 'תואר', 'מנחה'],
  'קשרים': ['קשרים', 'יחסים', 'זוגיות', 'בת זוג', 'בן זוג', 'שותפ'],
  'סיכון': ['סיכון', 'מסוכנות', 'אובדנות', 'פגיעות'],
  'טיפול תרופתי': ['תרופ'],
};
const draftTransition = 'נעבור לטיוטה עם מה שכבר נמסר. פרטים חסרים יישארו מסומנים.';

function normalized(text: string): string { return text.normalize('NFKC').replace(/[\u0591-\u05C7]/g, '').toLowerCase().trim(); }

function topicMatches(text: string, topic: string): boolean {
  const target = normalized(text);
  const query = normalized(topic);
  if (!query) return false;
  if (target.includes(query) || query.includes(target)) return true;
  return Object.values(topicGroups).some(words => words.some(word => query.includes(word)) && words.some(word => target.includes(word)));
}

function sourcesInScope(context: ContextPacket): Source[] {
  return context.sources.filter(source => {
    if (source.patientId !== context.patientId) return false;
    const scope = context.branchScope.find(item => item.branchId === source.branchId);
    if (!scope || (source.sessionNumber !== undefined && source.sessionNumber > scope.throughSession)) return false;
    if (source.sessionId === context.sessionId && source.branchId === context.branchId) return true;
    return source.recordedAt <= context.asOf && (!scope.cutoffAt || source.recordedAt <= scope.cutoffAt);
  });
}

function activePreferences(context: ContextPacket): Preference[] {
  return context.preferences.filter(item => item.scope === 'patient' || !item.sessionId || item.sessionId === context.sessionId);
}

function blocked(context: ContextPacket, topic: string): boolean {
  return context.skippedTopics.some(skipped => topicMatches(topic, skipped))
    || activePreferences(context).some(pref => pref.action === 'block' && topicMatches(topic, pref.topic));
}

function recognizedPreference(text: string): TurnResult['preferenceUpdates'] {
  const action = /אל\s+(?:תשאל|תשאלי|לשאול)|לא\s+(?:לשאול|לשאול אותי)|בלי\s+שאלות/.test(text) ? 'block'
    : /פחות\s+(?:על|שאלות)/.test(text) ? 'less' : undefined;
  if (!action) return [];
  const topic = Object.entries(topicGroups).find(([, words]) => words.some(word => normalized(text).includes(word)))?.[0];
  if (!topic) return [];
  return [{ topic, action, scope: /מהיום|בהמשך הטיפול|בכל הפגישות|באופן קבוע/.test(text) ? 'patient' : 'session' }];
}

function currentFields(context: ContextPacket): IntakeField[] {
  const supplied = context.documents.find(doc => doc.kind === 'intake')?.fields ?? [];
  const byId = new Map(supplied.map(field => [field.id, field]));
  const sourceIds = new Set(sourcesInScope(context).map(source => source.id));
  return emptyIntakeFields().map(empty => {
    const field = byId.get(empty.id);
    if (!field) return empty;
    if (field.sourceIds.some(id => !sourceIds.has(id))) return { ...empty, remaining: 'המקור לשדה אינו זמין בהקשר הנוכחי; התוכן לא הועתק.' };
    return { ...field, sourceIds: [...field.sourceIds] };
  });
}

const optionalQuestions: Array<{ id: number; topic: string; question: string }> = [
  { id: 8, topic: 'התפתחות הקושי', question: 'מה ידוע לך על מועד תחילת הקושי שתואר?' },
  { id: 5, topic: 'סיבת הפנייה', question: 'מה נמסר על סיבת הפנייה?' },
  { id: 6, topic: 'תלונת המטופל', question: 'איך תואר הקושי במילים שנמסרו לך?' },
  { id: 14, topic: 'רקע משפחתי', question: 'מה ידוע לך על מסגרת המגורים הנוכחית?' },
  { id: 16, topic: 'עבודה', question: 'מה נמסר לך על העיסוק הנוכחי?' },
  { id: 9, topic: 'היסטוריה טיפולית', question: 'מה ידוע לך על פנייה קודמת לטיפול?' },
  { id: 10, topic: 'רקע רפואי', question: 'איזה מידע על רקע רפואי נמסר לך?' },
  { id: 11, topic: 'טיפול תרופתי', question: 'איזה מידע נמסר על טיפול תרופתי?' },
  { id: 23, topic: 'משאבים', question: 'אילו מקורות תמיכה תוארו בפגישות?' },
  { id: 27, topic: 'מטרות הטיפול', question: 'איזו מטרה לטיפול כבר נוסחה בשיחה?' },
  { id: 28, topic: 'תוכנית טיפול', question: 'מה כבר תועד לגבי תוכנית הטיפול?' },
  { id: 2, topic: 'פרטי הפסיכולוג', question: 'איך לציין בדוח את פרטי הפסיכולוג והסטטוס המקצועי?' },
];

/** Deterministic demonstration, not inference or a model completion. */
export function preparedTurn(context: ContextPacket): TurnResult {
  const last = [...context.messages].reverse().find(message => message.role === 'user')?.text ?? '';
  const freshIntakeRound = context.stage === 'intake' && context.intakeCount === 0;
  const preferenceUpdates = freshIntakeRound ? [] : recognizedPreference(last);
  const finish = (reason: string): TurnResult => ({ action: 'draft', utterance: draftTransition, topic: 'סיום', rationale: `הדגמה מוכנה מראש: ${reason}`, fieldUpdates: [], preferenceUpdates });
  if (context.stage === 'draft') return finish('נבחרה יצירת טיוטה.');
  if (!freshIntakeRound && /(?:אין לי|אין יותר)\s+(?:עוד\s+)?זמן|סיימתי(?: להיום)?|סיים לטיוטה|נעבור לטיוטה|זה מה שיש|(?:זהו|די)[.!\s]*$|לא רוצה להמשיך|לא זוכר(?:ת)?|לא זכור|דלג/.test(last)) return finish('בקשת סיום, דילוג או חוסר זיכרון מכובדים בלי שאלה נוספת.');
  if (context.stage === 'main' && context.questionCount >= 3) return finish('מכסת שלוש שאלות ההמשך מוצתה.');
  if (context.stage === 'intake' && context.intakeCount >= 2) return finish('סבב ההשלמה הרצוני הגיע לשתי שאלות.');
  if (preferenceUpdates.some(pref => pref.action === 'block')) return finish('זוהתה בקשת חסימה מפורשת; ההדגמה עוברת לטיוטה בלי לבקש עוד מידע.');
  if (context.stage === 'intake') {
    const fields = currentFields(context);
    const available = optionalQuestions.filter(candidate => {
      const field = fields.find(item => item.id === candidate.id)!;
      return (field.status === 'unknown' || field.status === 'partial')
        && !blocked(context, candidate.topic)
        && !context.messages.some(message => message.role === 'assistant' && message.text === candidate.question)
        && !activePreferences(context).some(pref => pref.action === 'less' && topicMatches(candidate.topic, pref.topic));
    });
    const selected = available[context.intakeCount] ?? available[0];
    if (!selected) return finish('לא נמצא בירור מוכן שאינו חוזר על נושא ואינו מפר העדפה.');
    return { action: 'question', utterance: selected.question, topic: selected.topic, fieldUpdates: [], preferenceUpdates, rationale: `הדגמה מוכנה מראש: נבחר שדה ${selected.id} שמצבו חסר או חלקי; לא בוצע חילוץ מטקסט חופשי.` };
  }
  // One prepared follow-up is enough: arbitrary prose is never treated as a parsed clinical response.
  if (context.questionCount > 0) return finish('לאחר שאלת ההמשך המוכנה נשמר הטקסט כפי שנכתב; אין הסקה אוטומטית מתשובה חופשית.');
  if (!last.trim()) return finish('לא נמסר שיתוף חופשי; אפשר לערוך טיוטה ריקה בלי להמציא תוכן.');
  let topic = 'רשומת הפגישה';
  let utterance = 'מה מתוך הפגישה חשוב לך במיוחד לשמור ברשומה?';
  if (/נראה לי|התרשמתי|השערה/.test(last)) {
    topic = 'בסיס להתרשמות'; utterance = 'מה בפגישה הוביל אותך למחשבה הזאת?';
  } else if (/עבודה|תעסוק/.test(last)) {
    topic = 'עבודה'; utterance = 'מה מתוך השיחה על העבודה חשוב לך לשמור?';
  }
  if (blocked(context, topic) || context.skippedTopics.length || activePreferences(context).some(pref => pref.action === 'block')) return finish('נמנעת שאלה כללית שעלולה להחזיר לשיחה נושא שנחסם או דולג.');
  return { action: 'question', utterance, topic, fieldUpdates: [], preferenceUpdates, rationale: 'הדגמה מוכנה מראש: שאלה אחת על התיעוד, בלי לפרש את התוכן ובלי לשנות שדות אינטייק.' };
}

function exclusionPreferences(context: ContextPacket, kind: Goal): Preference[] {
  return activePreferences(context).filter(pref => pref.action === 'exclude' && (!pref.goal || pref.goal === kind));
}

function quoteSource(source: Source): string {
  const label = source.sessionNumber ? `פגישה ${source.sessionNumber}` : source.kind === 'manual' ? 'עריכה ידנית' : 'שיתוף המטפל';
  return `טקסט מקור שהוקלד, ללא חילוץ או פרשנות (מקור: ${label}):\n\n${source.text.split('\n').map(line => `> ${line}`).join('\n')}`;
}

/** Preserves source text and existing documents; never simulates extraction from arbitrary input. */
export function preparedDraft(context: ContextPacket): DraftResult {
  const safeSources = sourcesInScope(context);
  const safeIds = new Set(safeSources.map(source => source.id));
  const current = safeSources.filter(source => source.sessionId === context.sessionId && source.kind !== 'seed');
  const labels: Record<Goal, string> = { note: 'רשומת הפגישה', formulation: 'המשגה', intake: 'אינטייק', gold: 'חומרי למידה', supervision: 'לקראת הדרכה' };
  const goals: Goal[] = ['note', 'formulation', 'intake', 'gold', 'supervision'];
  const documents: DraftDocument[] = goals.map(kind => {
    const excluded = exclusionPreferences(context, kind);
    const existing = context.documents.find(doc => doc.kind === kind);
    const isPriorSessionNote = kind === 'note' && existing && existing.sourceIds.length > 0
      && !existing.sourceIds.some(id => safeSources.some(source => source.id === id && source.sessionId === context.sessionId));
    const existingUsable = existing && !isPriorSessionNote && existing.sourceIds.every(id => safeIds.has(id));
    const title = `# ${labels[kind]} — טיוטת הדגמה מוכנה מראש`;
    const parts = [title, 'זהו עיבוד מקומי קבוע, ללא פנייה למודל. טקסט חדש נשמר כלשונו; שדות אינם מתמלאים אוטומטית ממנו.'];
    const sourceIds = new Set<string>();
    if (kind === 'intake') {
      const fields = currentFields(context);
      fields.flatMap(field => field.sourceIds).forEach(id => sourceIds.add(id));
      parts.push('מבנה הדוח כולל את כל 32 השדות ותשעת החלקים. מידע חסר אינו מעיד על היעדר תופעה.', renderIntakeReport(fields, excluded));
    } else {
      if (existingUsable && !excluded.length) {
        if (existing.content.startsWith(title)) parts.splice(0, parts.length, existing.content);
        else parts.push('## הנוסח הקיים\n\n' + existing.content);
        existing.sourceIds.forEach(id => sourceIds.add(id));
      } else if (existing && excluded.length) {
        parts.push('הנוסח הקודם לא הועתק אוטומטית, כדי לכבד החרגת תוכן. אפשר לעיין במקור ולערוך ישירות.');
      }
      const route = (source: Source): Goal => /להדרכה|הדרכה בלבד/.test(source.text) ? 'supervision' : /ללמידה|זהב קליני/.test(source.text) ? 'gold' : 'note';
      const permitted = current.filter(source => route(source) === kind
        && !(existingUsable && existing.sourceIds.includes(source.id))
        && !excluded.some(pref => topicMatches(source.text, pref.topic)));
      if (permitted.length) {
        parts.push('## חומר חדש לעיון ולעריכה\n\n' + permitted.map(quoteSource).join('\n\n'));
        permitted.forEach(source => sourceIds.add(source.id));
      } else if (!existingUsable) {
        parts.push(kind === 'note' ? 'לא נמסר כאן טקסט חדש שניתן להוסיף לרשומה. אפשר לכתוב או לערוך ישירות.' : 'לא נוסף חומר ייעודי לתוצר זה. אין השלמה קלינית אוטומטית.');
      }
      const formulationNotice = 'לא נוספה המשגה מתוך הטקסט החדש במסלול המוכן. אפשר לערוך את ההמשגה ישירות; כל השערה נשארת מיוחסת למטפל.';
      if (kind === 'formulation' && current.length && !parts.some(part => part.includes(formulationNotice))) parts.push(formulationNotice);
    }
    return { kind, content: parts.join('\n\n'), sourceIds: [...sourceIds] };
  });
  return { documents, fieldUpdates: [], rationale: 'הדגמה מוכנה מראש: נשמרו מסמכים ושדות קיימים ממקורות מותרים, וטקסט חדש הובא כלשונו. לא בוצעו חילוץ חופשי, השלמת עובדות או המלצה קלינית.' };
}

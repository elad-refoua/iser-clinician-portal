import type { IntakeField, Preference } from '../contracts';
import { intakeFields, renderIntake, renderLegacyIntake } from '../prompts/intake-schema.js';

const normalize = (text: string) => text.normalize('NFKC').replace(/[\u0591-\u05C7]/g, '').toLowerCase().trim();
const labelGroups = [
  ['משפחה', 'משפחתי', 'משפחתית', 'הורים', 'אמא', 'אבא', 'ילדים'],
  ['עבודה', 'תעסוקה', 'תעסוקתי'],
  ['לימודים', 'לימודי', 'השכלה', 'השכלתי'],
  ['קשרים', 'יחסים', 'זוגיות'],
  ['סיכון', 'מסוכנות', 'אובדנות', 'פגיעות'],
  ['תרופות', 'תרופתי'],
];
const words = (text: string) => normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).flatMap(word => word.startsWith('ה') && word.length > 3 ? [word, word.slice(1)] : [word]);

/** Literal topic matching plus a small label vocabulary; this does not infer semantic paraphrases. */
export function intakeTopicMatches(field: IntakeField, topic: string): boolean {
  const query = normalize(topic);
  if (!query) return false;
  const label = intakeFields.find(item => item.id === field.id)?.label ?? '';
  // Hebrew prepositions can attach to a topic; short fragments still require a full word.
  const prefix = /^[א-ת]{3}/u.test(query) ? '(?:ו?(?:[בכלמש]ה?|ה)?)?' : '';
  const literal = new RegExp(`(?:^|[^\\p{L}\\p{N}])${prefix}${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u');
  if (literal.test(normalize(`${label}\n${field.value}\n${field.remaining ?? ''}`))) return true;
  const queryWords = words(topic); const labelWords = words(label);
  return labelGroups.some(group => group.some(word => queryWords.includes(word)) && group.some(word => labelWords.includes(word)));
}

/** Redacts a report copy only; the structured ledger and source history remain unchanged. */
export function renderIntakeReport(fields: IntakeField[], preferences: Preference[]): string {
  return renderIntake(reportFields(fields, preferences));
}

/** Historical recognition only; this does not rewrite a stored document or field. */
export function renderLegacyIntakeReport(fields: IntakeField[], preferences: Preference[]): string {
  return renderLegacyIntake(reportFields(fields, preferences));
}

function reportFields(fields: IntakeField[], preferences: Preference[]): IntakeField[] {
  const exclusions = preferences.filter(pref => pref.action === 'exclude' && (!pref.goal || pref.goal === 'intake'));
  return fields.map(field => exclusions.some(pref => intakeTopicMatches(field, pref.topic))
    ? { ...field, value: 'תוכן השדה הוחרג מתוצר זה לבקשת המטפל.', remaining: '', sourceIds: [] }
    : field);
}

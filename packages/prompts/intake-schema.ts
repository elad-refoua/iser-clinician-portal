import type { FieldStatus, IntakeField } from '../contracts';

export const intakeFields: Array<{ id: number; label: string }> = [
  { id: 1, label: 'פרטים מזהים ופרטי המפגש' },
  { id: 2, label: 'פרטי הפסיכולוג והסטטוס המקצועי' },
  { id: 3, label: 'הגורם המפנה' },
  { id: 4, label: 'מקורות המידע' },
  { id: 5, label: 'סיבת הפנייה' },
  { id: 6, label: 'תלונת המטופל' },
  { id: 7, label: 'תלונות ומידע מהורים, אפוטרופוסים או מלווים' },
  { id: 8, label: 'הבעיה הנוכחית והתפתחותה' },
  { id: 9, label: 'היסטוריה טיפולית ופסיכיאטרית' },
  { id: 10, label: 'רקע רפואי ומחלות נלוות' },
  { id: 11, label: 'טיפול תרופתי' },
  { id: 12, label: 'אנמנזה התפתחותית' },
  { id: 13, label: 'רקע משפחתי' },
  { id: 14, label: 'מסגרת משפחתית ומערכות יחסים' },
  { id: 15, label: 'רקע לימודי והשכלתי' },
  { id: 16, label: 'רקע תעסוקתי' },
  { id: 17, label: 'תפקוד חברתי ובין־אישי' },
  { id: 18, label: 'תפקוד יומיומי והרגלים' },
  { id: 19, label: 'אירועי חיים משמעותיים וגורמי דחק' },
  { id: 20, label: 'התרשמות מהמפגש והתנהגות במהלכו' },
  { id: 21, label: 'סטטוס נפשי וקוגניטיבי' },
  { id: 22, label: 'הערכת אובדנות, מסוכנות ופגיעוּת' },
  { id: 23, label: 'כוחות, משאבים וגורמי הגנה' },
  { id: 24, label: 'אבחנה ראשונית או משוערת' },
  { id: 25, label: 'אבחנות נוספות ומצבים המשפיעים על הטיפול' },
  { id: 26, label: 'המשגה פסיכולוגית ושיקולים קליניים' },
  { id: 27, label: 'מטרות הטיפול' },
  { id: 28, label: 'תוכנית וגישה טיפולית' },
  { id: 29, label: 'תגובת המטופל לתוכנית המוצעת' },
  { id: 30, label: 'המלצות, הפניות והמשך מעקב' },
  { id: 31, label: 'מסמכים ומידע נלווה' },
  { id: 32, label: 'תאריך, שם מלא וחתימת הפסיכולוג' },
];

export const intakeSections: Array<{ title: string; fieldIds: number[] }> = [
  { title: 'פרטים כלליים ומקורות מידע', fieldIds: [1, 2, 3, 4, 31] },
  { title: 'סיבת הפנייה והבעיה הנוכחית', fieldIds: [5, 6, 7, 8] },
  { title: 'רקע ואנמנזה', fieldIds: [9, 10, 11, 12, 13, 14, 19] },
  { title: 'תפקוד נוכחי', fieldIds: [15, 16, 17, 18] },
  { title: 'התרשמות וסטטוס נפשי', fieldIds: [20, 21] },
  { title: 'הערכת סיכון', fieldIds: [22, 23] },
  { title: 'אבחנה והמשגה קלינית', fieldIds: [24, 25, 26] },
  { title: 'מטרות ותוכנית טיפול', fieldIds: [27, 28, 29] },
  { title: 'המלצות וסיכום מקצועי', fieldIds: [30, 32] },
];

export const fieldStatusLabels: Record<FieldStatus, string> = {
  documented: 'תועד', partial: 'תועד חלקית', unknown: 'לא הוזכר',
  not_assessed: 'לא נבדק', not_recalled: 'לא זכור', conflict: 'קיימת סתירה',
  not_applicable: 'לא רלוונטי',
};

export function emptyIntakeFields(): IntakeField[] {
  return intakeFields.map(({ id }) => ({ id, value: '', status: 'unknown', sourceIds: [] }));
}

export function renderIntake(fields: IntakeField[]): string {
  const byId = new Map(fields.map(field => [field.id, field]));
  return intakeSections.map(section => {
    const items = section.fieldIds.map(id => {
      const field = byId.get(id);
      const label = intakeFields.find(item => item.id === id)!.label;
      const status = field?.status ?? 'unknown';
      const value = field?.value.trim() || 'לא נמסר מידע בשדה זה.';
      const remaining = field?.remaining?.trim();
      return `### ${id}. ${label}\nמצב: ${fieldStatusLabels[status]}\n${value}${remaining ? `\nלהשלמה: ${remaining}` : ''}`;
    });
    return `## ${section.title}\n\n${items.join('\n\n')}`;
  }).join('\n\n');
}

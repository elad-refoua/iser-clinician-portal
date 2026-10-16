const explanations: Record<string, string> = {
  invalid_credentials: 'שם המשתמש או הסיסמה לא התקבלו. יש לבדוק ולנסות שוב.',
  invalid_access_code: 'הקוד לא התקבל. יש לבדוק את קוד הגישה ולנסות שוב.',
  access_required: 'יש להיכנס למערכת כדי להמשיך בשיחה.',
  invalid_session: 'הכניסה אינה תקפה. יש להיכנס שוב עם שם המשתמש והסיסמה.',
  session_expired: 'הכניסה הסתיימה. יש להיכנס שוב; העבודה שכתבת נשמרה.',
  access_rate_limit: 'היו כמה ניסיונות כניסה בזמן קצר. יש להמתין מעט ולנסות שוב.',
  request_budget_exceeded: 'הבקשה ארוכה מדי לתקציב שנקבע לדמו. אפשר לבחור Gemini Flash, או להמשיך בעריכה ישירה בתיק המטופל.',
  daily_budget_exceeded: 'תקציב ההתנסות החיה להיום מוצה. העיון בתיק והעריכה הידנית זמינים.',
  total_budget_exceeded: 'תקציב ההתנסות החיה מוצה. העיון בתיק והעריכה הידנית זמינים.',
  daily_call_limit: 'הגענו למספר הפניות החיות המותר להיום. אפשר לעיין בתיק ולהמשיך בעריכה ידנית.',
  concurrency_limit: 'פנייה אחרת עדיין בטיפול. יש להמתין לסיומה לפני פנייה חדשה.',
  stale_revision: 'השרת כבר טיפל בגרסה הזו של הפגישה. אפשר להוסיף מידע או להמשיך בעריכה ידנית.',
  request_done: 'הבקשה הזו כבר עובדה. היא לא נשלחה שוב למודל.',
  request_pending: 'הבקשה הזו כבר נשלחה והיא עדיין בטיפול. הטקסט שלך שמור.',
  request_uncertain: 'הבקשה כבר נשלחה, אך לא התקבלה תשובה מלאה. היא לא תישלח שוב אוטומטית.',
  invalid_request: 'חבילת הפגישה אינה מתאימה להפעלה חיה. אפשר לייצא גיבוי ולהמשיך בעריכה ידנית.',
  request_too_large: 'חבילת הפגישה ארוכה מדי להפעלה חיה בדמו. אפשר להמשיך בעריכה ישירה בתיק המטופל.',
  model_unavailable: 'המודל שנבחר אינו זמין כרגע. אפשר לבחור מודל אחר במפורש, או להמשיך בעריכה ידנית.',
  provider_request_failed: 'ספק המודל לא השלים את הבקשה. לא בוצע ניסיון נוסף אוטומטי. אפשר להמשיך בעריכה ישירה בתיק המטופל.',
  provider_outcome_uncertain: 'זמן ההמתנה למודל הסתיים ללא תשובה מאומתת. לא בוצע ניסיון נוסף אוטומטי; הטקסט נשמר.',
  quota_store_unavailable: 'שירות הגבלת השימוש אינו זמין כרגע, ולכן הפניות החיות מושהות. אפשר לעיין בתיק ולערוך ידנית.',
  quota_store_not_configured: 'שירות הגבלת השימוש עדיין לא חובר. אפשר לעיין בתיק ולערוך ידנית.',
  access_not_configured: 'קוד הגישה עדיין לא הוגדר בשרת. העיון בתיק זמין.',
  provider_not_configured: 'מפתח המודל עדיין לא הוגדר בשרת. העיון בתיק זמין.',
  origin_not_allowed: 'כתובת האתר הזו עדיין לא אושרה לחיבור לשרת. יש לעדכן את הגדרת כתובות האתר בשרת.',
};
export function apiErrorMessage(code: unknown, status?: number): string {
  if (typeof code === 'string' && explanations[code]) return explanations[code];
  if (typeof code === 'string' && /invalid_question|invalid_model|unknown_model|question_limit|blocked_question|excluded_topic|unsourced|incomplete_model|unsupported_unknown|duplicate_field/.test(code)) return 'התשובה לא עמדה בכללי התיעוד ולכן לא הוכנסה לתיק. הטקסט שלך נשמר. אפשר לבקש סיכום שוב או לבחור מודל אחר.';
  return `הבקשה לא הושלמה${status ? ` (${status})` : ''}. הטקסט שלך נשמר ואפשר להמשיך בעריכה ידנית.`;
}

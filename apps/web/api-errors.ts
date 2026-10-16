const explanations: Record<string, string> = {
  invalid_access_code: 'הקוד לא התקבל. יש לבדוק את קוד הגישה ולנסות שוב.',
  access_required: 'כדי להתנסות במודל חי יש להזין את קוד הגישה.',
  invalid_session: 'הגישה אינה תקפה. אפשר להזין שוב את קוד הגישה.',
  session_expired: 'שעת ההתנסות הסתיימה. אפשר להזין שוב את קוד הגישה.',
  access_rate_limit: 'היו כמה ניסיונות התחברות בזמן קצר. אפשר להמשיך בדמו המוכן ולנסות שוב מאוחר יותר.',
  request_budget_exceeded: 'הבקשה ארוכה מדי לתקציב שנקבע לדמו. אפשר לבחור Gemini Flash, לקצר את השיתוף או להשתמש בטיוטה הידנית.',
  daily_budget_exceeded: 'תקציב ההתנסות החיה להיום מוצה. ההדגמה המוכנה והעריכה הידנית זמינות.',
  total_budget_exceeded: 'תקציב ההתנסות החיה מוצה. ההדגמה המוכנה והעריכה הידנית זמינות.',
  daily_call_limit: 'הגענו למספר הפניות החיות המותר להיום. אפשר להמשיך במצב ההדגמה המוכן.',
  concurrency_limit: 'פנייה אחרת עדיין בטיפול. יש להמתין לסיומה לפני פנייה חדשה.',
  stale_revision: 'השרת כבר טיפל בגרסה הזו של הפגישה. אפשר להוסיף מידע או להמשיך בעריכה ידנית.',
  request_done: 'הבקשה הזו כבר עובדה. היא לא נשלחה שוב למודל.',
  request_pending: 'הבקשה הזו כבר נשלחה והיא עדיין בטיפול. הטקסט שלך שמור.',
  request_uncertain: 'הבקשה כבר נשלחה, אך לא התקבלה תשובה מלאה. היא לא תישלח שוב אוטומטית.',
  invalid_request: 'חבילת הפגישה אינה מתאימה להפעלה חיה. אפשר לייצא גיבוי ולהמשיך בעריכה ידנית.',
  request_too_large: 'חבילת הפגישה ארוכה מדי להפעלה חיה בדמו. אפשר להמשיך בטיוטה ידנית.',
  model_unavailable: 'המודל שנבחר אינו זמין כרגע. אפשר לבחור מודל אחר במפורש, או להמשיך בדמו המוכן.',
  provider_request_failed: 'ספק המודל לא השלים את הבקשה. לא בוצע ניסיון נוסף אוטומטי. אפשר להמשיך בטיוטה ידנית.',
  provider_outcome_uncertain: 'זמן ההמתנה למודל הסתיים ללא תשובה מאומתת. לא בוצע ניסיון נוסף אוטומטי; הטקסט נשמר.',
  quota_store_unavailable: 'שירות הגבלת השימוש אינו זמין כרגע, ולכן הפניות החיות מושהות. אפשר להשתמש בדמו המוכן.',
  quota_store_not_configured: 'שירות הגבלת השימוש עדיין לא חובר. אפשר להשתמש בדמו המוכן.',
  access_not_configured: 'קוד הגישה עדיין לא הוגדר בשרת. ההדגמה המוכנה זמינה.',
  provider_not_configured: 'מפתח המודל עדיין לא הוגדר בשרת. ההדגמה המוכנה זמינה.',
  origin_not_allowed: 'כתובת האתר הזו עדיין לא אושרה לחיבור לשרת. יש לעדכן את הגדרת כתובות האתר בשרת.',
};
export function apiErrorMessage(code: unknown, status?: number): string {
  if (typeof code === 'string' && explanations[code]) return explanations[code];
  if (typeof code === 'string' && /invalid_question|invalid_model|unknown_model|question_limit|blocked_question|excluded_topic|unsourced|incomplete_model|unsupported_unknown|duplicate_field/.test(code)) return 'התשובה לא עמדה בכללי התיעוד ולכן לא הוכנסה לתיק. הטקסט שלך נשמר; אפשר לעבור לטיוטה ידנית.';
  return `הבקשה לא הושלמה${status ? ` (${status})` : ''}. הטקסט שלך נשמר ואפשר להמשיך בעריכה ידנית.`;
}

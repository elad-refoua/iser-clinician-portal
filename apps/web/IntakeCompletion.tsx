import { useState } from 'react';
import { ChevronDown, MessageCircle, PencilLine } from 'lucide-react';
import type { ContextPacket } from '../../packages/contracts';
import { TEXT_LIMITS } from '../../packages/contracts';
import { intakeReadiness, type IntakeGap } from '../../packages/domain/intake-readiness';
import { fieldStatusLabels } from '../../packages/prompts/intake-schema';
import { Modal } from './ui';
import './intake-completion.css';

interface Props {
  context: ContextPacket;
  disabled: boolean;
  historical: boolean;
  composer: string;
  onComposerChange: (text: string) => void;
  onManual: (fieldId: number) => void;
  onDiscuss: (fieldId: number, text: string, expectedRevision: number) => boolean;
}

export default function IntakeCompletion({ context, disabled, historical, composer, onComposerChange, onManual, onDiscuss }: Props) {
  const [discussion, setDiscussion] = useState<number | null>(null);
  const readiness = intakeReadiness(context);
  if (!readiness.visible) return null;
  const active = readiness.gaps.find(gap => gap.field.id === discussion);
  const title = readiness.phase === 'approaching' ? 'לקראת דוח האינטייק בפגישה 5'
    : readiness.phase === 'due' ? 'דוח האינטייק בפגישה 5' : 'השלמות שנותרו אחרי פגישה 5';
  const renderGap = (gap: IntakeGap) => <li key={gap.field.id}>
    <div className="intake-gap-heading"><strong>{gap.label}</strong><span>{fieldStatusLabels[gap.field.status]}</span></div>
    <p>{gap.field.remaining?.trim() || (gap.field.status === 'conflict' ? 'יש דיווחים שעדיין לא יושבו.' : gap.field.status === 'partial' ? 'התיאור עדיין חלקי.' : gap.field.status === 'not_assessed' ? 'תועד שהנושא לא נבדק.' : gap.field.status === 'not_recalled' ? 'תועד שהפרט אינו זכור.' : 'עדיין לא נמסר מידע בנושא הזה.')}</p>
    <div className="intake-gap-actions">
      <button className="secondary small" disabled={disabled || historical} onClick={() => onManual(gap.field.id)}><PencilLine size={15} />למילוי ידני</button>
      <button className="text-button" disabled={disabled || historical || !gap.canDiscuss || (context.intakeRound ?? 0) >= 10} onClick={() => setDiscussion(gap.field.id)}><MessageCircle size={15} />אספר לעוזר והוא יארגן</button>
    </div>
    {gap.discussionReason && <small>{gap.discussionReason}</small>}
  </li>;
  return <section className="intake-completion" aria-labelledby={`intake-completion-${context.sessionId}`}>
    <header><div><h2 id={`intake-completion-${context.sessionId}`}>{title}</h2><p>הדוח כולל את כל חלקיו גם כשיש חוסרים. אפשר להשלים מידע שכבר ידוע לך, עכשיו או בהמשך.</p></div><span className="intake-gap-count">{readiness.gaps.length} נושאים פתוחים</span></header>
    {readiness.hasPendingInformation && <p className="intake-completion-note">הרשימה מתחשבת גם בהשלמות הממתינות לעיון; הן עדיין לא אושרו למסמכי התיק.</p>}
    {historical && <p className="intake-completion-note">זו תמונת האינטייק בפגישה שנבחרה. להשלמה יש לחזור לפגישה הנוכחית או לפתוח ענף מנקודה זו.</p>}
    {readiness.gaps.length ? <><ul>{readiness.gaps.slice(0, 3).map(renderGap)}</ul>{readiness.gaps.length > 3 && <details><summary>כל {readiness.gaps.length} הנושאים הפתוחים<ChevronDown size={16} /></summary><ul>{readiness.gaps.slice(3).map(renderGap)}</ul></details>}</>
      : <p>אין כרגע נושאים פתוחים לפי מצבי השדות שאינם מוחרגים. אפשר להמשיך לעיין ולערוך במסמכי התיק.</p>}
    {readiness.excludedCount > 0 && <p className="intake-completion-note">{readiness.excludedCount} שדות מוחרגים מהאינטייק לפי ההעדפות שלך ואינם מופיעים ברשימה.</p>}
    {(context.intakeRound ?? 0) >= 10 && <p className="intake-completion-note">מכסת סבבי ההשלמה לפגישה מוצתה. העריכה הידנית נשארת זמינה.</p>}
    {discussion !== null && <Modal title={`השלמה בשיחה — ${active?.label ?? 'אינטייק'}`} onClose={() => setDiscussion(null)}>
      <p>אפשר לספר את הפרטים הידועים לך בשפה חופשית. העוזר יארגן אותם באינטייק ובתוצרי התיק הרלוונטיים, ויציג הצעה לעיון. אם נדרש בירור, הסבב מוגבל לשתי שאלות.</p>
      <form onSubmit={event => { event.preventDefault(); if (active?.canDiscuss && onDiscuss(active.field.id, composer, context.baseRevision)) setDiscussion(null); }}>
        <label>המידע שברצונך להוסיף<textarea autoFocus rows={6} maxLength={TEXT_LIMITS.message - 300} value={composer} onChange={event => onComposerChange(event.target.value)} /></label>
        <p className="muted small-copy">הטקסט נמצא גם בשדה השיחה ונכלל בשמירת השרת. סגירת החלון לא מוחקת אותו.</p>
        {!active?.canDiscuss && <p role="status">המצב או ההעדפות השתנו. אפשר לשמור את הטקסט בשיחה ולבחור נושא מעודכן.</p>}
        <button className="primary" disabled={disabled || historical || !active?.canDiscuss || !composer.trim() || (context.intakeRound ?? 0) >= 10}>שליחה לעוזר</button>
      </form>
    </Modal>}
  </section>;
}

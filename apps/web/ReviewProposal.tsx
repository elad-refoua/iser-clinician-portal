import { Check, ChevronDown, PencilLine } from 'lucide-react';
import { GOAL_LABELS, type DraftFollowUp, type Goal, type PendingDraft, type PortalState, type Session } from '../../packages/contracts';
import { fieldStatusLabels, intakeFields, pendingDraftIsCurrent } from '../../packages/domain';
import { DocumentText, dateLabel } from './ui';
import './chat-workflow.css';

interface ReviewProposalProps {
  pending: PendingDraft;
  state: PortalState;
  session: Session;
  busy: boolean;
  onApprove: (draftId: string) => void;
  onExpand: (goal: Goal, selection?: DraftFollowUp) => void;
  onRevise: () => void;
  onExplain: () => void;
}

const cumulativeGoals: Goal[] = ['intake', 'formulation', 'supervision', 'gold'];

function fieldLabels(ids: number[]) {
  return ids.map(id => intakeFields.find(field => field.id === id)?.label).filter(Boolean).join(' · ');
}

function Sources({ ids, state }: { ids: string[]; state: PortalState }) {
  if (!ids.length) return <p className="review-small">לא קושרו מקורות מפורשים לנוסח הזה.</p>;
  return <details className="review-sources"><summary>המקורות לנוסח</summary>
    {[...new Set(ids)].map(id => {
      const source = state.sources.find(item => item.id === id);
      return source ? <article key={id}><strong>{source.sessionNumber ? `פגישה ${source.sessionNumber}` : 'פרטי התיק / בין פגישות'} · {dateLabel(source.recordedAt)}</strong><p>{source.text}</p></article>
        : <p key={id} className="review-small">מקור מקושר אינו זמין בתיק הנוכחי.</p>;
    })}
  </details>;
}

export default function ReviewProposal({ pending, state, session, busy, onApprove, onExpand, onRevise, onExplain }: ReviewProposalProps) {
  const note = pending.result.documents.find(document => document.kind === 'note');
  const baseNote = state.versions.find(version => version.id === pending.baseVersionIds.note);
  const stale = session.pendingDraft?.id !== pending.id || !pendingDraftIsCurrent(state, session.id);
  const unsent = Boolean(session.composer.trim());
  const expansions = (pending.result.followUps ?? []).filter(item => item.kind === 'expand');
  const reminders = (pending.result.followUps ?? []).filter(item => item.kind === 'next_session');
  const disabled = busy || stale || unsent;
  const noteText = note?.content ?? baseNote?.content;

  return <section className="review-proposal" aria-labelledby={`review-${pending.id}`} dir="rtl">
    <header className="review-heading"><h2 id={`review-${pending.id}`}>הסיכום לעיונך</h2><span>ממתין לאישור שלך</span></header>
    {pending.result.summary?.trim() && <p className="review-summary">{pending.result.summary}</p>}
    <article className="review-note"><h3>{GOAL_LABELS.note}</h3>
      {noteText ? <DocumentText text={noteText} /> : <p className="review-small">לא הוחזרה רשומה לשמירה. אפשר לחזור לשיחה ולבקש סיכום מעודכן.</p>}
      {note && <Sources ids={note.sourceIds} state={state} />}
    </article>
    <div className="review-destinations"><h3>מה ייכנס לתיק באישור שלך</h3>
      <p className="review-small">הרשומה שייכת לפגישה הזו. המסמכים הבאים מצטברים לאורך הטיפול; אפשר לפתוח כל אחד ולעיין בנוסח.</p>
      {cumulativeGoals.map(goal => {
        const proposed = pending.result.documents.find(document => document.kind === goal);
        const previous = state.versions.find(version => version.id === pending.baseVersionIds[goal]);
        const fieldChanged = goal === 'intake' && JSON.stringify(previous?.fields ?? []) !== JSON.stringify(pending.fields);
        const changed = Boolean(proposed && (proposed.content !== previous?.content || fieldChanged));
        const label = changed ? previous ? 'עדכון מוצע' : 'מסמך חדש' : 'ללא שינוי מוצע';
        const content = proposed?.content ?? previous?.content;
        return <details key={goal} className="review-destination"><summary><span>{GOAL_LABELS[goal]}</span><small>{label}</small><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="review-destination-body">
            {content ? <DocumentText text={content} /> : <p className="review-small">עדיין אין תוכן במסמך הזה.</p>}
            {changed && previous && <details className="review-previous"><summary>השוואה לנוסח השמור כעת</summary><DocumentText text={previous.content} /></details>}
            {goal === 'intake' && pending.fields.length > 0 && <details className="review-fields"><summary>כל שדות האינטייק ומצב התיעוד שלהם</summary>
              {pending.fields.map(field => <article key={field.id}><h4>{intakeFields.find(item => item.id === field.id)?.label ?? `שדה ${field.id}`}</h4><span>{fieldStatusLabels[field.status]}</span>
                <p>{field.value || 'לא נמסר מידע בשדה זה.'}</p>{field.remaining && <p className="review-small">להשלמה: {field.remaining}</p>}<Sources ids={field.sourceIds} state={state} />
              </article>)}
            </details>}
            {proposed && <Sources ids={proposed.sourceIds} state={state} />}
          </div>
        </details>;
      })}
    </div>
    {reminders.length > 0 && <aside className="review-reminders" aria-label="להמשך התיעוד"><h3>לקראת הפגישה הבאה</h3>
      {reminders.map((reminder, index) => <div key={`${reminder.goal}-${index}`}><p>{reminder.text}</p>{reminder.fieldIds.length > 0 && <details><summary>השדות שאליהם התזכורת מתייחסת</summary><p className="review-small">{fieldLabels(reminder.fieldIds)}</p></details>}</div>)}
    </aside>}
    {(stale || unsent) && <p className="review-stale" role="status">{stale ? 'מאז הכנת הסיכום נוספו שינויים. צריך להכין סיכום מעודכן לפני האישור.' : 'יש טקסט שעדיין לא נשלח בשיחה. אפשר לשלוח אותו ולעדכן את הסיכום, או להסיר אותו לפני האישור.'}</p>}
    <div className="review-approval"><button type="button" className="primary" disabled={disabled || !noteText} onClick={() => onApprove(pending.id)}><Check size={18} aria-hidden="true" />אישור ושמירת הרשומה</button>
      <button type="button" className="text-button" disabled={busy} onClick={onRevise}><PencilLine size={15} aria-hidden="true" />הוספת תיקון בשיחה</button>
    </div>
    <div className="review-optional">
      {expansions.length > 0 && <div className="review-followups"><h3>אפשר להרחיב, אם מתאים לך</h3>{expansions.map((followUp, index) => <div key={`${followUp.goal}-${index}`}><p>{followUp.text}</p><button type="button" disabled={disabled} aria-label={`להרחיב בנושא ${GOAL_LABELS[followUp.goal]}: ${followUp.text}`} onClick={() => onExpand(followUp.goal, followUp)}>להרחיב בנושא {GOAL_LABELS[followUp.goal]}</button>{followUp.fieldIds.length > 0 && <details><summary>לאילו שדות זה קשור</summary><p className="review-small">{fieldLabels(followUp.fieldIds)}</p></details>}</div>)}</div>}
      <details className="review-more"><summary>הרחבה בנושא אחר</summary><div className="review-goal-buttons">{cumulativeGoals.map(goal => <button type="button" key={goal} disabled={disabled} onClick={() => onExpand(goal)}>{GOAL_LABELS[goal]}</button>)}</div></details>
      <button type="button" className="review-explain" onClick={onExplain}>איך נוצר הסיכום?</button>
    </div>
  </section>;
}

import { Check, ChevronDown, PencilLine } from 'lucide-react';
import { GOAL_LABELS, type DraftFollowUp, type Goal, type PendingDraft, type PortalState, type Session } from '../../packages/contracts';
import { fieldStatusLabels, intakeFields, pendingDraftIsCurrent } from '../../packages/domain';
import { DocumentDiff, DocumentText, dateLabel } from './ui';
import { proposalDestinations, proposalSummary } from './proposal-diff';
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
const destinationLabels = { new: 'מסמך חדש', updated: 'עדכון מוצע', unchanged: 'ללא שינוי בתוכן', unavailable: 'גרסת הבסיס אינה זמינה' };

function ProposalText({ before, after, baseMissing }: { before?: string; after: string; baseMissing?: boolean }) {
  if (baseMissing) return <><p className="review-small">גרסת הבסיס של ההצעה אינה זמינה, ולכן אי אפשר לסמן השוואה מדויקת.</p><DocumentText text={after} /></>;
  return <><DocumentDiff before={before ?? ''} after={after} />{after === '' && <p className="review-small">ההצעה משאירה את המסמך ללא טקסט.</p>}{after !== (before ?? '') && <details className="review-clean"><summary>הנוסח המוצע לקריאה ללא סימונים</summary>{after === '' ? <p className="review-small">מסמך ללא טקסט.</p> : <DocumentText text={after} />}</details>}</>;
}

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
  const destinations = proposalDestinations(pending, state.versions);
  const noteDestination = destinations.find(item => item.goal === 'note')!;
  const note = noteDestination.proposed;
  const baseNote = noteDestination.base;
  const stale = session.pendingDraft?.id !== pending.id || !pendingDraftIsCurrent(state, session.id);
  const unsent = Boolean(session.composer.trim());
  const expansions = (pending.result.followUps ?? []).filter(item => item.kind === 'expand');
  const reminders = (pending.result.followUps ?? []).filter(item => item.kind === 'next_session');
  const disabled = busy || stale || unsent;
  const noteText = note?.content ?? baseNote?.content;

  return <section className="review-proposal" aria-labelledby={`review-${pending.id}`} dir="rtl">
    <header className="review-heading"><h2 id={`review-${pending.id}`}>הסיכום והעדכונים לעיונך</h2><span>ממתין לאישור שלך</span></header>
    <div className="review-proposal-overview"><h3>מה מוצע לשמור ולאן</h3>
      <p className="review-summary">{proposalSummary(destinations, session.number, intakeFields)}</p>
      <ul className="review-destination-map" aria-label="יעדי ההצעה">{destinations.map(item => <li key={item.goal}><div><strong>{item.goal === 'note' ? `רשומת פגישה ${session.number}` : GOAL_LABELS[item.goal]}</strong><span>{item.goal === 'note' ? 'בפגישה הזו' : 'בתיק המצטבר'}</span></div><span className={`review-change-status change-${item.status}`}>{destinationLabels[item.status]}</span></li>)}</ul>
      <p className="review-small review-approval-scope">באישור יישמרו הרשומה והעדכונים המפורטים כאן. עד אז, המסמכים השמורים נשארים כפי שהם.</p>
    </div>
    {stale && <p className="review-stale" role="status">מאז הכנת הסיכום נוספו שינויים. ההשוואה כאן היא לגרסאות שעליהן נבנתה ההצעה; צריך להכין סיכום מעודכן לפני האישור.</p>}
    <article className="review-note"><div className="review-section-heading"><h3>{GOAL_LABELS.note}</h3><span>תישמר בפגישה {session.number}</span></div>
      {noteText !== undefined ? <ProposalText before={baseNote?.content} after={noteText} baseMissing={noteDestination.baseMissing} /> : <p className="review-small">לא הוחזרה רשומה לשמירה. אפשר לחזור לשיחה ולבקש סיכום מעודכן.</p>}
      {note && <Sources ids={note.sourceIds} state={state} />}
    </article>
    <div className="review-destinations"><h3>העדכונים למסמכי התיק</h3>
      <p className="review-small">אפשר לפתוח כל מסמך. הסימונים משווים לגרסה שהייתה בסיס להצעה הזו.</p>
      {cumulativeGoals.map(goal => {
        const destination = destinations.find(item => item.goal === goal)!;
        const { proposed, base: previous, changed, fieldIds, baseMissing } = destination;
        const label = destinationLabels[destination.status];
        const content = proposed?.content ?? previous?.content;
        return <details key={goal} className="review-destination"><summary><span>{GOAL_LABELS[goal]}</span><small>{label}</small><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="review-destination-body">
            {goal === 'intake' && changed && !baseMissing && fieldIds.length > 0 && <p className="review-field-changes"><strong>שדות עם שינוי מוצע: </strong>{fieldLabels(fieldIds)}.</p>}
            {destination.sourcesChanged && !destination.textChanged && <p className="review-small">הנוסח נשאר זהה; רשימת המקורות המקושרים עודכנה.</p>}
            {content !== undefined ? <ProposalText before={previous?.content} after={content} baseMissing={baseMissing} /> : <p className="review-small">עדיין אין תוכן במסמך הזה.</p>}
            {changed && previous && <details className="review-previous"><summary>גרסת הבסיס המלאה של ההצעה</summary><DocumentText text={previous.content} /></details>}
            {goal === 'intake' && pending.fields.length > 0 && <details className="review-fields"><summary>כל שדות האינטייק ומצב התיעוד שלהם</summary>
              {pending.fields.map(field => { const previousField = previous?.fields?.find(item => item.id === field.id); const fieldChanged = fieldIds.includes(field.id); return <article key={field.id}><h4>{intakeFields.find(item => item.id === field.id)?.label ?? `שדה ${field.id}`}</h4><span>{previousField && previousField.status !== field.status ? `מצב המידע משתנה מ״${fieldStatusLabels[previousField.status]}״ ל״${fieldStatusLabels[field.status]}״` : fieldStatusLabels[field.status]}</span>
                {!baseMissing && fieldChanged && field.value !== previousField?.value ? <DocumentDiff before={previousField?.value ?? ''} after={field.value} showLegend={false} /> : <p>{field.value || 'לא נמסר מידע בשדה זה.'}</p>}
                {!baseMissing && (previousField?.remaining || '') !== (field.remaining || '') ? <div className="review-remaining-change"><strong>מה נותר להשלמה</strong><DocumentDiff before={previousField?.remaining || ''} after={field.remaining || ''} showLegend={false} /></div> : field.remaining && <p className="review-small">להשלמה: {field.remaining}</p>}
                {previousField && JSON.stringify([...new Set(previousField.sourceIds)].sort()) !== JSON.stringify([...new Set(field.sourceIds)].sort()) && <p className="review-small">המקורות המקושרים לשדה עודכנו.</p>}<Sources ids={field.sourceIds} state={state} />
              </article>; })}
            </details>}
            {proposed && <Sources ids={proposed.sourceIds} state={state} />}
          </div>
        </details>;
      })}
    </div>
    {reminders.length > 0 && <aside className="review-reminders" aria-label="להמשך התיעוד"><h3>לקראת הפגישה הבאה</h3>
      {reminders.map((reminder, index) => <div key={`${reminder.goal}-${index}`}><p>{reminder.text}</p>{reminder.fieldIds.length > 0 && <details><summary>השדות שאליהם התזכורת מתייחסת</summary><p className="review-small">{fieldLabels(reminder.fieldIds)}</p></details>}</div>)}
    </aside>}
    {unsent && <p className="review-stale" role="status">יש טקסט שעדיין לא נשלח בשיחה. אפשר לשלוח אותו ולעדכן את הסיכום, או להסיר אותו לפני האישור.</p>}
    <div className="review-approval"><button type="button" className="primary" disabled={disabled || noteText === undefined} onClick={() => onApprove(pending.id)}><Check size={18} aria-hidden="true" />אישור ושמירת הרשומה</button>
      <button type="button" className="text-button" disabled={busy} onClick={onRevise}><PencilLine size={15} aria-hidden="true" />הוספת תיקון בשיחה</button>
    </div>
    <div className="review-optional">
      {expansions.length > 0 && <div className="review-followups"><h3>אפשר להרחיב, אם מתאים לך</h3>{expansions.map((followUp, index) => <div key={`${followUp.goal}-${index}`}><p>{followUp.text}</p><button type="button" disabled={disabled} aria-label={`להרחיב בנושא ${GOAL_LABELS[followUp.goal]}: ${followUp.text}`} onClick={() => onExpand(followUp.goal, followUp)}>להרחיב בנושא {GOAL_LABELS[followUp.goal]}</button>{followUp.fieldIds.length > 0 && <details><summary>לאילו שדות זה קשור</summary><p className="review-small">{fieldLabels(followUp.fieldIds)}</p></details>}</div>)}</div>}
      <details className="review-more"><summary>הרחבה בנושא אחר</summary><div className="review-goal-buttons">{cumulativeGoals.map(goal => <button type="button" key={goal} disabled={disabled} onClick={() => onExpand(goal)}>{GOAL_LABELS[goal]}</button>)}</div></details>
      <button type="button" className="review-explain" onClick={onExplain}>איך נוצר הסיכום?</button>
    </div>
  </section>;
}

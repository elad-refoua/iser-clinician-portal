import { useState } from 'react';
import { ArrowUpLeft, BookOpen, CircleDot, Layers } from 'lucide-react';
import { GOAL_LABELS, MODELS, type PortalState, type Session, type Source } from '../../packages/contracts';
import { buildContext, fieldStatusLabels, intakeFields } from '../../packages/domain';
import { citedSourceIds, sourceLabel, traceOrigin } from './experience-model';
import { dateLabel, timeLabel } from './ui';
import './experience.css';

interface ResponseExplainerProps { state: PortalState; session: Session; busy: boolean; onOpenBackstage: () => void }

function Sources({ ids, sources }: { ids: string[]; sources: Source[] }) {
  if (!ids.length) return <p className="explain-small">לא קושרו מקורות מפורשים לתוצר הזה.</p>;
  return <div className="explain-sources">{[...new Set(ids)].map(id => {
    const source = sources.find(item => item.id === id);
    return source ? <details key={id}><summary>{sourceLabel(source)}</summary><p className="explain-source-text">{source.text}</p><small>{dateLabel(source.recordedAt)} · {timeLabel(source.recordedAt)}</small></details> : <p className="explain-small" key={id}>מקור מקושר אינו מופיע בחבילת ההקשר השמורה.</p>;
  })}</div>;
}

export default function ResponseExplainer({ state, session, busy, onOpenBackstage }: ResponseExplainerProps) {
  const [selection, setSelection] = useState({ sessionId: session.id, traceId: 'latest' });
  const traceId = selection.sessionId === session.id ? selection.traceId : 'latest';
  const trace = traceId === 'latest' ? session.traces.at(-1) : session.traces.find(item => item.id === traceId);
  const context = trace?.context ?? buildContext(state, session.id);
  const origin = trace ? traceOrigin(trace) : undefined;
  const result = trace?.response;
  const cited = trace ? citedSourceIds(trace) : [];
  const currentSources = context.sources.filter(source => source.sessionId === context.sessionId);
  const previousSources = context.sources.filter(source => source.sessionId !== context.sessionId);
  const modelName = trace ? MODELS.find(model => model.id === trace.model)?.label ?? trace.model : '';
  const incomingLabel = origin?.sent && trace?.contextOrigin === 'server' ? 'מה נשלח למודל בתור הזה' : trace ? 'ההקשר שנשמר לצד התור' : 'מה כבר מוכן להקשר';

  return <aside className="response-explainer" aria-label="איך נוצרה התגובה">
    <header className="explain-heading"><span className="explain-heading-icon"><Layers size={20} /></span><div><h2>איך זה קרה</h2><p>השיחה לפניכם. כאן אפשר להבין על מה היא נשענת.</p></div></header>
    {busy && <p className="explain-progress" role="status"><CircleDot size={14} />מתקבלת תשובה חדשה.{trace ? ' בינתיים מוצג התור השמור האחרון.' : ' פרטי ההפעלה יופיעו כשהתשובה תתקבל.'}</p>}
    {session.traces.length > 0 && <label className="explain-picker">איזה תור להציג<select value={traceId} onChange={event => setSelection({ sessionId: session.id, traceId: event.target.value })}><option value="latest">התור האחרון</option>{[...session.traces].reverse().map((item, index) => <option key={item.id} value={item.id}>תור {session.traces.length - index} · {timeLabel(item.at)} · {traceOrigin(item).kind === 'policy' ? 'כלל מערכת' : item.mode === 'prepared' ? 'דוגמה מוכנה' : 'מודל שפה'}</option>)}</select></label>}
    <div className={`explain-origin ${origin?.kind ?? 'preview'}`}><strong>{origin?.label ?? 'לפני התגובה הראשונה'}</strong><p>{!origin ? 'אחרי שתשתפו את תיאור הפגישה, אפשר יהיה לראות כאן את ההפעלה עצמה. טקסט שעדיין בשדה הכתיבה טרם צורף להקשר.' : origin.kind === 'model' ? <><bdi>{modelName}</bdi> · {timeLabel(trace!.at)} · גרסת הוראות <bdi>{trace!.promptVersion}</bdi></> : origin.kind === 'policy' ? 'המערכת סיימה את התשאול לפי בקשת סיום או מכסת השאלות. בתור הזה לא נקרא מודל שפה.' : 'זהו תור שנשמר מגרסת הדגמה קודמת. הוא לא נוצר מקריאת מודל.'}</p></div>
    <section className="explain-section"><h3>{incomingLabel}</h3><p className="explain-context-owner">התיק של {context.patientName}, עד פגישה {context.sessionNumber}.</p><ul className="explain-input-list"><li><span>מהפגישה הזו</span><strong>{currentSources.length} מקורות</strong></li><li><span>מפגישות קודמות ומפרטי התיק</span><strong>{previousSources.length} מקורות</strong></li><li><span>מסמכים שנצברו</span><strong>{context.documents.length}</strong></li></ul>
      {context.documents.length > 0 && <p className="explain-small">{context.documents.map(document => GOAL_LABELS[document.kind]).join(' · ')}</p>}
      {context.preferences.length > 0 && <details><summary>בקשות המטפל שמשפיעות על התשאול ({context.preferences.length})</summary><ul className="explain-preferences">{context.preferences.map(preference => <li key={preference.id}>{preference.action === 'less' ? 'פחות דגש' : preference.action === 'block' ? 'לא לשאול' : 'לא להפיק תוכן'}: {preference.topic}{preference.goal ? ` (${GOAL_LABELS[preference.goal]})` : ''}</li>)}</ul></details>}
      <details><summary>{origin?.sent && trace?.contextOrigin === 'server' ? 'לקריאת המקורות שנשלחו בפועל' : 'לקריאת המקורות שבהקשר'} ({context.sources.length})</summary><p className="explain-small">אלה מקורות שהיו זמינים בתור הזה. הופעתם כאן אינה אומרת שהמודל הסתמך על כל אחד מהם.</p><Sources ids={context.sources.map(source => source.id)} sources={context.sources} /></details>
    </section>
    {result && <section className="explain-section"><h3>{origin?.kind === 'model' ? 'המטרה שהמודל ציין' : 'ההסבר שנשמר לתור'}</h3><p className="explain-rationale">{result.rationale || 'לא נשמר הסבר בתור הזה.'}</p><p className="explain-small">זהו הסבר קצר שמלווה את הפלט; הוא אינו תיעוד של חשיבה פנימית ואינו ראיה קלינית.</p></section>}
    {result && <section className="explain-section"><h3>מה חזר מההפעלה</h3>
      {'questionAnchor' in result && result.questionAnchor && <details><summary>למה מתייחסת שאלת ההמשך</summary><p className="explain-small">המודל קישר את השאלה למקורות האלה. הקישור ניתן לבדיקה, ואינו אישור שהשאלה מתאימה מבחינה קלינית.</p><Sources ids={result.questionAnchor.sourceIds} sources={context.sources} />{result.questionAnchor.fieldIds.length > 0 && <p>{result.questionAnchor.fieldIds.map(id => intakeFields.find(field => field.id === id)?.label).join(' · ')}</p>}</details>}
      {Boolean(result.evidenceMap?.length) && <details><summary>המידע שהמודל קישר בתור הזה ({result.evidenceMap!.length})</summary><p className="explain-small">זהו מיפוי חלקי מתוך דברי המטפל. הציטוטים נבדקים מול המקור; השיוך והמשמעות הם הצעת המודל. המקורות המלאים נשארים זמינים גם כשאינם מופיעים במיפוי.</p>{result.evidenceMap!.map((item, index) => <article className="explain-field" key={`${item.sourceId}-${index}`}><blockquote>{item.quote}</blockquote><p className="explain-small">{item.destinations.map(goal => GOAL_LABELS[goal]).join(' · ')}{item.fieldIds.length ? ` · ${item.fieldIds.map(id => intakeFields.find(field => field.id === id)?.label).join(' · ')}` : ''}</p><Sources ids={[item.sourceId]} sources={context.sources} /></article>)}</details>}
      {'action' in result && <p>{result.action === 'question' ? 'שאלת המשך אחת לשיחה.' : 'מעבר להכנת טיוטה עם החומר שנאסף.'}</p>}
      {'documents' in result && <div className="explain-output-docs">{result.documents.map(document => <details key={document.kind}><summary>{GOAL_LABELS[document.kind]}</summary><p className="explain-source-text">{document.content}</p><h4>המקורות שהתוצר הפנה אליהם</h4><Sources ids={document.sourceIds} sources={context.sources} /></details>)}</div>}
      {result.fieldUpdates.length > 0 ? <details><summary>{result.fieldUpdates.length} עדכונים לשדות האינטייק</summary>{result.fieldUpdates.map(field => <article className="explain-field" key={field.id}><h4>{intakeFields.find(item => item.id === field.id)?.label ?? `שדה ${field.id}`}</h4><span>{fieldStatusLabels[field.status]}</span><p>{field.value || 'לא נוסף תוכן לשדה.'}</p>{field.remaining && <p className="explain-small">נשאר פתוח: {field.remaining}</p>}<Sources ids={field.sourceIds} sources={context.sources} /></article>)}</details> : <p className="explain-small">לא הוחזרו עדכונים לשדות האינטייק בתור הזה.</p>}
      {Boolean(result.preferenceUpdates?.length) && <p className="explain-small">נשמרו גם {result.preferenceUpdates!.length} בקשות לגבי נושאים להמשך התשאול.</p>}
      {cited.length > 0 ? <p className="explain-small">המסמכים ועדכוני האינטייק קישרו במפורש {cited.length} מקורות. אפשר לפתוח כל תוצר ולקרוא את המקור המקושר אליו.</p> : <p className="explain-small">לא הוחזרו הפניות מפורשות למקורות במסמכים או בעדכוני האינטייק בתור הזה.</p>}
      <p className="explain-small">נוסחים שנוצרו הם טיוטות לעיון ולעריכה. ההפניות מצביעות על מקורות, ואינן מאשרות את נכונות הפרשנות.</p>
    </section>}
    <button className="text-button explain-backstage" onClick={onOpenBackstage}><BookOpen size={16} />ההוראות וחבילת ההקשר המלאה<ArrowUpLeft size={15} /></button>
  </aside>;
}

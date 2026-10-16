import { useEffect, useState } from 'react';
import { Check, ChevronDown, History, PencilLine, Save, ScanText, X } from 'lucide-react';
import { GOAL_LABELS, type DocumentVersion, type FieldStatus, type Goal, type IntakeField, type PortalState } from '../../packages/contracts';
import { acceptProposal, buildContext, currentVersion, editDocument, emptyIntakeFields, intakeFields, intakeSections, rejectProposal, renderIntake, restoreVersion } from '../../packages/domain';
import { renderIntakeReport } from '../../packages/domain/intake-report';
import { CopyButton, dateLabel, DocumentText, Modal, navigateTabs, SourceViewer, VersionMeta } from './ui';

const statuses: Record<FieldStatus, string> = { documented: 'תועד', partial: 'תועד חלקית', unknown: 'לא הוזכר', not_assessed: 'לא נבדק', not_recalled: 'לא זכור', conflict: 'קיימת סתירה', not_applicable: 'לא רלוונטי' };
const goals: Goal[] = ['formulation', 'intake', 'supervision', 'gold', 'note'];
type Update = (operation: (state: PortalState) => PortalState) => boolean;
const editorDrafts = new Map<string, { text: string; fields: IntakeField[] }>();
export function clearEditorDrafts() { editorDrafts.clear(); }
export function hasUnsavedDocumentEdits() { return editorDrafts.size > 0; }

export function DocumentEditor({ state, update, patientId, branchId, kind, sessionId, notify }: { state: PortalState; update: Update; patientId: string; branchId: string; kind: Goal; sessionId?: string; notify: (message: string) => void }) {
  const current = currentVersion(state, patientId, branchId, kind, sessionId);
  const draftKey = `${patientId}/${branchId}/${kind}/${sessionId || ''}`;
  const [editing, setEditing] = useState(editorDrafts.has(draftKey));
  const [text, setText] = useState(editorDrafts.get(draftKey)?.text || current?.content || '');
  const [fields, setFields] = useState<IntakeField[]>(editorDrafts.get(draftKey)?.fields || current?.fields || emptyIntakeFields());
  const [history, setHistory] = useState(false);
  const [sourceIds, setSourceIds] = useState<string[] | null>(null);
  const [pendingProposal, setPendingProposal] = useState<DocumentVersion | null>(null);
  const [intakeView, setIntakeView] = useState<'report' | 'fields'>('report');
  const latestSession = state.sessions.filter(item => item.patientId === patientId && item.branchId === branchId).sort((a, b) => b.number - a.number)[0];
  const intakePreview = () => renderIntakeReport(fields, latestSession ? buildContext(state, latestSession.id).preferences : []);
  const versions = state.versions.filter(version => version.patientId === patientId && version.branchId === branchId && version.kind === kind && (kind !== 'note' || version.sessionId === sessionId));
  const proposals = versions.filter(version => version.proposal && !version.rejected);

  useEffect(() => { if (!editing) { setText(current?.content || ''); setFields(current?.fields || emptyIntakeFields()); } }, [current?.id, editing]);
  useEffect(() => { if (editing) editorDrafts.set(draftKey, { text, fields }); }, [draftKey, editing, text, fields]);

  function save() {
    if (!update(previous => editDocument(previous, patientId, branchId, kind, kind === 'intake' ? renderIntake(fields) : text, kind === 'intake' ? fields : undefined, sessionId))) return;
    editorDrafts.delete(draftKey);
    setEditing(false);
    notify('נוצרה גרסה חדשה עם העריכה שלך.');
  }

  return <section className="document-editor" aria-label={GOAL_LABELS[kind]}>
    <div className="document-toolbar">
      <div><h2>{GOAL_LABELS[kind]}</h2><VersionMeta version={current} /></div>
      <div className="button-row">
        <button className="text-button" onClick={() => setHistory(true)}><History size={16} />גרסאות ({versions.filter(version => !version.proposal).length})</button>
        {current && <button className="text-button" onClick={() => setSourceIds(current.sourceIds)}><ScanText size={16} />מקורות</button>}
        {!editing && <button className="secondary small" onClick={() => { setEditing(true); if (kind === 'intake') setIntakeView('fields'); }}><PencilLine size={16} />עריכה ישירה</button>}
      </div>
    </div>
    {proposals.length > 0 && <div className="notice proposal-notice"><div><strong>יש הצעת עדכון לעיון</strong><p>הנוסח שערכת נשמר. אפשר להשוות את ההצעה לפני שמחליטים אם לקבל אותה.</p></div><button className="secondary small" onClick={() => setPendingProposal(proposals.at(-1)!)}>השוואת ההצעה</button></div>}
    {kind === 'intake' && <>
      <div className="intake-summary"><p><strong>{fields.filter(field => field.status === 'documented').length} מתוך 32</strong> שדות מתועדים במלואם. שדות חלקיים וחסרים נשארים גלויים.</p><div className="segmented"><button aria-pressed={intakeView === 'report'} onClick={() => setIntakeView('report')}>דוח מסכם</button><button aria-pressed={intakeView === 'fields'} onClick={() => setIntakeView('fields')}>32 השדות</button></div></div>
      {intakeView === 'fields' && <div className="intake-fields">{intakeSections.map(section => <details key={section.title} open={editing || undefined}>
        <summary>{section.title}<ChevronDown size={16} /></summary>
        {section.fieldIds.map(id => {
          const field = fields.find(item => item.id === id) || emptyIntakeFields().find(item => item.id === id)!;
          const label = intakeFields.find(item => item.id === id)?.label || String(id);
          return <div className="intake-field" key={id}>
            <div className="row-between"><label htmlFor={`field-${id}`}>{id}. {label}</label>{!editing && <span className={`tag field-${field.status}`}>{statuses[field.status]}</span>}</div>
            {editing ? <><textarea id={`field-${id}`} value={field.value} rows={3} onChange={event => setFields(previous => previous.map(item => item.id === id ? { ...item, value: event.target.value } : item))} /><div className="field-row"><label>מצב המידע<select value={field.status} onChange={event => setFields(previous => previous.map(item => item.id === id ? { ...item, status: event.target.value as FieldStatus } : item))}>{Object.entries(statuses).map(([value, title]) => <option value={value} key={value}>{title}</option>)}</select></label><label>מה עוד פתוח<input value={field.remaining || ''} onChange={event => setFields(previous => previous.map(item => item.id === id ? { ...item, remaining: event.target.value } : item))} /></label></div></> : <><p className="preserve-lines">{field.value || 'לא נמסר מידע.'}</p>{field.remaining && <p className="muted">נותר לברר: {field.remaining}</p>}{field.sourceIds.length > 0 && <button className="text-button" onClick={() => setSourceIds(field.sourceIds)}><ScanText size={14} />מקורות לשדה</button>}</>}
          </div>;
        })}
      </details>)}</div>}
      {intakeView === 'report' && <DocumentText text={editing ? intakePreview() : current?.content || intakePreview()} />}
    </>}
    {kind !== 'intake' && (editing ? <label className="edit-area">עריכת {GOAL_LABELS[kind]}<textarea className="document-input" value={text} onChange={event => setText(event.target.value)} rows={15} /></label> : <DocumentText text={current?.content || ''} />)}
    <div className="document-footer">{editing ? <><p className="muted small-copy">העריכה עדיין לא נשמרה. שמירה יוצרת גרסה חדשה; הנוסח הקודם נשאר בהיסטוריה.</p><div className="button-row"><button className="primary" onClick={save}><Save size={17} />שמירת העריכה</button><button className="text-button" onClick={() => { editorDrafts.delete(draftKey); setEditing(false); }}>ביטול עריכה</button></div></> : <CopyButton text={current?.content || ''} notify={notify} />}</div>
    {history && <VersionHistory versions={versions.filter(version => !version.proposal)} currentId={current?.id} onClose={() => setHistory(false)} onRestore={id => { if (!update(previous => restoreVersion(previous, id))) return; setHistory(false); notify('הגרסה שנבחרה שוחזרה כגרסה חדשה.'); }} />}
    {sourceIds && <SourceViewer ids={sourceIds} state={state} onClose={() => setSourceIds(null)} />}
    {pendingProposal && <Modal title="השוואת הצעת העדכון" wide onClose={() => setPendingProposal(null)}><p className="muted">ההצעה לא החליפה את העריכה שלך. קבלה יוצרת גרסה חדשה שניתנת לעריכה ולשחזור.</p><div className="comparison"><article><h3>הנוסח הנוכחי</h3><DocumentText text={current?.content || ''} /></article><article><h3>הצעת העדכון</h3><DocumentText text={pendingProposal.content} /></article></div><div className="button-row"><button className="primary" onClick={() => { if (!update(previous => acceptProposal(previous, pendingProposal.id))) return; setPendingProposal(null); notify('ההצעה התקבלה כגרסה חדשה.'); }}><Check size={17} />קבלת ההצעה</button><button className="secondary" onClick={() => { if (!update(previous => rejectProposal(previous, pendingProposal.id))) return; setPendingProposal(null); notify('ההצעה נדחתה. הנוסח שלך נשמר.'); }}><X size={17} />שמירת הנוסח שלי</button></div></Modal>}
  </section>;
}

function VersionHistory({ versions, currentId, onClose, onRestore }: { versions: DocumentVersion[]; currentId?: string; onClose: () => void; onRestore: (id: string) => void }) {
  const sorted = [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [leftId, setLeftId] = useState(sorted.at(-2)?.id || sorted.at(-1)?.id || '');
  const [rightId, setRightId] = useState(currentId || sorted.at(-1)?.id || '');
  const left = sorted.find(version => version.id === leftId);
  const right = sorted.find(version => version.id === rightId);
  const options = sorted.map((version, index) => <option key={version.id} value={version.id}>גרסה {index + 1} · {dateLabel(version.createdAt)} · {version.author === 'clinician' ? 'עריכת מטפל' : version.author === 'seed' ? 'הדגמה' : 'עוזר'}{version.id === currentId ? ' · נוכחית' : ''}</option>);
  return <Modal title="היסטוריית גרסאות והשוואה" wide onClose={onClose}>
    <p className="muted">כל שמירה היא תמונת מצב מלאה. שחזור אינו מוחק גרסאות מאוחרות.</p>
    {sorted.length === 0 ? <p>עדיין לא נשמרו גרסאות למסמך הזה.</p> : <div className="comparison">{([{ side: 'left', version: left, value: leftId, change: setLeftId }, { side: 'right', version: right, value: rightId, change: setRightId }] as const).map(item => <article key={item.side}><label>בחירת גרסה<select value={item.value} onChange={event => item.change(event.target.value)}>{options}</select></label>{item.version && <><p className="tag historical-label">{item.version.id === currentId ? 'הגרסה הנוכחית' : 'גרסה היסטורית'}</p><DocumentText text={item.version.content} /><p className="muted small-copy">{item.version.reason}</p>{item.version.id !== currentId && <button className="secondary" onClick={() => onRestore(item.version!.id)}><History size={16} />שחזור גרסה זו</button>}</>}</article>)}</div>}
  </Modal>;
}

export function Dossier({ state, update, patientId, branchId, openSession, notify }: { state: PortalState; update: Update; patientId: string; branchId: string; openSession: (id: string) => void; notify: (message: string) => void }) {
  const [goal, setGoal] = useState<Goal>('formulation');
  const sessions = state.sessions.filter(session => session.patientId === patientId && session.branchId === branchId).sort((a, b) => b.number - a.number);
  const [noteSession, setNoteSession] = useState(sessions[0]?.id || '');
  return <div className="dossier-page"><div className="page-heading"><h1>התמונה המצטברת</h1><p>אפשר לעיין ולערוך בכל זמן. אין צורך לפתוח פגישה כדי לעדכן את התיק.</p></div><div className="document-tabs" role="tablist" onKeyDown={navigateTabs} aria-label="מסמכי התיק">{goals.map(item => <button role="tab" tabIndex={goal === item ? 0 : -1} aria-selected={goal === item} key={item} onClick={() => setGoal(item)}>{item === 'note' ? 'רשומות קודמות' : GOAL_LABELS[item]}</button>)}</div>
    {goal === 'note' && <div className="history-picker"><label>רשומת הפגישה<select value={noteSession} onChange={event => setNoteSession(event.target.value)}>{sessions.map(session => <option value={session.id} key={session.id}>פגישה {session.number} · {dateLabel(session.startedAt)} · {session.status === 'approved' ? 'מאושרת' : 'טיוטה'}</option>)}</select></label><button className="text-button" onClick={() => openSession(noteSession)}>פתיחת הפגישה והשיחה</button></div>}
    <div className="paper"><DocumentEditor key={`${patientId}-${branchId}-${goal}-${goal === 'note' ? noteSession : ''}`} state={state} update={update} patientId={patientId} branchId={branchId} kind={goal} sessionId={goal === 'note' ? noteSession : undefined} notify={notify} /></div>
  </div>;
}

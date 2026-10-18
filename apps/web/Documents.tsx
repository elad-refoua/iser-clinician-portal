import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, CalendarDays, Check, ChevronDown, FileText, History, MessageCircle, PencilLine, Save, ScanText, X } from 'lucide-react';
import { GOAL_LABELS, TEXT_LIMITS, type DocumentVersion, type FieldStatus, type Goal, type IntakeField, type PendingDraft, type PortalState, type Session } from '../../packages/contracts';
import { acceptProposal, approveSession, buildContext, currentVersion, documentHistory, editDocument, emptyIntakeFields, fieldStatusLabels as statuses, intakeFields, intakeSections, pendingDraftIsCurrent, rejectProposal, renderIntake, restoreVersion } from '../../packages/domain';
import { renderIntakeReport } from '../../packages/domain/intake-report';
import { CopyButton, dateLabel, DocumentDiff, DocumentText, Modal, navigateTabs, SourceViewer, timeLabel, VersionMeta } from './ui';
import { scheduleLabel } from './NewPatient';
import { documentExcerpt } from './experience-model';
import { editorDrafts, writeEditorDraft, removeEditorDraft, subscribeEditorDrafts, getEditorDraftCount, hasUnsavedDocumentEdits, saveEditorDraft } from './document-editing';
export { clearEditorDrafts, hasUnsavedDocumentEdits, subscribeEditorDrafts, getEditorDraftCount } from './document-editing';
import './patient-portal.css';

const goals: Goal[] = ['note', 'intake', 'formulation', 'supervision', 'gold'];
type Update = (operation: (state: PortalState) => PortalState) => boolean;

export function DocumentEditor({ state, update, patientId, branchId, kind, sessionId, notify, initialFieldId, onSaved }: { state: PortalState; update: Update; patientId: string; branchId: string; kind: Goal; sessionId?: string; notify: (message: string) => void; initialFieldId?: number; onSaved?: () => void }) {
  const current = currentVersion(state, patientId, branchId, kind, sessionId);
  const draftKey = `${patientId}/${branchId}/${kind}/${sessionId || ''}`;
  const [editing, setEditing] = useState(editorDrafts.has(draftKey));
  const [text, setText] = useState(editorDrafts.get(draftKey)?.text ?? current?.content ?? '');
  const [fields, setFields] = useState<IntakeField[]>(editorDrafts.get(draftKey)?.fields ?? current?.fields ?? emptyIntakeFields());
  const [baseVersionId, setBaseVersionId] = useState<string | null>(() => editorDrafts.has(draftKey) ? editorDrafts.get(draftKey)!.baseVersionId : current?.id ?? null);
  const staleEdit = editing && baseVersionId !== (current?.id ?? null);
  const [history, setHistory] = useState(false);
  const [sourceIds, setSourceIds] = useState<string[] | null>(null);
  const [pendingProposal, setPendingProposal] = useState<DocumentVersion | null>(null);
  const proposalBase = state.versions.find(version => version.id === pendingProposal?.baseVersionId);
  const [intakeView, setIntakeView] = useState<'report' | 'fields'>('report');
  const [focusedFieldId, setFocusedFieldId] = useState(initialFieldId);
  const editorRef = useRef<HTMLElement>(null);
  const openEditorCount = useSyncExternalStore(subscribeEditorDrafts, getEditorDraftCount, getEditorDraftCount);
  const noteSession = kind === 'note' ? state.sessions.find(item => item.id === sessionId) : undefined;
  const intakeEdit = noteSession ? currentVersion(state, patientId, branchId, 'intake') : undefined;
  const canApproveEdit = current && noteSession && !noteSession.pendingDraft && !noteSession.pendingFields?.length && !noteSession.composer.trim()
    && ((current?.author === 'clinician' && !current.approved) || (intakeEdit?.author === 'clinician' && !intakeEdit.approved && intakeEdit.sessionId === noteSession.id));
  const latestSession = state.sessions.filter(item => item.patientId === patientId && item.branchId === branchId).sort((a, b) => b.number - a.number)[0];
  const intakePreview = () => renderIntakeReport(fields, latestSession ? buildContext(state, latestSession.id).preferences : []);
  const versions = state.versions.filter(version => version.patientId === patientId && version.branchId === branchId && version.kind === kind && (kind !== 'note' || version.sessionId === sessionId));
  const historyVersions = documentHistory(state, patientId, branchId, kind, sessionId);
  const proposals = versions.filter(version => version.proposal && !version.rejected);

  useEffect(() => { if (!editing) { setText(current?.content || ''); setFields(current?.fields || emptyIntakeFields()); } }, [current?.id, editing]);
  useEffect(() => {
    if (kind !== 'intake' || !initialFieldId) return;
    if (!editorDrafts.has(draftKey)) beginEditing();
    else { setEditing(true); setIntakeView('fields'); }
  }, [initialFieldId]);
  useEffect(() => {
    if (editing && intakeView === 'fields' && focusedFieldId) editorRef.current?.querySelector<HTMLTextAreaElement>(`#field-${focusedFieldId}`)?.focus();
  }, [editing, intakeView, focusedFieldId]);

  function beginEditing() {
    const base = current?.id ?? null;
    setBaseVersionId(base);
    writeEditorDraft(draftKey, { text, fields, baseVersionId: base });
    setEditing(true);
    if (kind === 'intake') setIntakeView('fields');
  }

  function changeText(next: string) {
    writeEditorDraft(draftKey, { text: next, fields, baseVersionId });
    setText(next);
  }

  function changeField(id: number, changes: Partial<IntakeField>) {
    const next = fields.map(field => field.id === id ? { ...field, ...changes,
      ...(changes.value?.trim() && field.status === 'unknown' ? { status: 'partial' as const } : {}) } : field);
    writeEditorDraft(draftKey, { text, fields: next, baseVersionId });
    setFields(next);
  }

  function save() {
    if (!update(previous => saveEditorDraft(previous, draftKey, patientId, branchId, kind, sessionId))) return;
    removeEditorDraft(draftKey);
    setEditing(false);
    notify('נוצרה גרסה חדשה עם העריכה שלך.');
    onSaved?.();
  }

  return <section className="document-editor" aria-label={GOAL_LABELS[kind]} ref={editorRef}>
    <div className="document-toolbar">
      <div><h2>{GOAL_LABELS[kind]}</h2><VersionMeta version={current} /></div>
      <div className="button-row">
        <button className="text-button" onClick={() => setHistory(true)}><History size={16} />גרסאות ({historyVersions.length})</button>
        {current && <button className="text-button" onClick={() => setSourceIds(current.sourceIds)}><ScanText size={16} />מקורות</button>}
        {!editing && <button className="secondary small" onClick={beginEditing}><PencilLine size={16} />עריכה ישירה</button>}
      </div>
    </div>
    {proposals.length > 0 && <div className="notice proposal-notice"><div><strong>יש הצעת עדכון לעיון</strong><p>הנוסח שערכת נשמר. אפשר להשוות את ההצעה לפני שמחליטים אם לקבל אותה.</p></div><button className="secondary small" onClick={() => setPendingProposal(proposals.at(-1)!)}>השוואת ההצעה</button></div>}
    {kind === 'intake' && <>
      <div className="intake-summary"><p><strong>{fields.filter(field => field.status === 'documented').length} מתוך 32</strong> שדות מתועדים במלואם. שדות חלקיים וחסרים נשארים גלויים.</p><div className="segmented"><button aria-pressed={intakeView === 'report'} onClick={() => setIntakeView('report')}>דוח מסכם</button><button aria-pressed={intakeView === 'fields'} onClick={() => setIntakeView('fields')}>32 השדות</button></div></div>
      {focusedFieldId && <p className="muted">העריכה נפתחה בנושא שנבחר. <button className="text-button" onClick={() => setFocusedFieldId(undefined)}>הצגת כל השדות</button></p>}
      {intakeView === 'fields' && <div className="intake-fields">{intakeSections.filter(section => !focusedFieldId || section.fieldIds.includes(focusedFieldId)).map(section => <details key={section.title} open={editing || undefined}>
        <summary>{section.title}<ChevronDown size={16} /></summary>
        {section.fieldIds.filter(id => !focusedFieldId || id === focusedFieldId).map(id => {
          const field = fields.find(item => item.id === id) || emptyIntakeFields().find(item => item.id === id)!;
          const label = intakeFields.find(item => item.id === id)?.label || String(id);
          return <div className="intake-field" key={id}>
            <div className="row-between"><label htmlFor={`field-${id}`}>{id}. {label}</label>{!editing && <span className={`tag field-${field.status}`}>{statuses[field.status]}</span>}</div>
            {editing ? <><textarea id={`field-${id}`} value={field.value} maxLength={TEXT_LIMITS.fieldValue} rows={3} onChange={event => changeField(id, { value: event.target.value })} /><div className="field-row"><label>מצב המידע<select value={field.status} onChange={event => changeField(id, { status: event.target.value as FieldStatus })}>{Object.entries(statuses).map(([value, title]) => <option value={value} key={value}>{title}</option>)}</select></label><label>מה עוד פתוח<input value={field.remaining || ''} maxLength={TEXT_LIMITS.fieldRemaining} onChange={event => changeField(id, { remaining: event.target.value })} /></label></div></> : <><p className="preserve-lines">{field.value || 'לא נמסר מידע.'}</p>{field.remaining && <p className="muted">נותר לברר: {field.remaining}</p>}{field.sourceIds.length > 0 && <button className="text-button" onClick={() => setSourceIds(field.sourceIds)}><ScanText size={14} />מקורות לשדה</button>}</>}
          </div>;
        })}
      </details>)}</div>}
      {intakeView === 'report' && <DocumentText text={editing ? intakePreview() : current?.content || intakePreview()} />}
    </>}
    {kind !== 'intake' && (editing ? <label className="edit-area">עריכת {GOAL_LABELS[kind]}<textarea className="document-input" maxLength={TEXT_LIMITS.manualDocument} value={text} onChange={event => changeText(event.target.value)} rows={15} /></label> : <DocumentText text={current?.content || ''} />)}
    {staleEdit && <div className="error-panel" role="alert"><p>נשמרה גרסה חדשה מאז תחילת העריכה. הטקסט שלך נשאר פתוח, אך אי אפשר לשמור אותו על בסיס הגרסה הישנה. אפשר להעתיק אותו, לבטל את העריכה ולפתוח את הנוסח העדכני.</p><CopyButton text={kind === 'intake' ? renderIntake(fields) : text} notify={notify} /></div>}
    {editing && <p className="muted small-copy" role="status">{kind === 'intake' ? `עד ${TEXT_LIMITS.fieldValue.toLocaleString('en-US')} תווים לשדה; עד ${TEXT_LIMITS.fieldRemaining.toLocaleString('en-US')} להשלמה. גם הדוח המלא נבדק לפני שמירה.` : `${text.length.toLocaleString('en-US')} מתוך ${TEXT_LIMITS.manualDocument.toLocaleString('en-US')} תווים.`}</p>}
    <div className="document-footer">{editing ? <><p className="muted small-copy">העריכה נמצאת בזיכרון הלשונית בלבד. שמירה יוצרת גרסה חדשה ומעבירה אותה לשמירה בשרת; יש להמתין לאישור השמירה בראש המסך.</p><div className="button-row"><button className="primary" disabled={staleEdit} onClick={save}><Save size={17} />שמירת העריכה</button><button className="text-button" onClick={() => { removeEditorDraft(draftKey); setEditing(false); }}>ביטול עריכה</button></div></> : <CopyButton text={current?.content || ''} notify={notify} />}</div>
    {!editing && canApproveEdit && <div className="notice"><p>העריכה הידנית נשמרה כגרסה חדשה. אפשר לאשר את הנוסחים השמורים לאחר עיון; אין צורך להפעיל את הבינה שוב.</p><button className="secondary" disabled={openEditorCount > 0} onClick={() => {
      if (hasUnsavedDocumentEdits() || !sessionId || !current) return;
      if (!update(previous => {
        const active = previous.sessions.find(item => item.id === sessionId);
        if (!active || active.pendingDraft || active.pendingFields?.length || active.composer.trim() || currentVersion(previous, patientId, branchId, 'note', sessionId)?.id !== current.id
          || currentVersion(previous, patientId, branchId, 'intake')?.id !== intakeEdit?.id) throw new Error('התיק השתנה. יש לעיין בנוסח העדכני לפני האישור.');
        return approveSession(previous, sessionId);
      })) return;
      notify('העדכונים הידניים אושרו ונשמרו בגרסאות חדשות.');
    }}><Check size={16} />אישור העדכונים הידניים</button></div>}
    {history && <VersionHistory versions={historyVersions} currentId={current?.id} branchId={branchId} restoreDisabled={editing} onClose={() => setHistory(false)} onRestore={id => { if (editing) return; if (!update(previous => restoreVersion(previous, id))) return; setHistory(false); notify('הגרסה שנבחרה שוחזרה כגרסה חדשה.'); }} />}
    {sourceIds && <SourceViewer ids={sourceIds} state={state} onClose={() => setSourceIds(null)} />}
    {pendingProposal && <Modal title="השוואת הצעת העדכון" wide onClose={() => setPendingProposal(null)}>
      <p className="muted">ההצעה לא החליפה את העריכה שלך. ההשוואה היא מול הגרסה שעליה התבססה; קבלה יוצרת גרסה חדשה.</p>
      {proposalBase ? <DocumentDiff before={proposalBase.content} after={pendingProposal.content} /> : pendingProposal.baseVersionId
        ? <><p role="status">גרסת הבסיס אינה זמינה להשוואה. הנוסח המוצע מוצג במלואו.</p><DocumentText text={pendingProposal.content} /></>
        : <DocumentDiff before="" after={pendingProposal.content} />}
      {current?.id !== pendingProposal.baseVersionId && <p role="status">המסמך נערך מאז יצירת ההצעה. יש להכין הצעה מול הגרסה העדכנית לפני קבלה.</p>}
      <div className="button-row"><button className="primary" disabled={editing || current?.id !== pendingProposal.baseVersionId} onClick={() => { if (editing) return; if (!update(previous => acceptProposal(previous, pendingProposal.id))) return; setPendingProposal(null); notify('ההצעה התקבלה כגרסה חדשה.'); }}><Check size={17} />קבלת ההצעה</button><button className="secondary" onClick={() => { if (!update(previous => rejectProposal(previous, pendingProposal.id))) return; setPendingProposal(null); notify('ההצעה נדחתה. הנוסח שלך נשמר.'); }}><X size={17} />שמירת הנוסח שלי</button></div>
    </Modal>}
  </section>;
}

function VersionHistory({ versions, currentId, branchId, restoreDisabled, onClose, onRestore }: { versions: DocumentVersion[]; currentId?: string; branchId: string; restoreDisabled: boolean; onClose: () => void; onRestore: (id: string) => void }) {
  const sorted = [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [leftId, setLeftId] = useState(sorted.at(-2)?.id || sorted.at(-1)?.id || '');
  const [rightId, setRightId] = useState(currentId || sorted.at(-1)?.id || '');
  const left = sorted.find(version => version.id === leftId);
  const right = sorted.find(version => version.id === rightId);
  const options = sorted.map((version, index) => <option key={version.id} value={version.id}>גרסה {index + 1} · {dateLabel(version.createdAt)} · {version.author === 'clinician' ? 'עריכת מטפל' : version.author === 'seed' ? 'הדגמה' : 'עוזר'}{version.id === currentId ? ' · נוכחית' : ''}{version.branchId !== branchId ? ' · בסיס מהענף המקורי' : ''}</option>);
  return <Modal title="היסטוריית גרסאות והשוואה" wide onClose={onClose}>
    <p className="muted">כל שמירה היא תמונת מצב מלאה. שחזור אינו מוחק גרסאות מאוחרות.</p>{restoreDisabled && <p role="status">אפשר לעיין בגרסאות. כדי לשחזר יש לשמור או לבטל תחילה את העריכה הפתוחה.</p>}
    {sorted.length === 0 ? <p>עדיין לא נשמרו גרסאות למסמך הזה.</p> : <div className="comparison">{([{ side: 'left', version: left, value: leftId, change: setLeftId }, { side: 'right', version: right, value: rightId, change: setRightId }] as const).map(item => <article key={item.side}><label>בחירת גרסה<select value={item.value} onChange={event => item.change(event.target.value)}>{options}</select></label>{item.version && <><p className="tag historical-label">{item.version.id === currentId ? 'הגרסה הנוכחית' : 'גרסה היסטורית'}</p><DocumentText text={item.version.content} /><p className="muted small-copy">{item.version.reason}</p>{item.version.branchId !== branchId && <p className="muted small-copy">גרסת בסיס מהענף המקורי, נכון לנקודת הפיצול. אפשר לערוך את העותק הנוכחי בענף הפעיל.</p>}{item.version.id !== currentId && item.version.branchId === branchId && <button className="secondary" disabled={restoreDisabled} onClick={() => onRestore(item.version!.id)}><History size={16} />שחזור גרסה זו</button>}</>}</article>)}</div>}
    {left && right && <section aria-label="השינויים בין הגרסאות שנבחרו"><h3>מהגרסה הראשונה שנבחרה לשנייה</h3><DocumentDiff before={left.content} after={right.content} /></section>}
  </Modal>;
}

export function Dossier({ state, update, patientId, branchId, openSession, notify }: { state: PortalState; update: Update; patientId: string; branchId: string; openSession: (id: string) => void; notify: (message: string) => void }) {
  const tabsId = useId();
  const historyRef = useRef<HTMLDetailsElement>(null);
  const documentsRef = useRef<HTMLElement>(null);
  const [goal, setGoal] = useState<Goal>('note');
  const sessions = state.sessions.filter(session => session.patientId === patientId && session.branchId === branchId).sort((a, b) => b.number - a.number);
  const [noteSession, setNoteSession] = useState(sessions[0]?.id || '');
  const [archiveSessionId, setArchiveSessionId] = useState<string | null>(null);
  const editorCount = useSyncExternalStore(subscribeEditorDrafts, getEditorDraftCount, getEditorDraftCount);
  const patient = state.patients.find(item => item.id === patientId);
  const branch = state.branches.find(item => item.id === branchId);
  const latestSession = sessions[0];
  const selectedSession = sessions.find(item => item.id === noteSession) ?? latestSession;
  const archiveSession = sessions.find(item => item.id === archiveSessionId);
  const pendingSessions = sessions.filter(session => session.pendingDraft);
  const schedule = scheduleLabel(patient?.schedule);
  const ownEditors = editorCount > 0 ? [...editorDrafts.keys()].filter(key => key.startsWith(`${patientId}/${branchId}/`)) : [];
  const selectRecord = (sessionId: string) => {
    setNoteSession(sessionId); setGoal('note');
    if (historyRef.current) historyRef.current.open = false;
    requestAnimationFrame(() => { documentsRef.current?.scrollIntoView({ block: 'start' }); documentsRef.current?.focus({ preventScroll: true }); });
  };

  return <div className="dossier-page patient-portal" dir="rtl">
    <header className="portal-heading"><div><h1>התיק של {patient?.name || 'המטופל'}</h1>
      <p>רשומות הפגישות והידע שנצבר לאורך הטיפול, במקום אחד.</p>
      <div className="portal-patient-details">{schedule && <span><CalendarDays size={15} aria-hidden="true" />מועד קבוע מתוכנן: {schedule}</span>}{branch?.parentId && <span>רצף: {branch.name}</span>}</div>
    </div>{latestSession && <button className="secondary small" onClick={() => openSession(latestSession.id)}><MessageCircle size={16} aria-hidden="true" />{latestSession.status === 'approved' ? 'לשיחה האחרונה' : `להמשך פגישה ${latestSession.number}`}<ArrowLeft size={15} aria-hidden="true" /></button>}</header>

    {pendingSessions.length > 0 && <section className="portal-pending" aria-label="סיכומים שממתינים לאישור"><div><h2>יש סיכום שמחכה לעיונך</h2><p>התוצרים שהבינה הכינה בשיחה ייכנסו למסמכים רק אחרי אישורך. עד אז, הנוסחים השמורים נשארים כפי שהם.</p></div><div className="portal-pending-actions">{pendingSessions.map(session => <button className="secondary small" key={session.id} onClick={() => openSession(session.id)}>לעיון בסיכום של פגישה {session.number}<ArrowLeft size={15} aria-hidden="true" /></button>)}</div></section>}

    <details className="portal-session-history" ref={historyRef}><summary><History size={17} aria-hidden="true" /><span>רצף הפגישות</span><small>{sessions.length} פגישות בתיק</small><ChevronDown size={17} aria-hidden="true" /></summary>
      <ol>{sessions.map(session => {
        const note = currentVersion(state, patientId, branchId, 'note', session.id);
        const proposalCount = (session.draftHistory?.length ?? 0) + (session.pendingDraft ? 1 : 0);
        return <li key={session.id}><div className="portal-session-row"><div><h3>פגישה {session.number}</h3><time dateTime={session.startedAt}>{dateLabel(session.startedAt)}</time></div><span className={`portal-session-status ${session.status === 'approved' ? 'approved' : ''}`}>{sessionLabel(session, state)}</span></div>
          {note?.content ? <p className="portal-session-excerpt">{documentExcerpt(note.content, 160)}</p> : <p className="portal-session-excerpt">{session.pendingDraft ? 'הסיכום מוכן לעיון. עדיין לא אושר לתיק.' : 'עדיין אין רשומה שמורה לפגישה הזו.'}</p>}
          <div className="portal-session-actions"><button onClick={() => openSession(session.id)}><MessageCircle size={14} aria-hidden="true" />השיחה</button><button onClick={() => selectRecord(session.id)}><FileText size={14} aria-hidden="true" />הרשומה</button>{proposalCount > 0 && <button onClick={() => setArchiveSessionId(session.id)}><History size={14} aria-hidden="true" />הצעות וטיוטות ({proposalCount})</button>}</div>
        </li>;
      })}</ol>
    </details>

    {ownEditors.length > 0 && <div className="portal-unsaved" role="status"><PencilLine size={16} aria-hidden="true" /><div><strong>יש עריכה ישירה שעדיין לא נשמרה</strong><p>הטקסט נשאר פתוח במסמך שבו ערכת. יש לשמור או לבטל את העריכה לפני אישור סיכום חדש.</p><div>{ownEditors.map(key => {
      const suffix = key.slice(`${patientId}/${branchId}/`.length);
      const divider = suffix.indexOf('/');
      const editGoal = suffix.slice(0, divider) as Goal;
      const editSessionId = suffix.slice(divider + 1);
      const editSession = sessions.find(session => session.id === editSessionId);
      return <button key={key} onClick={() => { setGoal(editGoal); if (editGoal === 'note') setNoteSession(editSessionId); }}>חזרה לעריכת {GOAL_LABELS[editGoal]}{editSession ? ` — פגישה ${editSession.number}` : ''}</button>;
    })}</div></div></div>}

    <div className="document-tabs portal-document-tabs" role="tablist" onKeyDown={navigateTabs} aria-label="מסמכי התיק">{goals.map(item => <button id={`${tabsId}-${item}`} aria-controls={`${tabsId}-panel`} role="tab" tabIndex={goal === item ? 0 : -1} aria-selected={goal === item} key={item} onClick={() => setGoal(item)}>{item === 'note' ? 'רשומות הפגישות' : GOAL_LABELS[item]}</button>)}</div>
    <section id={`${tabsId}-panel`} ref={documentsRef} role="tabpanel" aria-labelledby={`${tabsId}-${goal}`} tabIndex={0}>
      {goal === 'note' && selectedSession && <div className="history-picker portal-note-picker"><label>איזו פגישה לקרוא<select value={selectedSession.id} onChange={event => setNoteSession(event.target.value)}>{sessions.map(session => <option value={session.id} key={session.id}>פגישה {session.number} · {dateLabel(session.startedAt)} · {sessionLabel(session, state)}</option>)}</select></label><div className="portal-note-actions"><button className="text-button" onClick={() => openSession(selectedSession.id)}><MessageCircle size={15} aria-hidden="true" />פתיחת השיחה</button>{Boolean(selectedSession.pendingDraft || selectedSession.draftHistory?.length) && <button className="text-button" onClick={() => setArchiveSessionId(selectedSession.id)}><History size={15} aria-hidden="true" />הצעות וטיוטות</button>}</div></div>}
      {goal === 'note' && !selectedSession ? <p className="empty-copy">עדיין אין פגישות בתיק הזה.</p> : <div className="paper portal-document-paper"><DocumentEditor key={`${patientId}-${branchId}-${goal}-${goal === 'note' ? selectedSession?.id : ''}`} state={state} update={update} patientId={patientId} branchId={branchId} kind={goal} sessionId={goal === 'note' ? selectedSession?.id : undefined} notify={notify} /></div>}
    </section>
    {archiveSession && <DraftArchive state={state} session={archiveSession} onClose={() => setArchiveSessionId(null)} openSession={() => { setArchiveSessionId(null); openSession(archiveSession.id); }} />}
  </div>;
}

function sessionLabel(session: Session, state: PortalState) {
  if (session.pendingDraft) return pendingDraftIsCurrent(state, session.id) ? 'סיכום ממתין לאישור' : 'סיכום דורש עדכון';
  return { approved: 'הרשומה אושרה', draft: 'בעריכה', asking: 'בתיעוד', writing: 'בתיעוד' }[session.status];
}

function DraftArchive({ state, session, onClose, openSession }: { state: PortalState; session: Session; onClose: () => void; openSession: () => void }) {
  const drafts = [...new Map([...(session.draftHistory ?? []), ...(session.pendingDraft ? [session.pendingDraft] : [])].map(draft => [draft.id, draft])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [selectedId, setSelectedId] = useState(drafts.at(-1)?.id ?? '');
  const selected = drafts.find(draft => draft.id === selectedId) ?? drafts.at(-1);
  const isPending = selected?.id === session.pendingDraft?.id;
  const approvalLabel = (draft: PendingDraft) => draft.approvedAt ? 'אושרה לתיק' : draft.id === session.pendingDraft?.id ? 'ממתינה לאישור' : 'הצעה קודמת';
  return <Modal title={`הצעות וטיוטות — פגישה ${session.number}`} wide onClose={onClose}><div className="portal-draft-archive">
    <p>כאן אפשר לקרוא את הנוסחים המלאים שהוצעו במהלך השיחה. התצוגה לקריאה בלבד; הרשומות והגרסאות השמורות נמצאות במסמכי התיק.</p>
    {selected ? <><label className="portal-archive-picker">בחירת הצעה<select value={selected.id} onChange={event => setSelectedId(event.target.value)}>{drafts.map((draft, index) => <option key={draft.id} value={draft.id}>הצעה {index + 1} · {dateLabel(draft.createdAt)} {timeLabel(draft.createdAt)} · {approvalLabel(draft)}</option>)}</select></label>
      <div className={`portal-archive-status ${selected.approvedAt ? 'approved' : ''}`}><strong>{approvalLabel(selected)}</strong><p>{selected.approvedAt ? `אושרה ב־${dateLabel(selected.approvedAt)}, בשעה ${timeLabel(selected.approvedAt)}. עריכות שנעשו בהמשך מופיעות בהיסטוריית גרסאות המסמכים.` : isPending ? 'ההצעה עדיין לא עדכנה את המסמכים. העיון והאישור נעשים מתוך השיחה.' : 'זהו נוסח שנשמר במהלך העבודה. מצב האישור לא תועד בהצעה הזו; אפשר לבדוק את הגרסאות במסמכי התיק.'}</p>{isPending && <button className="text-button" onClick={openSession}>לעיון בסיכום בתוך השיחה<ArrowLeft size={15} aria-hidden="true" /></button>}</div>
      {selected.result.summary && <p className="portal-archive-summary">{selected.result.summary}</p>}
      {goals.map(goal => {
        const document = selected.result.documents.find(item => item.kind === goal);
        if (!document) return null;
        return <details className="portal-archive-document" key={`${selected.id}-${goal}`} open={goal === 'note' || undefined}><summary>{GOAL_LABELS[goal]}<ChevronDown size={16} aria-hidden="true" /></summary><DocumentText text={document.content} />
          {document.sourceIds.length > 0 && <details className="portal-archive-sources"><summary>המקורות שאליהם הנוסח מפנה</summary>{[...new Set(document.sourceIds)].map(id => {
            const source = state.sources.find(item => item.id === id);
            return source ? <article key={id}><strong>{source.sessionNumber ? `פגישה ${source.sessionNumber}` : 'פרטי התיק / בין פגישות'} · {dateLabel(source.recordedAt)}</strong><p>{source.text}</p></article> : <p key={id}>המקור המקושר אינו זמין בתיק.</p>;
          })}</details>}
          {goal === 'intake' && <details className="portal-archive-fields"><summary>כל שדות האינטייק כפי שהיו בהצעה</summary>{selected.fields.map(field => <article key={field.id}><h4>{intakeFields.find(item => item.id === field.id)?.label ?? `שדה ${field.id}`}</h4><span>{statuses[field.status]}</span><p>{field.value || 'לא נמסר מידע בשדה הזה.'}</p>{field.remaining && <p>להשלמה: {field.remaining}</p>}</article>)}</details>}
        </details>;
      })}
      {Boolean(selected.result.followUps?.length) && <details className="portal-archive-followups"><summary>ההצעות להמשך שהופיעו עם הסיכום</summary>{selected.result.followUps?.map((followUp, index) => <article key={index}><strong>{followUp.kind === 'next_session' ? 'לקראת הפגישה הבאה' : 'הרחבה אפשרית'} · {GOAL_LABELS[followUp.goal]}</strong><p>{followUp.text}</p></article>)}</details>}
    </> : <p className="empty-copy">עדיין לא נשמרו הצעות לפגישה הזו.</p>}
  </div></Modal>;
}

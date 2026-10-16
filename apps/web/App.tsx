import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, BookOpen, Check, CheckCheck, ChevronDown, Download, FilePenLine, GitBranch, Leaf, LoaderCircle, LockKeyhole, Plus, RotateCcw, Send, Settings2, SlidersHorizontal, Upload, X } from 'lucide-react';
import { DEFAULT_MODEL, GOAL_LABELS, MODELS, type ContextPacket, type DraftResult, type Goal, type Mode, type ModelResponse, type PortalState, type Session, type Trace, type TurnResult } from '../../packages/contracts';
import { addUserMessage, applyTurn, approveSession, buildContext, cancelPreference, createSession, currentVersion, editDocument, exportState, forkBranch, importState, saveDraft } from '../../packages/domain';
import { loadState, persistState } from '../../packages/domain/storage';
import { buildSystemPrompt, PROMPT_VERSION } from '../../packages/prompts';
import { createDemoState } from '../../fixtures/fictional';
import { preparedDraft, preparedTurn } from '../../fixtures/fictional/prepared';
import Backstage from './Backstage';
import { clearEditorDrafts, DocumentEditor, Dossier, hasUnsavedDocumentEdits } from './Documents';
import { dateLabel, Modal } from './ui';
import { apiErrorMessage } from './api-errors';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const GOALS: Goal[] = ['note', 'formulation', 'intake', 'gold', 'supervision'];
const STATUS = { writing: 'בכתיבה', asking: 'בהשלמה', draft: 'טיוטה', approved: 'מאושרת' };
type Page = 'session' | 'dossier' | 'backstage';
type Selection = { patientId: string; branchId: string; sessionId: string };
type RequestRun = { id: string; controller: AbortController; selection: Selection; model: string; mode: Mode };
const populatedRoot = (state: PortalState, patientId: string) => state.branches.find(branch => branch.patientId === patientId && !branch.parentId && state.sessions.some(session => session.branchId === branch.id))!;
const stamp = (state: PortalState, sessionId: string) => {
  const session = state.sessions.find(item => item.id === sessionId);
  return JSON.stringify([session?.revision, state.versions.map(version => [version.id, version.proposal, version.rejected]), state.preferences]);
};

function initialState() {
  const demo = createDemoState();
  const patient = demo.patients[0];
  const branch = demo.branches.find(item => item.patientId === patient.id)!;
  if (!demo.sessions.some(item => item.patientId === patient.id && item.branchId === branch.id && item.number === 5)) return createSession(demo, patient.id, branch.id, 5).state;
  return demo;
}

export default function App() {
  const [state, setState] = useState<PortalState>(initialState);
  const stateRef = useRef(state);
  const firstPatient = state.patients[0];
  const firstBranch = populatedRoot(state, firstPatient.id);
  const [selection, setSelection] = useState<Selection>({ patientId: firstPatient.id, branchId: firstBranch.id, sessionId: state.sessions.filter(item => item.patientId === firstPatient.id && item.branchId === firstBranch.id).at(-1)!.id });
  const selectionRef = useRef(selection);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>('session');
  const [mode, setMode] = useState<Mode>('prepared');
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [token, setToken] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [settings, setSettings] = useState(false);
  const [replacement, setReplacement] = useState<{ state: PortalState; kind: 'import' | 'reset' } | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [storageStatus, setStorageStatus] = useState('טוען את ההדגמה…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [forkName, setForkName] = useState('');
  const [forkOpen, setForkOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const requestRef = useRef<RequestRun | null>(null);
  const saveSequence = useRef(Promise.resolve());
  const saveGeneration = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const patient = state.patients.find(item => item.id === selection.patientId)!;
  const branch = state.branches.find(item => item.id === selection.branchId)!;
  const session = state.sessions.find(item => item.id === selection.sessionId)!;
  const sessions = state.sessions.filter(item => item.patientId === patient.id && item.branchId === branch.id).sort((a, b) => a.number - b.number);
  const note = currentVersion(state, patient.id, branch.id, 'note', session.id);
  const historical = sessions.some(item => item.number > session.number);
  const notify = useCallback((message: string) => setToast(message), []);

  const replaceState = useCallback((next: PortalState) => { stateRef.current = next; setState(next); }, []);
  const update = useCallback((operation: (previous: PortalState) => PortalState) => { try { replaceState(operation(stateRef.current)); return true; } catch (failure) { setError(failure instanceof Error ? failure.message : 'העדכון לא נשמר. אפשר לנסות שוב.'); return false; } }, [replaceState]);

  useEffect(() => {
    let alive = true;
    loadState(stateRef.current).then(loaded => {
      if (!alive) return;
      replaceState(loaded);
      const selectedPatient = loaded.patients[0];
      const selectedBranch = populatedRoot(loaded, selectedPatient.id);
      const selectedSession = loaded.sessions.filter(item => item.patientId === selectedPatient.id && item.branchId === selectedBranch.id).sort((a, b) => a.number - b.number).at(-1)!;
      const next = { patientId: selectedPatient.id, branchId: selectedBranch.id, sessionId: selectedSession.id };
      selectionRef.current = next; setSelection(next); setReady(true);
    }).catch(() => { if (alive) { setStorageStatus('האחסון המקומי אינו זמין'); setError('לא ניתן לטעון את האחסון המקומי. ההדגמה זמינה; מומלץ לייצא את העבודה לפני סגירה.'); setReady(true); } });
    return () => { alive = false; };
  }, [replaceState]);

  useEffect(() => {
    if (!ready) return;
    const generation = ++saveGeneration.current;
    setStorageStatus('שומר בדפדפן…');
    const timer = window.setTimeout(() => {
      saveSequence.current = saveSequence.current.catch(() => undefined).then(() => persistState(state)).then(() => { if (generation === saveGeneration.current) setStorageStatus('נשמר בדפדפן הזה'); }).catch(() => { if (generation === saveGeneration.current) setStorageStatus('השמירה לא הצליחה — אפשר לייצא'); });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [state, ready]);

  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 5000); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => () => requestRef.current?.controller.abort(), []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (storageStatus === 'שומר בדפדפן…' || busy || hasUnsavedDocumentEdits()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [storageStatus, busy]);

  function cancel(message = 'ההמתנה בוטלה. הטקסט שכתבת נשמר.') {
    requestRef.current?.controller.abort(); requestRef.current = null; setBusy(false); notify(message);
  }

  function select(next: Selection) {
    if (requestRef.current) cancel('ההמתנה בוטלה בעקבות המעבר. תשובה מאוחרת לא תיכנס לפגישה.');
    selectionRef.current = next; setSelection(next); setError('');
  }

  function choosePatient(patientId: string) {
    const nextBranch = populatedRoot(stateRef.current, patientId);
    let latest = stateRef.current.sessions.filter(item => item.patientId === patientId && item.branchId === nextBranch.id).sort((a, b) => a.number - b.number).at(-1)!;
    if (page === 'session' && latest.number < 5) { const created = createSession(stateRef.current, patientId, nextBranch.id, 5); replaceState(created.state); latest = created.session; }
    select({ patientId, branchId: nextBranch.id, sessionId: latest.id });
  }

  function chooseBranch(branchId: string) {
    let nextSession = stateRef.current.sessions.filter(item => item.patientId === patient.id && item.branchId === branchId).sort((a, b) => a.number - b.number).at(-1);
    if (!nextSession) {
      const selected = stateRef.current.branches.find(item => item.id === branchId)!;
      const created = createSession(stateRef.current, patient.id, branchId, (selected.forkSession ?? 0) + 1);
      replaceState(created.state); nextSession = created.session;
    }
    select({ patientId: patient.id, branchId, sessionId: nextSession.id });
  }

  function commitComposer(next: PortalState, sessionId: string) {
    const active = next.sessions.find(item => item.id === sessionId)!;
    if (!active.composer.trim()) return next;
    return addUserMessage(next, sessionId, active.composer.trim());
  }

  function shareMore() {
    if (!session.composer.trim()) return;
    update(previous => commitComposer(previous, session.id));
    textarea.current?.focus();
  }

  async function callModel<T extends TurnResult | DraftResult>(task: 'turn' | 'draft', context: ContextPacket, run: RequestRun): Promise<ModelResponse<T>> {
    if (run.mode === 'prepared') {
      await new Promise<void>((resolve, reject) => { const timer = window.setTimeout(resolve, 420); run.controller.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true }); });
      return { result: (task === 'turn' ? preparedTurn(context) : preparedDraft(context)) as T, prompt: buildSystemPrompt(context, task), promptVersion: PROMPT_VERSION, model: run.model, elapsedMs: 0 };
    }
    const response = await fetch(`${API_URL}/api/${task}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: run.controller.signal, body: JSON.stringify({ requestId: crypto.randomUUID(), model: run.model, context }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { if (response.status === 401) setToken(''); throw new Error(apiErrorMessage(payload.error, response.status)); }
    return payload;
  }

  async function runAction(task: 'turn' | 'draft', supplied?: PortalState) {
    if (requestRef.current) return;
    const selected = stateRef.current.sessions.find(item => item.id === selectionRef.current.sessionId)!;
    if (stateRef.current.sessions.some(item => item.branchId === selected.branchId && item.number > selected.number)) { setError('להמשך שיחה מפגישה קודמת יש ליצור ענף נפרד. אפשר עדיין לערוך את הרשומה ישירות.'); return; }
    if (mode === 'live' && !token) { setAccessOpen(true); return; }
    let working = commitComposer(supplied || stateRef.current, selectionRef.current.sessionId);
    replaceState(working);
    const run: RequestRun = { id: crypto.randomUUID(), controller: new AbortController(), selection: { ...selectionRef.current }, model, mode };
    requestRef.current = run; setBusy(true); setError('');
    async function execute(kind: 'turn' | 'draft'): Promise<void> {
      const active = working.sessions.find(item => item.id === run.selection.sessionId)!;
      const context = buildContext(working, active.id, kind === 'draft' ? 'draft' : active.intakeActive ? 'intake' : 'main');
      const beforeStamp = stamp(working, active.id);
      const started = performance.now();
      const response = await callModel<TurnResult | DraftResult>(kind, context, run);
      if (requestRef.current?.id !== run.id || selectionRef.current.sessionId !== active.id) return;
      if (stamp(stateRef.current, active.id) !== beforeStamp) throw new Error('התיק השתנה בזמן ההמתנה. התשובה לא הוחלה; אפשר לבקש שוב עם הגרסה המעודכנת.');
      const trace: Trace = { id: crypto.randomUUID(), at: new Date().toISOString(), mode: run.mode, model: response.model, promptVersion: response.promptVersion, prompt: response.prompt, context, response: response.result, elapsedMs: response.elapsedMs || performance.now() - started, usage: response.usage };
      working = kind === 'draft' ? saveDraft(stateRef.current, active.id, context.baseRevision, response.result as DraftResult) : applyTurn(stateRef.current, active.id, context.baseRevision, response.result as TurnResult);
      working = { ...working, sessions: working.sessions.map(item => item.id === active.id ? { ...item, traces: [...item.traces, trace] } : item) };
      replaceState(working);
      if (kind === 'turn' && (response.result as TurnResult).action === 'draft') await execute('draft');
    }
    try { await execute(task); }
    catch (failure) { if (requestRef.current?.id === run.id && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(failure instanceof Error ? failure.message : 'התגובה לא התקבלה. אפשר לנסות שוב או לעבור לטיוטה ידנית.'); }
    finally { if (requestRef.current?.id === run.id) { requestRef.current = null; setBusy(false); } }
  }

  function answer(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (session.status !== 'asking') { shareMore(); return; }
    if (!session.composer.trim()) return;
    const next = commitComposer(stateRef.current, session.id);
    void runAction((session.intakeActive ? session.intakeCount >= 2 : session.questionCount >= 3) ? 'draft' : 'turn', next);
  }

  function skipQuestion() {
    const latest = session.traces.at(-1)?.response;
    const topic = latest && 'topic' in latest ? latest.topic : '';
    let next = { ...stateRef.current, sessions: stateRef.current.sessions.map(item => item.id === session.id ? { ...item, skippedTopics: topic ? [...item.skippedTopics, topic] : item.skippedTopics } : item) };
    next = addUserMessage(next, session.id, 'לא זכור כרגע. אפשר לדלג על השאלה הזו.');
    void runAction((session.intakeActive ? session.intakeCount >= 2 : session.questionCount >= 3) ? 'draft' : 'turn', next);
  }

  function beginIntake() {
    const next = { ...stateRef.current, sessions: stateRef.current.sessions.map(item => item.id === session.id ? { ...item, closedAt: undefined, intakeActive: true, intakeCount: 0, intakeRound: (item.intakeRound || 0) + 1, status: 'asking' as const, revision: item.revision + 1 } : item) };
    void runAction('turn', next);
  }

  function manualDraft() {
    if (busy) cancel();
    const next = commitComposer(stateRef.current, session.id);
    const active = next.sessions.find(item => item.id === session.id)!;
    const content = `# תיעוד ידני — לעיון המטפל\n\n${active.messages.filter(message => message.role === 'user').map(message => message.text).join('\n\n') || 'טרם נמסר תיאור של הפגישה.'}`;
    const edited = editDocument(next, patient.id, branch.id, 'note', content, undefined, session.id);
    replaceState({ ...edited, sessions: edited.sessions.map(item => item.id === session.id ? { ...item, status: 'draft', intakeActive: false } : item) });
    setError(''); notify('נפתחה טיוטה ידנית מתוך הדברים שכתבת. לא הופקה תשובת מודל.');
  }

  async function unlock(event: FormEvent) {
    event.preventDefault(); setAccessBusy(true); setAccessError('');
    try {
      const response = await fetch(`${API_URL}/api/access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: accessCode }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) throw new Error(apiErrorMessage(data.error, response.status));
      setToken(data.token); setAccessCode(''); setAccessOpen(false); setMode('live'); notify('ההתנסות החיה נפתחה לחומר בדיוני בלבד.');
    } catch (failure) { setAccessError(failure instanceof Error ? failure.message : 'לא ניתן להתחבר לשרת.'); } finally { setAccessBusy(false); }
  }

  function exportDemo() {
    const blob = new Blob([exportState(stateRef.current)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `merhav-demo-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('הייצוא כולל את התיקים הבדיוניים, המקורות והגרסאות.');
  }

  function adoptState(next: PortalState) {
    if (busy) cancel();
    clearEditorDrafts();
    replaceState(next);
    const nextPatient = next.patients[0]; const nextBranch = populatedRoot(next, nextPatient.id); const nextSession = next.sessions.filter(item => item.patientId === nextPatient.id && item.branchId === nextBranch.id).at(-1)!;
    select({ patientId: nextPatient.id, branchId: nextBranch.id, sessionId: nextSession.id }); setPage('session'); setSettings(false);
  }

  if (!ready) return <main className="loading-page" dir="rtl"><Leaf size={32} /><h1>מרווח</h1><p>פותח מקום למחשבה…</p></main>;

  return <div className="app" dir="rtl">
    <a className="skip-link" href="#main">דילוג לתוכן</a>
    <div className="demo-strip"><span>סביבת הדגמה · דמויות ומפגשים מומצאים בלבד</span><span className="storage-state" role="status">{storageStatus === 'נשמר בדפדפן הזה' && <CheckCheck size={14} />}{storageStatus}</span></div>
    <header className="site-header"><div className="header-inner"><button className="brand" onClick={() => setPage('session')} aria-label="מרווח — תיעוד פגישה"><span className="brand-symbol"><Leaf size={29} strokeWidth={1.3} /></span><span><strong>מרווח</strong><small>מקום למחשבה אחרי הפגישה</small></span></button><div className="identity-controls"><label>מטופל בדיוני<select value={patient.id} onChange={event => choosePatient(event.target.value)}>{state.patients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>פגישה<select value={session.id} onChange={event => select({ ...selection, sessionId: event.target.value })}>{[...sessions].reverse().map(item => <option key={item.id} value={item.id}>פגישה {item.number} · {STATUS[item.status]}</option>)}</select></label><button className="icon-button" onClick={() => setNewSessionOpen(true)} title="פגישה חדשה" aria-label="פתיחת פגישה חדשה"><Plus size={20} /></button></div><button className="settings-button" aria-label="אפשרויות הדמו" onClick={() => setSettings(true)}><Settings2 size={18} /><span>אפשרויות הדמו</span></button></div></header>
    <div className="nav-wrap"><nav className="main-nav" aria-label="ניווט ראשי">{[{ id: 'session', label: 'תיעוד פגישה', icon: FilePenLine }, { id: 'dossier', label: 'תיק המטופל', icon: BookOpen }, { id: 'backstage', label: 'מאחורי הקלעים', icon: SlidersHorizontal }].map(item => <button key={item.id} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id as Page)}><item.icon size={17} />{item.label}</button>)}</nav><button className={`mode-badge ${mode}`} onClick={() => { if (mode === 'live') { if (busy) cancel(); setMode('prepared'); } else setAccessOpen(true); }}><span className="mode-dot" />{mode === 'prepared' ? 'הדגמה מוכנה מראש' : 'התנסות חיה'}<ChevronDown size={14} /></button></div>

    <main id="main" className={`workspace ${page !== 'session' ? 'workspace-wide' : ''}`}>
      {page === 'session' && <>
        <aside className="context-rail"><div className="context-profile"><span className="patient-initial" aria-hidden="true">{patient.name.slice(0, 1)}</span><h2>{patient.name}</h2><p>{patient.age} · דמות בדיונית</p><p>{patient.description}</p></div><div className="rail-section"><h3>רצף הפגישות</h3><ol className="session-timeline">{[...sessions].reverse().map(item => <li key={item.id}><button className={item.id === session.id ? 'current' : ''} onClick={() => select({ ...selection, sessionId: item.id })}><span className="timeline-dot">{item.status === 'approved' ? <Check size={12} /> : ''}</span><span><strong>פגישה {item.number}</strong><small>{dateLabel(item.startedAt)}</small></span><span className="timeline-status">{STATUS[item.status]}</span></button></li>)}</ol><button className="text-button" onClick={() => setNewSessionOpen(true)}><Plus size={15} />פגישה חדשה</button></div><div className="rail-section"><h3>התיק נשאר בהישג יד</h3><p>המשגה, אינטייק וחומר להדרכה מתעדכנים לצד רשומת הפגישה.</p><button className="text-button" onClick={() => setPage('dossier')}>פתיחת התיק<ArrowLeft size={15} /></button></div></aside>
        <div className="session-column"><div className="session-heading"><div><span className="session-kicker">פגישה {session.number} · {dateLabel(session.startedAt)}</span><h1>{session.status === 'draft' || session.status === 'approved' ? 'מהפגישה, אל הכתב.' : session.intakeActive ? 'עוד שני פרטים, אם מתאים.' : 'מה חשוב לך לשמור מהפגישה?'}</h1><p>{session.status === 'draft' || session.status === 'approved' ? 'רשומת הפגישה ראשונה. אפשר לערוך, לבדוק מקורות ולהמשיך בקצב שלך.' : session.intakeActive ? 'סבב רצוני של שתי שאלות לכל היותר. אפשר לסיים בכל רגע.' : 'אפשר להתחיל מרגע אחד, ממחשבה או מרצף לא מסודר. יש כאן מקום לכל אלה.'}</p></div></div>
          {historical && <div className="notice"><div><strong>זו פגישה קודמת</strong><p>ההקשר מחושב נכון לפגישה הזו. להתנסות חלופית אפשר לפתוח ענף נפרד.</p></div><button className="secondary small" onClick={() => { setForkName(`התנסות מפגישה ${session.number}`); setForkOpen(true); }}><GitBranch size={16} />יצירת ענף</button></div>}
          <div className="goals-line"><span>נשמר מקום לכל חמש המטרות</span><button className="text-button" onClick={() => setPreferencesOpen(true)}><SlidersHorizontal size={14} />העדפות</button></div>
          <div className="goal-chips">{GOALS.map(goal => <span className="goal-chip" key={goal}><Check size={12} />{GOAL_LABELS[goal]}</span>)}</div>
          <section className="writing-paper" aria-label="השיתוף מהפגישה">
            {session.messages.length > 0 && <div className="conversation" role="log" aria-live="polite" aria-relevant="additions">{session.messages.map((message, index) => <article key={message.id} className={`message message-${message.role}`}><div className="message-label">{message.role === 'user' ? 'מה ששיתפת' : 'מרווח'}{message.role === 'assistant' && <span>{session.traces.find(trace => 'utterance' in trace.response && trace.response.utterance === message.text)?.mode === 'live' ? 'תשובת המודל' : 'דוגמה מוכנה מראש'}</span>}</div><p>{message.text}</p>{message.role === 'assistant' && session.status === 'asking' && (session.intakeActive ? session.intakeCount > 0 : session.questionCount > 0) && index === session.messages.length - 1 && <span className="question-progress">{session.intakeActive ? `שאלה ${session.intakeCount} מתוך 2 בסבב הרצוני` : `שאלת המשך ${session.questionCount} מתוך עד 3`}</span>}</article>)}</div>}
            <form onSubmit={answer} className="composer"><label htmlFor="session-composer" className="sr-only">{session.status === 'asking' ? 'התשובה שלך' : 'השיתוף שלך מהפגישה'}</label><textarea ref={textarea} id="session-composer" disabled={historical} maxLength={16000} value={session.composer} rows={session.messages.length ? 4 : 7} placeholder={session.status === 'asking' ? 'מה זכור לך?' : 'אני יוצא/ת מהפגישה עם…'} onChange={event => { const value = event.target.value; update(previous => ({ ...previous, sessions: previous.sessions.map(item => item.id === session.id ? { ...item, composer: value } : item) })); }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); answer(); } }} /><div className="composer-footer"><span className="keyboard-hint">Enter לשורה חדשה · Ctrl / ⌘ + Enter לשליחה</span><button type="submit" className="secondary small" disabled={historical || busy || !session.composer.trim()}><Send size={16} />{session.status === 'asking' ? 'שליחת תשובה' : 'הוספה לשיתוף'}</button></div></form>
            <div className="flow-actions">{busy ? <div className="busy-row" role="status"><LoaderCircle size={18} className="spin" /><span>{mode === 'prepared' ? 'מכין את הדוגמה…' : 'ממתין לתשובת המודל…'}</span><button className="text-button" onClick={() => cancel()}>ביטול המתנה</button></div> : <><div className="button-row">{session.status === 'writing' && <button className="primary" disabled={historical} onClick={() => void runAction('turn')}>סיימתי לשתף<ArrowLeft size={17} /></button>}{session.status === 'asking' && <button className="text-button" disabled={historical} onClick={skipQuestion}>לא זכור לי / לדלג</button>}<button disabled={historical} className={session.status === 'writing' ? 'text-button' : 'primary'} onClick={() => void runAction('draft')}>{session.status === 'draft' || session.status === 'approved' ? 'עדכון הטיוטה' : 'סיום לטיוטה'}{session.status !== 'writing' && <ArrowLeft size={17} />}</button></div><p className="quiet-note">{mode === 'prepared' ? 'התגובות בדמו מוכנות מראש; לא מתבצעת קריאת מודל.' : 'הפעלה חיה בחומר בדיוני. המודל מסייע בתיעוד, והנוסח נשאר לעיונך.'}</p></>}</div>
          </section>
          {error && <div className="error-panel" role="alert"><strong>הפעולה לא הושלמה</strong><p>{error}</p><div className="button-row"><button className="secondary" onClick={() => void runAction('draft')}>ניסיון נוסף לטיוטה</button><button className="text-button" onClick={manualDraft}>פתיחת טיוטה ידנית</button><button className="icon-button" onClick={() => setError('')} aria-label="סגירת הודעת השגיאה"><X size={17} /></button></div></div>}
          {note && <section className="draft-section"><div className="paper"><DocumentEditor key={`session-note-${session.id}`} state={state} update={update} patientId={patient.id} branchId={branch.id} kind="note" sessionId={session.id} notify={notify} /></div><div className="approval-row"><p>{session.status === 'approved' ? 'הרשומה אושרה. עריכה נוספת תיצור גרסה חדשה.' : 'עיון ואישור נשארים בידיך.'}</p><button className="primary" disabled={session.status === 'approved'} onClick={() => { if (!update(previous => approveSession(previous, session.id))) return; notify('נשמרה גרסה מאושרת של רשומת הפגישה.'); }}><CheckCheck size={17} />{session.status === 'approved' ? 'הרשומה מאושרת' : 'אישור הרשומה'}</button></div><div className="intake-invitation"><div><h3>להשלים עוד מעט מהתמונה?</h3><p>סבב אינטייק רצוני: שתי שאלות, ואז בחירה שלך אם להמשיך.</p></div><button className="secondary" disabled={historical || busy || session.intakeActive} onClick={beginIntake}>{session.intakeCount >= 2 ? 'סבב נוסף של שתי שאלות' : 'השלמת אינטייק'}</button></div><button className="text-button" onClick={() => setPage('dossier')}>עיון בתוצרים המצטברים<ArrowLeft size={16} /></button></section>}
          {!note && <p className="page-footnote">אפשר לסיים לטיוטה גם כשחסרים פרטים. מה שלא נמסר יישאר פתוח.</p>}
        </div>
      </>}
      {page !== 'session' && error && <div className="error-panel" role="alert"><strong>העדכון לא הושלם</strong><p>{error}</p><button className="text-button" onClick={() => setError('')}>סגירת ההודעה</button></div>}
      {page === 'dossier' && <Dossier key={`${patient.id}-${branch.id}`} state={state} update={update} patientId={patient.id} branchId={branch.id} openSession={id => { select({ ...selection, sessionId: id }); setPage('session'); }} notify={notify} />}
      {page === 'backstage' && <Backstage key={session.id} state={state} session={session} />}
    </main>
    <footer className="site-footer"><span>מרווח · סביבת הדגמה בחומר בדיוני</span><span>שמירה מקומית אינה גיבוי. <button onClick={exportDemo}>ייצוא העבודה</button></span></footer>
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button className="icon-button" onClick={() => setToast('')} aria-label="סגירת הודעה"><X size={15} /></button></div>}
    {accessOpen && <Modal title="התנסות חיה בחומר בדיוני" onClose={() => setAccessOpen(false)}><p>ההפעלה החיה משתמשת במודל שנבחר ודורשת קוד גישה. הקוד והגישה אינם נכללים בייצוא ונשמרים רק למשך הפתיחה הנוכחית.</p><label>מודל<select value={model} onChange={event => { if (busy) cancel(); setModel(event.target.value); }}>{MODELS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{token ? <><p className="success-copy"><Check size={17} />הגישה כבר פתוחה במפגש הזה.</p><button className="primary" onClick={() => { if (busy) cancel(); setMode('live'); setAccessOpen(false); }}>מעבר להפעלה חיה</button></> : <form onSubmit={unlock} className="access-form"><label htmlFor="access-code">קוד גישה<input id="access-code" type="password" value={accessCode} onChange={event => setAccessCode(event.target.value)} autoComplete="off" required /></label>{accessError && <p role="alert" className="error-copy">{accessError}</p>}<button className="primary" disabled={accessBusy || !accessCode.trim()}>{accessBusy ? <LoaderCircle size={17} className="spin" /> : <LockKeyhole size={17} />}פתיחת ההתנסות</button></form>}<p className="muted small-copy">אפשר להמשיך בכל זמן בהדגמה המוכנה מראש, ללא קריאות מודל.</p></Modal>}
    {settings && <Modal title="אפשרויות הדמו" onClose={() => setSettings(false)}><div className="settings-section"><h3>מצב ההפעלה</h3><div className="segmented"><button aria-pressed={mode === 'prepared'} onClick={() => { if (busy) cancel(); setMode('prepared'); }}>מוכן מראש</button><button aria-pressed={mode === 'live'} onClick={() => { setSettings(false); setAccessOpen(true); }}>התנסות חיה</button></div><label>המודל לתור הבא<select value={model} onChange={event => { if (busy) cancel(); setModel(event.target.value); }}>{MODELS.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><p className="muted small-copy">החלפת מודל שומרת את התיק וההעדפות. במצב מוכן מראש לא נשלחת בקשה.</p></div><div className="settings-section"><h3>ענף ההדגמה</h3><label>ענף פעיל<select value={branch.id} onChange={event => chooseBranch(event.target.value)}>{state.branches.filter(item => item.patientId === patient.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="text-button" onClick={() => { setSettings(false); setForkName(`התנסות מפגישה ${session.number}`); setForkOpen(true); }}><GitBranch size={17} />יצירת ענף מהפגישה הנוכחית</button></div><div className="settings-section"><h3>שמירה והעברה</h3><p>התיק נשמר בדפדפן הזה. הייצוא כולל מקורות וגרסאות מלאות; אין בו קוד גישה או מפתח.</p><div className="button-row"><button className="secondary" onClick={exportDemo}><Download size={17} />ייצוא JSON</button><button className="secondary" onClick={() => fileInput.current?.click()}><Upload size={17} />ייבוא JSON</button></div></div><div className="settings-section"><button className="text-button danger" onClick={() => { setSettings(false); setReplacement({ state: initialState(), kind: 'reset' }); }}><RotateCcw size={17} />איפוס ההדגמה הבדיונית</button></div></Modal>}
    {replacement && <Modal title={replacement.kind === 'import' ? 'ייבוא הגיבוי הבדיוני' : 'איפוס ההדגמה'} onClose={() => setReplacement(null)}><p>הפעולה תחליף את מצב ההדגמה בדפדפן הזה. אפשר לייצא את העבודה הנוכחית לפני ההחלפה.</p><p>יש להמשיך רק עם חומר בדיוני.</p><div className="button-row"><button className="secondary" onClick={exportDemo}>ייצוא לפני החלפה</button><button className="primary" onClick={() => { adoptState(replacement.state); setReplacement(null); notify('מצב ההדגמה נטען בהצלחה.'); }}>אישור והחלפה</button><button className="text-button" onClick={() => setReplacement(null)}>ביטול</button></div></Modal>}
    <input ref={fileInput} type="file" className="sr-only" accept="application/json,.json" aria-label="ייבוא הדגמה בדיונית" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { const next = importState(await file.text()); setSettings(false); setReplacement({ state: next, kind: 'import' }); } catch (failure) { notify(failure instanceof Error ? failure.message : 'הקובץ אינו ייצוא תקין של הדמו.'); } }} />
    {newSessionOpen && <Modal title="פתיחת פגישה חדשה" onClose={() => setNewSessionOpen(false)}><p>פגישה {Math.max(...sessions.map(item => item.number), 0) + 1} עבור {patient.name}, בענף ״{branch.name}״.</p><button className="primary" onClick={() => { const created = createSession(stateRef.current, patient.id, branch.id, Math.max(...sessions.map(item => item.number), 0) + 1); replaceState(created.state); select({ ...selection, sessionId: created.session.id }); setNewSessionOpen(false); setPage('session'); }}><Plus size={17} />פתיחת הפגישה</button></Modal>}
    {forkOpen && <Modal title="התנסות חלופית מהפגישה הזו" onClose={() => setForkOpen(false)}><p>הענף החדש יתחיל מהמידע שהיה זמין בפגישה {session.number}. פגישות מאוחרות בענף המקורי יישארו שם.</p><label>שם הענף<input value={forkName} maxLength={200} onChange={event => setForkName(event.target.value)} /></label><button className="primary" disabled={!forkName.trim()} onClick={() => { const created = forkBranch(stateRef.current, session.id, forkName.trim()); const continuation = createSession(created.state, patient.id, created.branch.id, session.number + 1); replaceState(continuation.state); select({ patientId: patient.id, branchId: created.branch.id, sessionId: continuation.session.id }); setForkOpen(false); notify('נפתח ענף נפרד להתנסות.'); }}><GitBranch size={17} />יצירת הענף</button></Modal>}
    {preferencesOpen && <PreferenceEditor state={state} update={update} session={session} onClose={() => setPreferencesOpen(false)} />}
  </div>;
}

function PreferenceEditor({ state, update, session, onClose }: { state: PortalState; update: (operation: (state: PortalState) => PortalState) => void; session: Session; onClose: () => void }) {
  const [topic, setTopic] = useState('');
  const [action, setAction] = useState<'less' | 'block' | 'exclude'>('less');
  const [scope, setScope] = useState<'session' | 'patient'>('session');
  const [goal, setGoal] = useState<Goal>('note');
  const context = buildContext(state, session.id);
  const labels = { less: 'פחות שאלות על הנושא', block: 'לא לשאול על הנושא', exclude: 'לא לכלול בתוצר הנבחר' };
  return <Modal title="העדפות לשיחה ולתוצרים" onClose={onClose}><p>כל חמש המטרות נשארות פעילות. אפשר לכוון נושא מסוים בלי למחוק את המקור.</p>{context.preferences.length > 0 && <ul className="preference-list">{context.preferences.map(preference => <li key={preference.id}><div><strong>{preference.topic}</strong><span>{labels[preference.action]}{preference.goal ? ` · ${GOAL_LABELS[preference.goal]}` : ''} · {preference.scope === 'patient' ? 'להמשך התיק' : 'לפגישה הזו'}</span></div><button className="icon-button" aria-label={`ביטול ההעדפה ${preference.topic}`} onClick={() => update(previous => cancelPreference(previous, session.id, preference.id))}><X size={17} /></button></li>)}</ul>}<form className="preference-form" onSubmit={event => { event.preventDefault(); update(previous => ({ ...previous, preferences: [...previous.preferences, { id: crypto.randomUUID(), topic: topic.trim(), action, scope, sessionId: session.id, patientId: session.patientId, branchId: session.branchId, recordedAt: new Date().toISOString(), ...(action === 'exclude' ? { goal } : {}) }] })); setTopic(''); }}><label>הנושא<input value={topic} maxLength={200} onChange={event => setTopic(event.target.value)} placeholder="למשל: הרקע המשפחתי" required /></label><label>מה מתאים לך<select value={action} onChange={event => setAction(event.target.value as typeof action)}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{action === 'exclude' && <label>מאיזה תוצר להחריג<select value={goal} onChange={event => setGoal(event.target.value as Goal)}>{GOALS.map(item => <option key={item} value={item}>{GOAL_LABELS[item]}</option>)}</select></label>}<label>לכמה זמן<select value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="session">לפגישה הזו</option><option value="patient">גם לפגישות הבאות בתיק</option></select></label><button className="primary" disabled={!topic.trim()}><Plus size={17} />הוספת העדפה</button></form></Modal>;
}

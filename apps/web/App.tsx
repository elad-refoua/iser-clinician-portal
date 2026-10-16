import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { ArrowLeft, BookOpen, Check, CheckCheck, ChevronDown, Download, FilePenLine, GitBranch, Leaf, LoaderCircle, LockKeyhole, Plus, RotateCcw, Send, Settings2, SlidersHorizontal, Upload, X } from 'lucide-react';
import { DEFAULT_MODEL, MAX_MODEL_REQUEST_BYTES, GOAL_LABELS, MODELS, type ContextPacket, type DraftFollowUp, type DraftResult, type Goal, type Mode, type ModelResponse, type PortalState, type Session, type Trace, type TurnResult } from '../../packages/contracts';
import { addUserMessage, advanceRequestRevision, applyTurn, approveSession, buildContext, cancelPreference, createPatient, createSession, currentVersion, exportState, forkBranch, importState, saveDraft, startExpansion, rollbackExpansion, compactModelContext } from '../../packages/domain';
import { hasUnconfirmedWork, requiresLogin, stateSignature } from './workspace-state';
import { createDemoState } from '../../fixtures/fictional';
import Backstage from './Backstage';
import { clearEditorDrafts, DocumentEditor, Dossier, hasUnsavedDocumentEdits, subscribeEditorDrafts, getEditorDraftCount } from './Documents';
import { dateLabel, Modal } from './ui';
import { apiErrorMessage, safeApiErrorCode } from './api-errors';
import NewPatient, { scheduleLabel, type NewPatientDetails } from './NewPatient';
import { readWorkspace, WorkspaceSync, type WorkspaceRecord } from './workspace-sync';
import { chooseWorkspaceAction } from './workspace-choice';
import CaseWelcome from './CaseWelcome';
import ResponseExplainer from './ResponseExplainer';
import LoginScreen from './LoginScreen';
import SessionConversation from './SessionConversation';
import ReviewProposal from './ReviewProposal';
import { canReconnectLocal, unfinishedSession } from './workflow-guards';
import { canRetryExpansion, rememberExpansionRetry, retryAfterStaleRevision, type FailedExpansionRetry } from './model-retry';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const GOALS: Goal[] = ['note', 'formulation', 'intake', 'gold', 'supervision'];
const STATUS = { writing: 'בכתיבה', asking: 'בהשלמה', draft: 'טיוטה', approved: 'מאושרת' };
type Page = 'session' | 'dossier' | 'backstage';
type Selection = { patientId: string; branchId: string; sessionId: string };
type RequestRun = { id: string; controller: AbortController; selection: Selection; model: string; mode: Mode; expansion?: { previous: Session; revision: number; goal: Goal; focusSelection?: DraftFollowUp } };
type PendingAction = { task: 'turn' | 'draft'; supplied?: PortalState; selection: Selection; stamp: string; composer: string };
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
  const loadedWorkspace = useRef(false);
  const confirmedBase = useRef<string | null>(null);
  const editorDraftCount = useSyncExternalStore(subscribeEditorDrafts, getEditorDraftCount, getEditorDraftCount);
  const firstPatient = state.patients[0];
  const firstBranch = populatedRoot(state, firstPatient.id);
  const [selection, setSelection] = useState<Selection>({ patientId: firstPatient.id, branchId: firstBranch.id, sessionId: state.sessions.filter(item => item.patientId === firstPatient.id && item.branchId === firstBranch.id).at(-1)!.id });
  const selectionRef = useRef(selection);
  const [page, setPage] = useState<Page>('session');
  const mode: Mode = 'live';
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [token, setToken] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [username, setUsername] = useState('elad');
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('');
  const [cloudError, setCloudError] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudChoice, setCloudChoice] = useState<{ record: WorkspaceRecord; token: string; localReconnectBase?: string } | null>(null);
  const cloudRef = useRef<WorkspaceSync | null>(null);
  const cloudConnection = useRef(0);
  const [settings, setSettings] = useState(false);
  const [replacement, setReplacement] = useState<{ state: PortalState; kind: 'import' | 'reset' } | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [error, setError] = useState('');
  const [failedTask, setFailedTask] = useState<'turn' | 'draft' | null>(null);
  const [failedExpansion, setFailedExpansion] = useState<FailedExpansionRetry | null>(null);
  const [errorCode, setErrorCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [forkName, setForkName] = useState('');
  const [forkOpen, setForkOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const pendingAction = useRef<PendingAction | null>(null);
  const requestRef = useRef<RequestRun | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const patient = state.patients.find(item => item.id === selection.patientId)!;
  const branch = state.branches.find(item => item.id === selection.branchId)!;
  const session = state.sessions.find(item => item.id === selection.sessionId)!;
  const sessions = state.sessions.filter(item => item.patientId === patient.id && item.branchId === branch.id).sort((a, b) => a.number - b.number);
  const note = currentVersion(state, patient.id, branch.id, 'note', session.id);
  const historical = sessions.some(item => item.number > session.number);
  const regularSchedule = scheduleLabel(patient.schedule);
  const unfinished = unfinishedSession(state, patient.id, branch.id);
  const notify = useCallback((message: string) => setToast(message), []);

  const replaceState = useCallback((next: PortalState) => { stateRef.current = next; setState(next); }, []);
  const update = useCallback((operation: (previous: PortalState) => PortalState) => { try { replaceState(operation(stateRef.current)); return true; } catch (failure) { setError(failure instanceof Error ? failure.message : 'העדכון לא נשמר. אפשר לנסות שוב.'); return false; } }, [replaceState]);

  function stopCloud() {
    const sync = cloudRef.current;
    const acknowledged = sync?.getConfirmedState();
    if (acknowledged) confirmedBase.current = stateSignature(acknowledged);
    sync?.stop();
    cloudRef.current = null;
  }

  useEffect(() => {
    if (!workspaceReady || !cloudRef.current) return;
    if (stateSignature(state) !== confirmedBase.current && !cloudError) setCloudStatus('ממתין לשמירה בשרת…');
    const timer = window.setTimeout(() => cloudRef.current?.requestSave(state), 450);
    return () => window.clearTimeout(timer);
  }, [state, workspaceReady]);

  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 5000); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => { if (conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight; }, [session.id, session.messages.length, busy, token]);
  useEffect(() => () => { requestRef.current?.controller.abort(); stopCloud(); cloudConnection.current += 1; }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (hasUnconfirmedWork(stateRef.current, confirmedBase.current, loadedWorkspace.current) || busy || hasUnsavedDocumentEdits()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [busy]);

  function returnFromEmptyExpansion(run: RequestRun | null) {
    if (!run?.expansion) return false;
    const restored = rollbackExpansion(stateRef.current, run.selection.sessionId, run.expansion.revision, run.expansion.previous);
    if (restored === stateRef.current) return false;
    replaceState(restored); pendingAction.current = null;
    return true;
  }

  function cancel(message = 'ההמתנה בוטלה. הטקסט שכתבת נשאר בשיחה; מצב השמירה מופיע בראש המסך.') {
    const run = requestRef.current;
    run?.controller.abort(); returnFromEmptyExpansion(run); requestRef.current = null; setBusy(false); notify(message);
  }

  function select(next: Selection) {
    pendingAction.current = null;
    if (requestRef.current) cancel('ההמתנה בוטלה בעקבות המעבר. תשובה מאוחרת לא תיכנס לפגישה.');
    selectionRef.current = next; setSelection(next); setError(''); setFailedTask(null); setFailedExpansion(null); setErrorCode('');
  }

  function choosePatient(patientId: string) {
    const nextBranch = populatedRoot(stateRef.current, patientId);
    const latest = stateRef.current.sessions.filter(item => item.patientId === patientId && item.branchId === nextBranch.id).sort((a, b) => a.number - b.number).at(-1)!;
    select({ patientId, branchId: nextBranch.id, sessionId: latest.id });
  }

  function beginCase(patientId: string) {
    const nextBranch = populatedRoot(stateRef.current, patientId);
    const latest = stateRef.current.sessions.filter(item => item.patientId === patientId && item.branchId === nextBranch.id).sort((a, b) => a.number - b.number).at(-1)!;
    const open = unfinishedSession(stateRef.current, patientId, nextBranch.id);
    if (open) select({ patientId, branchId: nextBranch.id, sessionId: open.id });
    else if (latest.status === 'approved') {
      const created = createSession(stateRef.current, patientId, nextBranch.id, latest.number + 1);
      replaceState(created.state);
      select({ patientId, branchId: nextBranch.id, sessionId: created.session.id });
    } else select({ patientId, branchId: nextBranch.id, sessionId: latest.id });
    setWelcomeOpen(false); setPage('session');
  }

  function openPatient(details: NewPatientDetails) {
    const created = createPatient(stateRef.current, details);
    replaceState(created.state);
    select({ patientId: created.patient.id, branchId: created.branch.id, sessionId: created.session.id });
    setNewPatientOpen(false); setWelcomeOpen(false);
    setPage('session');
    notify('התיק החדש נפתח בפגישה 1. אפשר להתחיל לשתף.');
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

  async function callModel<T extends TurnResult | DraftResult>(task: 'turn' | 'draft', context: ContextPacket, run: RequestRun, accessToken: string): Promise<ModelResponse<T>> {
    const body = JSON.stringify({ requestId: crypto.randomUUID(), model: run.model, context });
    if (new TextEncoder().encode(body).byteLength > MAX_MODEL_REQUEST_BYTES) throw new Error('ההקשר גדול ממגבלת ההפעלה הנוכחית. לא נשלחה בקשה ולא הושמט מידע. כל התיק נשאר זמין לעריכה ולייצוא; מצב השמירה בשרת מופיע בראש המסך.');
    const response = await fetch(`${API_URL}/api/${task}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, signal: run.controller.signal, body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(apiErrorMessage(payload.error, response.status)), { status: response.status, code: payload.error, minimumRevision: payload.minimumRevision });
    return payload;
  }

  async function runAction(task: 'turn' | 'draft', supplied?: PortalState, accessToken = token, expansionPrevious?: Session) {
    if (requestRef.current) return;
    const selected = stateRef.current.sessions.find(item => item.id === selectionRef.current.sessionId)!;
    if (stateRef.current.sessions.some(item => item.branchId === selected.branchId && item.number > selected.number)) { setError('להמשך שיחה מפגישה קודמת יש ליצור ענף נפרד. אפשר עדיין לערוך את הרשומה ישירות.'); return; }
    if (!accessToken) {
      pendingAction.current = { task, supplied, selection: { ...selectionRef.current }, stamp: stamp(stateRef.current, selected.id), composer: selected.composer };
      setAccessError('יש להיכנס שוב. הפעולה תמשיך לאחר פתיחת התיקים.'); setToken(''); return;
    }
    let working = commitComposer(supplied || stateRef.current, selectionRef.current.sessionId);
    replaceState(working);
    const startedSession = working.sessions.find(item => item.id === selected.id)!;
    const run: RequestRun = { id: crypto.randomUUID(), controller: new AbortController(), selection: { ...selectionRef.current }, model, mode, ...(expansionPrevious && startedSession.focusGoal ? { expansion: { previous: expansionPrevious, revision: startedSession.revision, goal: startedSession.focusGoal, focusSelection: startedSession.focusSelection ? structuredClone(startedSession.focusSelection) : undefined } } : {}) };
    requestRef.current = run; setBusy(true); setError(''); setFailedTask(null); setFailedExpansion(null); setErrorCode('');
    let attemptedTask = task;
    async function execute(kind: 'turn' | 'draft'): Promise<void> {
      attemptedTask = kind;
      let active!: Session; let context!: ContextPacket; let beforeStamp = ''; let started = 0;
      const response = await retryAfterStaleRevision(async () => {
        active = working.sessions.find(item => item.id === run.selection.sessionId)!;
        context = compactModelContext(buildContext(working, active.id, kind === 'draft' ? 'draft' : active.intakeActive ? 'intake' : 'main'));
        beforeStamp = stamp(working, active.id);
        started = performance.now();
        try { return await callModel<TurnResult | DraftResult>(kind, context, run, accessToken); }
        catch (failure) {
          if (failure && typeof failure === 'object' && 'status' in failure && failure.status === 401 && requestRef.current?.id === run.id) {
            const current = stateRef.current.sessions.find(item => item.id === run.selection.sessionId)!;
            pendingAction.current = { task: kind, selection: { ...run.selection }, stamp: stamp(stateRef.current, current.id), composer: current.composer };
            stopCloud(); setWorkspaceReady(false); setToken('');
            setAccessError('הכניסה הסתיימה. הדברים שכתבת נשארו בשיחה בזיכרון הלשונית; אחרי כניסה נמשיך באותה פעולה.');
          }
          throw failure;
        }
      }, minimumRevision => {
        if (requestRef.current?.id !== run.id || selectionRef.current.sessionId !== active.id
          || stamp(stateRef.current, active.id) !== beforeStamp || minimumRevision <= context.baseRevision) return false;
        working = advanceRequestRevision(stateRef.current, active.id, context.baseRevision, minimumRevision);
        if (run.expansion) run.expansion.revision = minimumRevision;
        replaceState(working);
        notify('השרת כבר עיבד את גרסת הפגישה הזו. מבקשים תגובה עדכנית במסגרת מגבלות השימוש.');
        return true;
      });
      if (requestRef.current?.id !== run.id || selectionRef.current.sessionId !== active.id) return;
      if (stamp(stateRef.current, active.id) !== beforeStamp) throw new Error('התיק השתנה בזמן ההמתנה. התשובה לא הוחלה; אפשר לבקש שוב עם הגרסה המעודכנת.');
      const trace: Trace = { id: crypto.randomUUID(), at: new Date().toISOString(), mode: run.mode, model: response.model, promptVersion: response.promptVersion, prompt: response.prompt, contextOrigin: response.effectiveContext ? 'server' : 'client', context: response.effectiveContext || context, response: response.result, elapsedMs: response.elapsedMs ?? performance.now() - started, usage: response.usage };
      working = kind === 'draft' ? saveDraft(stateRef.current, active.id, context.baseRevision, response.result as DraftResult) : applyTurn(stateRef.current, active.id, context.baseRevision, response.result as TurnResult);
      working = { ...working, sessions: working.sessions.map(item => item.id === active.id ? { ...item, traces: [...item.traces, trace] } : item) };
      replaceState(working);
      if (kind === 'turn' && (response.result as TurnResult).action === 'draft') await execute('draft');
    }
    try { await execute(task); }
    catch (failure) {
      if (requestRef.current?.id === run.id) {
        const rolledBack = returnFromEmptyExpansion(run);
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setFailedTask(attemptedTask);
          setFailedExpansion(rolledBack && run.expansion ? rememberExpansionRetry(stateRef.current, run.selection, run.expansion.goal, run.expansion.focusSelection) : null);
          setErrorCode(safeApiErrorCode(failure && typeof failure === 'object' && 'code' in failure ? failure.code : undefined));
          setError(failure instanceof Error ? failure.message : 'התגובה לא התקבלה. אפשר לנסות שוב או לעבור לטיוטה ידנית.');
        }
      }
    }
    finally { if (requestRef.current?.id === run.id) { requestRef.current = null; setBusy(false); } }
  }

  function answer(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (!session.composer.trim()) return;
    const next = commitComposer(stateRef.current, session.id);
    void runAction((session.intakeActive ? session.intakeCount >= 2 : session.questionCount >= 3) ? 'draft' : 'turn', next);
  }

  function skipQuestion() {
    const latest = session.traces.at(-1)?.response;
    const topic = latest && 'topic' in latest ? latest.topic : '';
    let next = { ...stateRef.current, sessions: stateRef.current.sessions.map(item => item.id === session.id ? { ...item, skippedTopics: topic ? [...item.skippedTopics, topic] : item.skippedTopics } : item) };
    next = addUserMessage(next, session.id, 'אבקש לדלג על השאלה הזו.');
    void runAction((session.intakeActive ? session.intakeCount >= 2 : session.questionCount >= 3) ? 'draft' : 'turn', next);
  }

  function beginExpansion(goal: Goal, selection?: DraftFollowUp) {
    try { const previous = stateRef.current.sessions.find(item => item.id === session.id)!; void runAction('turn', startExpansion(stateRef.current, session.id, goal, selection), token, previous); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'לא ניתן לפתוח הרחבה כרגע.'); }
  }

  function retryFailedAction() {
    if (busy || requestRef.current) return;
    if (failedExpansion) {
      if (!canRetryExpansion(stateRef.current, selectionRef.current, failedExpansion)) {
        setError('התיק השתנה מאז ניסיון ההרחבה. יש לבחור מחדש הצעת הרחבה מתוך הסיכום המעודכן.');
        return;
      }
      beginExpansion(failedExpansion.goal, failedExpansion.focusSelection);
      return;
    }
    void runAction(failedTask ?? 'draft');
  }

  function resumePending(accessToken: string) {
    const pending = pendingAction.current;
    pendingAction.current = null;
    if (!pending) return;
    const active = stateRef.current.sessions.find(item => item.id === selectionRef.current.sessionId)!;
    if (pending.selection.patientId === selectionRef.current.patientId && pending.selection.branchId === selectionRef.current.branchId && pending.selection.sessionId === active.id && pending.stamp === stamp(stateRef.current, active.id) && pending.composer === active.composer) {
      void runAction(pending.task, pending.supplied, accessToken);
    } else notify('התיק השתנה בזמן הכניסה. אפשר לשלוח מחדש מתוך המצב המעודכן.');
  }

  function activateCloud(record: WorkspaceRecord, accessToken: string, working: PortalState) {
    stopCloud();
    setCloudError('');
    confirmedBase.current = record.state ? stateSignature(record.state) : null;
    const sync = new WorkspaceSync({ apiURL: API_URL, token: accessToken, revision: record.revision, confirmedState: record.state, updatedAt: record.updatedAt, onStatus: event => {
      if (cloudRef.current !== sync) return;
      const acknowledged = sync.getConfirmedState();
      if (acknowledged) confirmedBase.current = stateSignature(acknowledged);
      if (event.status === 'saved') {
        const confirmed = sync.getConfirmedState();
        confirmedBase.current = confirmed ? stateSignature(confirmed) : null;
        loadedWorkspace.current = true;
        setWorkspaceReady(true); setCloudError('');
        setCloudStatus(confirmedBase.current === stateSignature(stateRef.current) ? 'נשמר בשרת' : 'ממתין לשמירה בשרת…');
        resumePending(accessToken);
      } else if (event.status === 'pending') {
        setCloudStatus('שומר בשרת…');
      } else {
        setCloudStatus('השינויים טרם נשמרו בשרת');
        if (event.status === 'auth') { setToken(''); setWorkspaceReady(false); }
        setCloudError(event.status === 'conflict' ? 'התיקים בשרת השתנו בחלון אחר. השינויים שכאן נמצאים בזיכרון הלשונית בלבד. יש לבדוק את העותקים לפני המשך שמירה.' : event.status === 'auth' ? 'הכניסה הסתיימה. השינויים שכאן נמצאים בזיכרון בלבד; יש להיכנס שוב ולשמור לפני סגירת הלשונית.' : event.error === 'workspace_too_large' ? 'התיק חורג ממגבלת ההעברה הנוכחית לשרת. השינויים טרם נשמרו; העבודה המלאה זמינה לייצוא ולניסיון נוסף.' : 'השמירה בשרת לא אושרה. השינויים נמצאים בזיכרון הלשונית בלבד; יש לנסות שוב או לייצא לפני סגירה.');
      }
    } });
    cloudRef.current = sync;
    // A new empty workspace is not editable until its first server write succeeds.
    if (record.state) { loadedWorkspace.current = true; setWorkspaceReady(true); }
    sync.requestSave(working);
  }

  async function connectCloud(accessToken: string) {
    const connection = ++cloudConnection.current;
    setCloudBusy(true); setCloudError('');
    stopCloud();
    setCloudStatus('פותח את התיקים מהשרת…');
    try {
      const record = await readWorkspace(API_URL, accessToken);
      if (connection !== cloudConnection.current) return;
      // No browser snapshot is read. A fresh login starts from server state only.
      if (!loadedWorkspace.current) {
        if (record.state) adoptState(record.state);
        activateCloud(record, accessToken, record.state ?? stateRef.current);
        return;
      }
      const working = stateRef.current;
      const action = chooseWorkspaceAction(working, record.state, confirmedBase.current);
      const choice = { record, token: accessToken, ...(canReconnectLocal(record.state, confirmedBase.current) ? { localReconnectBase: confirmedBase.current! } : {}) };
      if (record.state && action === 'connect') {
        activateCloud(record, accessToken, working);
      } else if (record.state && action === 'load' && !hasUnsavedDocumentEdits() && !requestRef.current) {
        adoptState(record.state);
        activateCloud(record, accessToken, record.state);
      } else {
        setWorkspaceReady(true);
        setCloudStatus('השמירה ממתינה לבחירת העותק');
        setCloudChoice(choice);
      }
    } catch (failure) {
      if (connection !== cloudConnection.current) return;
      setCloudStatus('אין חיבור לשמירה בשרת');
      if (requiresLogin(failure)) {
        setToken(''); setWorkspaceReady(false);
        setAccessError('הכניסה הסתיימה. יש להיכנס שוב; העבודה שטרם נשמרה נשארת בזיכרון הלשונית.');
      } else {
        // Availability failures must not invalidate successful authentication.
        setCloudError('לא ניתן לפתוח את התיקים מהשרת כרגע. אפשר לנסות שוב. עבודה שכבר נפתחה נשארת בזיכרון הלשונית בלבד.');
        setWorkspaceReady(loadedWorkspace.current);
      }
    } finally { if (connection === cloudConnection.current) setCloudBusy(false); }
  }

  function openCloud() {
    if (cloudBusy) return;
    pendingAction.current = null;
    setSettings(false);
    if (token) void connectCloud(token);
    else { setWorkspaceReady(false); setAccessError(''); }
  }

  function loadCloudChoice() {
    if (!cloudChoice?.record.state || hasUnsavedDocumentEdits() || cloudBusy) return;
    if (busy) cancel();
    const { record, token: accessToken } = cloudChoice;
    adoptState(record.state!);
    activateCloud(record, accessToken, record.state!);
    setCloudChoice(null);
    notify('נפתח העותק מהשרת.');
  }

  async function reconnectLocalChoice() {
    const choice = cloudChoice;
    if (!choice?.localReconnectBase || cloudBusy) return;
    const connection = ++cloudConnection.current;
    setCloudBusy(true); setCloudError('');
    try {
      const fresh = await readWorkspace(API_URL, choice.token);
      if (connection !== cloudConnection.current) return;
      if (!canReconnectLocal(fresh.state, choice.localReconnectBase)) {
        setCloudChoice({ record: fresh, token: choice.token });
        setCloudError('התיקים בשרת השתנו מאז הבדיקה. העבודה שבזיכרון לא החליפה אותם; אפשר לייצא אותה או לפתוח את העותק המעודכן.');
        return;
      }
      // The fresh revision remains the CAS precondition for the next save.
      setCloudChoice(null);
      activateCloud(fresh, choice.token, stateRef.current);
    } catch (failure) {
      if (connection !== cloudConnection.current) return;
      if (requiresLogin(failure)) { setToken(''); setWorkspaceReady(false); }
      setCloudError('לא ניתן לוודא שהשרת לא השתנה. העבודה נשארת בזיכרון הלשונית; אפשר לנסות שוב.');
    } finally { if (connection === cloudConnection.current) setCloudBusy(false); }
  }

  function downloadSnapshot(snapshot: string, prefix = 'mervach-demo') {
    const blob = new Blob([snapshot], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function unlock(event: FormEvent) {
    event.preventDefault(); setAccessBusy(true); setAccessError('');
    try {
      const response = await fetch(`${API_URL}/api/access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: accessCode }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) throw new Error(apiErrorMessage(data.error, response.status));
      setWorkspaceReady(false); setToken(data.token); setAccessCode(''); setAccessOpen(false);
      await connectCloud(data.token);
    } catch (failure) { setAccessError(failure instanceof Error ? failure.message : 'לא ניתן להתחבר לשרת.'); } finally { setAccessBusy(false); }
  }

  function exportDemo() {
    downloadSnapshot(exportState(stateRef.current));
    notify('הייצוא כולל את התיקים הבדיוניים, המקורות והגרסאות.');
  }

  function openLive() {
    pendingAction.current = null;
    setAccessError(''); setAccessOpen(true);
  }

  function closeAccess() {
    if (accessBusy) return;
    pendingAction.current = null; setAccessOpen(false); setAccessCode('');
  }

  function adoptState(next: PortalState) {
    const hadPendingAction = Boolean(pendingAction.current);
    if (busy) cancel();
    clearEditorDrafts();
    replaceState(next);
    const nextPatient = next.patients[0]; const nextBranch = populatedRoot(next, nextPatient.id); const nextSession = next.sessions.filter(item => item.patientId === nextPatient.id && item.branchId === nextBranch.id).at(-1)!;
    select({ patientId: nextPatient.id, branchId: nextBranch.id, sessionId: nextSession.id }); setPage('session'); setSettings(false);
    if (hadPendingAction) setError('נפתח עותק אחר של התיקים, ולכן הבקשה לבינה לא נשלחה מחדש. אפשר לבחור פגישה ולהמשיך ממנה.');
  }

  function deferCloudChoice() {
    setCloudChoice(null); setCloudStatus('השינויים טרם נשמרו בשרת');
    setCloudError('יש עבודה בזיכרון הלשונית שטרם נשמרה. יש להתחבר מחדש ולבחור עותק, או לייצא לפני סגירה.');
    pendingAction.current = null;
  }

  const cloudDialog = cloudChoice && <Modal title="התיקים בשרת והעבודה שבזיכרון" onClose={() => { if (!cloudBusy) deferCloudChoice(); }}>
    <p>העותק בשרת והעבודה הפתוחה בלשונית שונים. השמירה נעצרה כדי שלא להחליף שינויים מחלון אחר.</p>
    <p>פתיחת העותק מהשרת מחליפה את העבודה שבזיכרון. אין עותק שחזור בדפדפן. אפשר לייצא את העבודה לפני הבחירה.</p>
    {hasUnsavedDocumentEdits() && <p role="alert">יש עריכה ישירה פתוחה. יש לשמור או לבטל אותה לפני החלפת התיקים. ייצוא JSON אינו כולל טקסט שעדיין פתוח בעורך.</p>}
    {cloudChoice.localReconnectBase && <p>העותק בשרת עדיין תואם לשמירה האחרונה של הלשונית הזו. אפשר לשמור את העבודה שכאן; נבדוק שוב שהשרת לא השתנה.</p>}
    {cloudError && <p role="alert" className="error-copy">{cloudError}</p>}
    <div className="button-row">
      {cloudChoice.localReconnectBase && <button className="primary" disabled={cloudBusy} onClick={() => void reconnectLocalChoice()}>{cloudBusy ? 'בודק ושומר…' : 'שמירת העבודה שבזיכרון בשרת'}</button>}
      <button className="secondary" disabled={cloudBusy || hasUnsavedDocumentEdits() || !cloudChoice.record.state} onClick={loadCloudChoice}>החלפת העבודה בעותק מהשרת</button>
      <button className="secondary" onClick={exportDemo}>ייצוא העבודה כאן</button>
      <button className="text-button" disabled={cloudBusy} onClick={deferCloudChoice}>חזרה לעבודה ללא שמירה כרגע</button>
    </div>
  </Modal>;

  if (!token) return <><LoginScreen username={username} onUsernameChange={setUsername} password={accessCode} onPasswordChange={setAccessCode} busy={accessBusy} error={accessError || cloudError} onSubmit={unlock} />{loadedWorkspace.current && <div className="cloud-notice" role="status"><p>עבודה שטרם נשמרה קיימת בזיכרון הלשונית בלבד. אין לרענן או לסגור לפני כניסה ושמירה.</p><button className="secondary" onClick={exportDemo}>ייצוא העבודה שבזיכרון</button></div>}</>;

  if (!workspaceReady) return <main className="loading-page" dir="rtl"><Leaf size={32} /><h1>מרווח</h1><p>{cloudError ? 'התיקים עדיין לא נפתחו' : 'פותח את התיקים מהשרת…'}</p>{cloudError && <div className="error-panel" role="alert"><p>{cloudError}</p><button className="primary" disabled={cloudBusy} onClick={openCloud}>ניסיון חיבור נוסף</button>{loadedWorkspace.current && <button className="secondary" onClick={exportDemo}>ייצוא העבודה שבזיכרון</button>}</div>}{cloudDialog}</main>;

  return <div className="app" dir="rtl">
    <a className="skip-link" href="#main">דילוג לתוכן</a>
    <div className="demo-strip"><span>סביבת עבודה עם תיקים בדיוניים</span><div className="storage-actions"><span className="storage-state" role="status">{cloudStatus === 'נשמר בשרת' && editorDraftCount === 0 && <CheckCheck size={14} />}{editorDraftCount > 0 ? 'עריכה פתוחה — טרם נשמרה בשרת' : cloudStatus}</span><button className="storage-connect" disabled={cloudBusy || cloudStatus === 'שומר בשרת…' || cloudStatus === 'ממתין לשמירה בשרת…'} onClick={openCloud}>{cloudBusy ? 'מתחבר…' : cloudRef.current && !cloudError ? 'רענון מהמאגר' : 'פתיחת התיקים השמורים'}</button></div></div>
    <header className="site-header"><div className="header-inner"><button className="brand" onClick={() => setPage('session')} aria-label="מרווח — תיעוד פגישה"><span className="brand-symbol"><Leaf size={29} strokeWidth={1.3} /></span><span><strong>מרווח</strong><small>מקום למחשבה אחרי הפגישה</small></span></button><div className="identity-controls"><label>מטופל בדיוני<select value={patient.id} onChange={event => choosePatient(event.target.value)}>{state.patients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>פגישה<select value={session.id} onChange={event => select({ ...selection, sessionId: event.target.value })}>{[...sessions].reverse().map(item => <option key={item.id} value={item.id}>פגישה {item.number} · {STATUS[item.status]}</option>)}</select></label><button className="icon-button" onClick={() => setNewSessionOpen(true)} title="פגישה חדשה" aria-label="פתיחת פגישה חדשה"><Plus size={20} /></button></div><button className="secondary small new-patient-button" onClick={() => setNewPatientOpen(true)}><Plus size={16} />תיק חדש</button><button className="settings-button" aria-label="הגדרות המערכת" onClick={() => setSettings(true)}><Settings2 size={18} /><span>הגדרות המערכת</span></button></div></header>
    <div className="nav-wrap"><nav className="main-nav" aria-label="ניווט ראשי">{[{ id: 'session', label: 'תיעוד פגישה', icon: FilePenLine }, { id: 'dossier', label: 'תיק המטופל', icon: BookOpen }, { id: 'backstage', label: 'מאחורי הקלעים', icon: SlidersHorizontal }].map(item => <button key={item.id} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id as Page)}><item.icon size={17} />{item.label}</button>)}<button onClick={() => setWelcomeOpen(true)}><BookOpen size={17} />היכרות עם התיקים</button></nav><button className="mode-badge live" onClick={openLive}><span className="mode-dot" />{token ? `שיחה עם ${MODELS.find(item => item.id === model)?.label || model}` : 'פתיחת השיחה עם הבינה'}<ChevronDown size={14} /></button></div>

    {cloudError && <div className="cloud-notice" role="alert"><p>{cloudError}</p><div className="button-row"><button className="secondary small" disabled={cloudBusy} onClick={openCloud}>חיבור מחדש למאגר</button><button className="text-button" onClick={exportDemo}>ייצוא העבודה כאן</button></div></div>}
    <main id="main" className={`workspace ${page !== 'session' ? 'workspace-wide' : 'workspace-session'}`}>
      {page === 'session' && <div className="quiet-session">
        <div className="quiet-session-meta"><span>{patient.name} · פגישה {session.number} · {dateLabel(session.startedAt)}</span><div><button className="text-button" onClick={() => setPreferencesOpen(true)}><SlidersHorizontal size={14} />העדפות לשיחה</button><button className="text-button" onClick={() => setPage('dossier')}>תיק המטופל<ArrowLeft size={14} /></button></div></div>
        {historical && <div className="notice"><div><strong>פגישה קודמת</strong><p>אפשר לקרוא את השיחה ולערוך את הרשומה בתיק. להמשך חלופי אפשר לפתוח ענף נפרד.</p></div><button className="secondary small" onClick={() => { setForkName(`התנסות מפגישה ${session.number}`); setForkOpen(true); }}><GitBranch size={16} />יצירת ענף</button></div>}
        <SessionConversation session={session} patientName={patient.name} busy={busy} disabled={historical} modelLabel={MODELS.find(item => item.id === model)?.label || model}
          onComposerChange={value => update(previous => ({ ...previous, sessions: previous.sessions.map(item => item.id === session.id ? { ...item, composer: value } : item) }))}
          onSend={answer} onPrepare={() => void runAction('draft')} onSkip={skipQuestion} onCancel={() => cancel()} onExplain={() => setExplanationOpen(true)} />
        {error && <div className="error-panel" role="alert"><strong>הפעולה לא הושלמה</strong><p>{error}</p>{failedExpansion && <p>{canRetryExpansion(state, selection, failedExpansion) ? 'ניסיון נוסף יפתח סבב הרחבה חדש לאותו נושא ולאותה הצעה.' : 'התיק השתנה. יש לבחור מחדש הצעת הרחבה מתוך הסיכום המעודכן.'}</p>}{errorCode && <details><summary>פרטי התקלה</summary><p>קוד תקלה: <bdi><code>{errorCode}</code></bdi></p></details>}<div className="button-row"><button className="secondary" disabled={busy || historical || Boolean(failedExpansion && !canRetryExpansion(state, selection, failedExpansion))} onClick={retryFailedAction}>{failedExpansion ? 'ניסיון נוסף לאותה הרחבה' : failedTask === 'turn' ? 'ניסיון נוסף לתגובה' : 'ניסיון נוסף לסיכום'}</button><button className="icon-button" onClick={() => setError('')} aria-label="סגירת הודעת השגיאה"><X size={17} /></button></div></div>}
        {session.pendingDraft && editorDraftCount > 0 && <div className="notice">יש עריכה ישירה שטרם נשמרה בתיק. יש לשמור או לבטל אותה לפני אישור הסיכום.</div>}
        {session.pendingDraft && <ReviewProposal pending={session.pendingDraft} state={state} session={session} busy={busy || historical || editorDraftCount > 0}
          onApprove={id => { if (busy || historical || hasUnsavedDocumentEdits() || session.composer.trim()) return; if (!update(previous => approveSession(previous, session.id, id))) return; notify('הרשומה והעדכונים אושרו. הגרסאות זמינות בתיק המטופל.'); }}
          onExpand={beginExpansion} onRevise={() => { document.querySelector<HTMLTextAreaElement>('.chat-compose textarea')?.focus(); }} onExplain={() => setExplanationOpen(true)} />}
        {session.status === 'approved' && !session.pendingDraft && <div className="approved-summary"><CheckCheck size={20} /><div><strong>הרשומה והעדכונים אושרו</strong><p>כל התוצרים והגרסאות זמינים בתיק המטופל. אפשר להמשיך כאן עם תיקון או תוספת.</p></div><button className="secondary" onClick={() => setPage('dossier')}>פתיחת התיק</button></div>}
        {note && !session.pendingDraft && session.status !== 'approved' && <details className="saved-note"><summary>הרשומה שנשמרה בתיק</summary><DocumentEditor key={`session-note-${session.id}`} state={state} update={update} patientId={patient.id} branchId={branch.id} kind="note" sessionId={session.id} notify={notify} /></details>}
        <p className="quiet-save-note">השיחה והטיוטה נשמרות להמשך עבודה. מסמכי התיק מתעדכנים רק לאחר אישור.</p>
      </div>}
      {page !== 'session' && error && <div className="error-panel" role="alert"><strong>העדכון לא הושלם</strong><p>{error}</p><button className="text-button" onClick={() => setError('')}>סגירת ההודעה</button></div>}
      {page === 'dossier' && <Dossier key={`${patient.id}-${branch.id}`} state={state} update={update} patientId={patient.id} branchId={branch.id} openSession={id => { select({ ...selection, sessionId: id }); setPage('session'); }} notify={notify} />}
      {page === 'backstage' && <Backstage key={session.id} state={state} session={session} />}
    </main>
    <footer className="site-footer"><span>מרווח · תיעוד בעזרת בינה מלאכותית · חומר בדיוני בלבד</span><span>{cloudError ? 'יש שינויים בזיכרון שטרם נשמרו בשרת.' : 'השמירה האוטומטית היא בשרת בלבד.'} <button onClick={exportDemo}>ייצוא עותק נוסף</button></span></footer>
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button className="icon-button" onClick={() => setToast('')} aria-label="סגירת הודעה"><X size={15} /></button></div>}
    {cloudDialog}
    {explanationOpen && <Modal title="איך נוצרה התשובה" wide onClose={() => setExplanationOpen(false)}><ResponseExplainer key={session.id} state={state} session={session} busy={busy} onOpenBackstage={() => { setExplanationOpen(false); setPage('backstage'); }} /></Modal>}
    {accessOpen && <Modal title="מודל השיחה" onClose={closeAccess}><p>כל תשובה חדשה נוצרת מהשיחה ומההקשר של התיק הנבחר.</p><label>המודל לתור הבא<select value={model} onChange={event => { if (busy) cancel(); setModel(event.target.value); }}>{MODELS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><p className="muted">החלפה שומרת את התיק וההעדפות. פרטי כל הרצה מופיעים מאחורי הקלעים.</p><button className="primary" onClick={closeAccess}>חזרה לשיחה</button></Modal>}
    {settings && <Modal title="הגדרות המערכת" onClose={() => setSettings(false)}><div className="settings-section"><h3>השיחה עם הבינה</h3><p>כל תשובה חדשה וכל טיוטה שהבינה מכינה מופקות ממודל שפה. ההיסטוריה של הדמויות מספקת את ההקשר לשיחה.</p><button className="secondary" onClick={() => { setSettings(false); openLive(); }}>{token ? 'פרטי החיבור למודל' : 'פתיחת השיחה עם הבינה'}</button><label>המודל לתור הבא<select value={model} onChange={event => { if (busy) cancel(); setModel(event.target.value); }}>{MODELS.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><p className="muted small-copy">החלפת מודל שומרת את התיק וההעדפות. כל מודל מקבל את אותו מבנה הקשר ואת כללי השיחה.</p></div><div className="settings-section"><h3>ענף ההדגמה</h3><label>ענף פעיל<select value={branch.id} onChange={event => chooseBranch(event.target.value)}>{state.branches.filter(item => item.patientId === patient.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="text-button" onClick={() => { setSettings(false); setForkName(`התנסות מפגישה ${session.number}`); setForkOpen(true); }}><GitBranch size={17} />יצירת ענף מהפגישה הנוכחית</button></div><div className="settings-section"><h3>שמירה והעברה</h3><button className="secondary" onClick={openCloud}>פתיחת המאגר הפרטי</button><p>התיקים נפתחים ונשמרים בשרת בלבד, ואפשר לחזור אליהם ממכשיר אחר. עבודה שטרם נשמרה קיימת בזיכרון הלשונית בלבד ועלולה לאבד ברענון או בסגירה. ייצוא ידני כולל מקורות וגרסאות, ללא פרטי כניסה; טקסט שעדיין פתוח בעורך יש לשמור תחילה.</p><div className="button-row"><button className="secondary" onClick={exportDemo}><Download size={17} />ייצוא JSON</button><button className="secondary" onClick={() => fileInput.current?.click()}><Upload size={17} />ייבוא JSON</button></div>{cloudRef.current && <button className="text-button" onClick={() => { stopCloud(); setCloudStatus('השמירה מושהית'); setCloudError(''); setToken(''); setWorkspaceReady(false); setSettings(false); notify('יצאת מהמערכת. עבודה שטרם נשמרה נמצאת בזיכרון הלשונית בלבד.'); }}>יציאה מהמערכת</button>}</div><div className="settings-section"><button className="text-button danger" onClick={() => { setSettings(false); setReplacement({ state: initialState(), kind: 'reset' }); }}><RotateCcw size={17} />איפוס ההדגמה הבדיונית</button></div></Modal>}
    {replacement && <Modal title={replacement.kind === 'import' ? 'ייבוא הגיבוי הבדיוני' : 'איפוס ההדגמה'} onClose={() => setReplacement(null)}><p>הפעולה תחליף את מצב ההדגמה ותישלח לשמירה בשרת. אפשר לייצא את העבודה הנוכחית לפני ההחלפה.</p><p>יש להמשיך רק עם חומר בדיוני.</p>{hasUnsavedDocumentEdits() && <p role="alert">יש עריכה ישירה פתוחה. יש לשמור או לבטל אותה לפני החלפה; ייצוא JSON אינו כולל טקסט שעדיין פתוח בעורך.</p>}<div className="button-row"><button className="secondary" onClick={exportDemo}>ייצוא לפני החלפה</button><button className="primary" disabled={hasUnsavedDocumentEdits()} onClick={() => { if (hasUnsavedDocumentEdits()) return; adoptState(replacement.state); setReplacement(null); notify('מצב ההדגמה נטען בהצלחה.'); }}>אישור והחלפה</button><button className="text-button" onClick={() => setReplacement(null)}>ביטול</button></div></Modal>}
    <input ref={fileInput} type="file" className="sr-only" accept="application/json,.json" aria-label="ייבוא הדגמה בדיונית" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { const next = importState(await file.text()); setSettings(false); setReplacement({ state: next, kind: 'import' }); } catch (failure) { notify(failure instanceof Error ? failure.message : 'הקובץ אינו ייצוא תקין של הדמו.'); } }} />
    {welcomeOpen && !cloudChoice && <CaseWelcome state={state} selectedPatientId={patient.id} onSelect={beginCase} onClose={() => setWelcomeOpen(false)} onNewPatient={() => { setWelcomeOpen(false); setNewPatientOpen(true); }} />}
    {newPatientOpen && <NewPatient onCreate={openPatient} onClose={() => setNewPatientOpen(false)} />}
    {newSessionOpen && <Modal title="פתיחת פגישה חדשה" onClose={() => setNewSessionOpen(false)}>
      {unfinished ? <><p>התיעוד של פגישה {unfinished.number} עדיין לא הושלם. ממשיכים בו ושומרים את הרשומה לפני פתיחת הפגישה הבאה.</p>
        <button className="primary" onClick={() => { select({ patientId: patient.id, branchId: branch.id, sessionId: unfinished.id }); setNewSessionOpen(false); setPage('session'); }}>המשך תיעוד פגישה {unfinished.number}</button></>
        : <><p>פגישה {Math.max(...sessions.map(item => item.number), 0) + 1} עבור {patient.name}, בענף ״{branch.name}״.</p>
          {regularSchedule && <p className="muted small-copy">המועד הקבוע המתוכנן: {regularSchedule}. זהו תכנון שבועי, ולא תיעוד של מועד הפגישה הזו.</p>}
          <button className="primary" onClick={() => {
            const open = unfinishedSession(stateRef.current, patient.id, branch.id);
            if (open) { select({ patientId: patient.id, branchId: branch.id, sessionId: open.id }); setNewSessionOpen(false); setPage('session'); return; }
            const number = Math.max(...stateRef.current.sessions.filter(item => item.patientId === patient.id && item.branchId === branch.id).map(item => item.number), 0) + 1;
            const created = createSession(stateRef.current, patient.id, branch.id, number);
            replaceState(created.state); select({ ...selection, sessionId: created.session.id }); setNewSessionOpen(false); setPage('session');
          }}><Plus size={17} />פתיחת הפגישה</button></>}
    </Modal>}
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

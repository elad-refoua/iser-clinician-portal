import { z } from 'zod';
import type { Branch, ContextPacket, DocumentVersion, DraftResult, FieldUpdate, Goal, IntakeField, PortalState, Preference, PreferenceCancellation, Session, Source, TurnResult } from '../contracts';
import { emptyIntakeFields, renderIntake } from '../prompts/intake-schema';
import { renderIntakeReport } from './intake-report';
export { emptyIntakeFields, renderIntake, intakeFields, intakeSections, fieldStatusLabels } from '../prompts/intake-schema';
export { renderIntakeReport } from './intake-report';

const goals: Goal[] = ['note', 'formulation', 'intake', 'gold', 'supervision'];
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const distinct = (items: string[]) => [...new Set(items)];
const atOrBefore = (at: string, boundary: string) => Date.parse(at) <= Date.parse(boundary);
const latest = <T extends { createdAt: string }>(items: T[]) => [...items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).at(-1);
function sessionOf(state: PortalState, id: string): Session {
  const session = state.sessions.find(item => item.id === id);
  if (!session) throw new Error('הפגישה לא נמצאה.');
  return session;
}
function checkBranch(state: PortalState, patientId: string, branchId: string) {
  if (!state.patients.some(p => p.id === patientId && p.fictional) || !state.branches.some(b => b.id === branchId && b.patientId === patientId)) throw new Error('התיק או הרצף אינם תקינים.');
}
function checkRevision(state: PortalState, id: string, revision: number) {
  const session = sessionOf(state, id);
  if (session.revision !== revision) throw new Error('התיק נערך בזמן ההמתנה. התשובה לא החליפה את העריכה; אפשר להמשיך מהמצב המעודכן.');
  return session;
}
function updateSession(state: PortalState, session: Session): PortalState {
  return { ...state, sessions: state.sessions.map(item => item.id === session.id ? session : item) };
}
function invalidate(state: PortalState, patientId: string, branchId: string): PortalState {
  return { ...state, sessions: state.sessions.map(s => s.patientId === patientId && s.branchId === branchId ? { ...s, revision: s.revision + 1 } : s) };
}
function nextSession(state: PortalState, session: Session): Session | undefined {
  return state.sessions.filter(s => s.patientId === session.patientId && s.branchId === session.branchId && s.number > session.number).sort((a, b) => a.number - b.number)[0];
}
function assertCurrentSession(state: PortalState, session: Session) {
  if (nextSession(state, session)) throw new Error('זו פגישה היסטורית. כדי להמשיך עם העוזר יש לפתוח רצף חלופי מנקודה זו.');
}
export function temporalBoundary(state: PortalState, session: Session): string {
  const following = nextSession(state, session);
  const beforeNext = following ? new Date(Date.parse(following.startedAt) - 1).toISOString() : undefined;
  let boundary = now();
  if (session.closedAt) boundary = session.closedAt;
  else if (session.status === 'approved') {
    const ownTimes = [session.startedAt, ...session.messages.map(m => m.at),
      ...state.sources.filter(v => v.sessionId === session.id).map(v => v.recordedAt),
      ...state.versions.filter(v => v.sessionId === session.id).map(v => v.createdAt)]
      .filter(at => !beforeNext || Date.parse(at) <= Date.parse(beforeNext));
    boundary = new Date(Math.max(...ownTimes.map(Date.parse))).toISOString();
  }
  return beforeNext && Date.parse(beforeNext) < Date.parse(boundary) ? beforeNext : boundary;
}
function reopenNote(state: PortalState, sessionId: string | undefined): PortalState {
  return { ...state, sessions: state.sessions.map(s => s.id === sessionId
    ? { ...s, status: 'draft', ...(!nextSession(state, s) ? { closedAt: undefined } : {}) }
    : s) };
}
function scopeFor(state: PortalState, branchId: string, throughSession: number): ContextPacket['branchScope'] {
  const scopes: ContextPacket['branchScope'] = [];
  let current = state.branches.find(b => b.id === branchId);
  let limit = throughSession; let cutoff: string | undefined;
  while (current) {
    if (scopes.some(s => s.branchId === current!.id)) throw new Error('נמצא מעגל בין רצפים.');
    scopes.push({ branchId: current.id, throughSession: limit, ...(cutoff ? { cutoffAt: cutoff } : {}) });
    limit = Math.min(limit, current.forkSession ?? limit);
    if (current.cutoffAt) cutoff = cutoff && atOrBefore(cutoff, current.cutoffAt) ? cutoff : current.cutoffAt;
    current = current.parentId ? state.branches.find(b => b.id === current!.parentId) : undefined;
  }
  return scopes;
}
function inScope(item: { branchId: string; sessionNumber?: number }, scope: ContextPacket['branchScope']) {
  return scope.find(s => s.branchId === item.branchId && (item.sessionNumber === undefined || item.sessionNumber <= s.throughSession));
}
function preferencesAt(state: PortalState, patientId: string, branchId: string, through: number, asOf: string, sessionId?: string, allowUndated = true): Preference[] {
  const scope = scopeFor(state, branchId, through);
  const cancellations = new Set((state.preferenceCancellations ?? []).filter(event => {
    const owner = state.sessions.find(s => s.id === event.sessionId);
    const access = inScope({ branchId: event.branchId, sessionNumber: owner?.number }, scope);
    return event.patientId === patientId && owner?.patientId === patientId && owner.branchId === event.branchId && access
      && atOrBefore(event.recordedAt, asOf) && (!access.cutoffAt || atOrBefore(event.recordedAt, access.cutoffAt));
  }).map(event => event.preferenceId));
  return state.preferences.filter(p => {
    if (p.patientId !== patientId || !p.branchId || cancellations.has(p.id) || (p.scope === 'session' && p.sessionId !== sessionId)) return false;
    const origin = state.sessions.find(item => item.id === p.sessionId);
    const access = inScope({ branchId: p.branchId, sessionNumber: origin?.number }, scope);
    if (!access || (origin && (origin.patientId !== patientId || origin.branchId !== p.branchId))) return false;
    const recordedAt = p.recordedAt ?? (p.scope === 'session' ? origin?.startedAt : undefined);
    if (!recordedAt) return p.branchId === branchId && allowUndated;
    return atOrBefore(recordedAt, asOf) && (!access.cutoffAt || atOrBefore(recordedAt, access.cutoffAt));
  }).map(p => ({ ...p }));
}
function eligibleVersions(state: PortalState, patientId: string, branchId: string, through = 1000, asOf = now()) {
  const scope = scopeFor(state, branchId, through);
  return state.versions.filter(v => {
    const access = inScope(v, scope);
    return v.patientId === patientId && !v.proposal && !v.rejected && access && atOrBefore(v.createdAt, asOf) && (!access.cutoffAt || atOrBefore(v.createdAt, access.cutoffAt));
  });
}

export function createSession(state: PortalState, patientId: string, branchId: string, number: number): { state: PortalState; session: Session } {
  checkBranch(state, patientId, branchId);
  if (!Number.isInteger(number) || number < 1 || number > 1000) throw new Error('מספר פגישה חייב להיות בין 1 ל־1000.');
  const existing = state.sessions.find(s => s.patientId === patientId && s.branchId === branchId && s.number === number);
  if (existing) return { state, session: existing };
  const branch = state.branches.find(b => b.id === branchId)!;
  if (branch.parentId && number <= (branch.forkSession ?? 0)) throw new Error('ברצף חלופי מתחילים אחרי נקודת הפיצול.');
  const session: Session = { id: uid('session'), patientId, branchId, number, startedAt: now(), revision: 0, status: 'writing', messages: [], composer: '', questionCount: 0, intakeCount: 0, intakeRound: 0, intakeActive: false, skippedTopics: [], traces: [] };
  return { state: { ...state, sessions: [...state.sessions, session] }, session };
}

export function addUserMessage(state: PortalState, sessionId: string, text: string): PortalState {
  const session = sessionOf(state, sessionId); const clean = text.trim();
  if (!clean) return state;
  assertCurrentSession(state, session);
  if (clean.length > 16000) throw new Error('אפשר לשמור עד 16,000 תווים בהודעה אחת.');
  const at = now();
  const source: Source = { id: uid('source'), patientId: session.patientId, branchId: session.branchId, sessionId, sessionNumber: session.number, text: clean, recordedAt: at, kind: 'clinician' };
  return updateSession({ ...state, sources: [...state.sources, source] }, { ...session, closedAt: undefined, status: session.status === 'approved' ? 'draft' : session.status, revision: session.revision + 1, composer: '', messages: [...session.messages, { id: uid('message'), role: 'user', text: clean, sourceId: source.id, at }] });
}

export function currentVersion(state: PortalState, patientId: string, branchId: string, kind: Goal, sessionId?: string): DocumentVersion | undefined {
  return latest(eligibleVersions(state, patientId, branchId).filter(v => v.kind === kind && (kind !== 'note' || !sessionId || v.sessionId === sessionId)));
}

export function buildContext(state: PortalState, sessionId: string, stage?: ContextPacket['stage']): ContextPacket {
  const s = sessionOf(state, sessionId);
  const asOf = temporalBoundary(state, s);
  const scope = scopeFor(state, s.branchId, s.number);
  const sources = state.sources.filter(source => {
    const access = inScope(source, scope);
    if (source.patientId !== s.patientId || !access) return false;
    return atOrBefore(source.recordedAt, asOf) && (!access.cutoffAt || atOrBefore(source.recordedAt, access.cutoffAt));
  });
  const ids = new Set(sources.map(source => source.id));
  const eligible = eligibleVersions(state, s.patientId, s.branchId, s.number, asOf)
    .filter(v => v.sourceIds.every(id => ids.has(id)) && (!v.fields || v.fields.every(f => f.sourceIds.every(id => ids.has(id)))));
  const documents = goals.flatMap(kind => {
    const version = latest(eligible.filter(v => v.kind === kind && (kind !== 'note' || v.sessionId === s.id)));
    return version ? [{ kind, versionId: version.id, content: version.content, sourceIds: version.sourceIds, ...(version.fields ? { fields: structuredClone(version.fields) } : {}) }] : [];
  });
  const preferences = preferencesAt(state, s.patientId, s.branchId, s.number, asOf, s.id, !nextSession(state, s) && s.status !== 'approved');
  return { patientId: s.patientId, patientName: state.patients.find(p => p.id === s.patientId)!.name, branchId: s.branchId, sessionId: s.id, sessionNumber: s.number, baseRevision: s.revision, asOf, stage: stage ?? (s.intakeActive ? 'intake' : 'main'), questionCount: s.questionCount, intakeCount: s.intakeCount, intakeRound: s.intakeRound ?? 0, branchScope: scope, sources, documents, messages: structuredClone(s.messages.filter(m => atOrBefore(m.at, asOf))), skippedTopics: [...s.skippedTopics], preferences };
}

export function cancelPreference(state: PortalState, sessionId: string, preferenceId: string): PortalState {
  const session = sessionOf(state, sessionId);
  assertCurrentSession(state, session);
  if (!buildContext(state, sessionId).preferences.some(p => p.id === preferenceId)) throw new Error('ההעדפה אינה פעילה בפגישה וברצף האלה.');
  const event: PreferenceCancellation = { id: uid('preference-cancellation'), preferenceId, patientId: session.patientId, branchId: session.branchId, sessionId, recordedAt: now() };
  const changed = updateSession({ ...state, preferenceCancellations: [...(state.preferenceCancellations ?? []), event] }, { ...session, closedAt: undefined, status: session.status === 'approved' ? 'draft' : session.status });
  return invalidate(changed, session.patientId, session.branchId);
}

function mergeFields(base: IntakeField[], updates: FieldUpdate[]): IntakeField[] {
  const patches = new Map(updates.map(field => [field.id, field]));
  return base.map(field => ({ ...(patches.get(field.id) ?? field) }));
}
function checkUpdates(context: ContextPacket, updates: FieldUpdate[]) {
  const ids = new Set(context.sources.map(s => s.id));
  if (new Set(updates.map(f => f.id)).size !== updates.length || updates.some(f => f.id < 1 || f.id > 32 || !f.sourceIds.every(id => ids.has(id)) || (f.status !== 'unknown' && f.sourceIds.length === 0))) throw new Error('העדכון מכיל שדה או מקור שאינו שייך להקשר הנוכחי.');
}
function assistantVersion(state: PortalState, s: Session, context: ContextPacket, kind: Goal, content: string, sourceIds: string[], fields?: IntakeField[]): PortalState {
  const previous = state.versions.find(v => v.id === context.documents.find(d => d.kind === kind)?.versionId);
  if (previous?.content === content && JSON.stringify(previous.fields) === JSON.stringify(fields)) return state;
  const version: DocumentVersion = { id: uid('version'), patientId: s.patientId, branchId: s.branchId, kind, sessionId: s.id, sessionNumber: s.number, content, sourceIds: distinct(sourceIds), ...(fields ? { fields } : {}), createdAt: now(), author: 'assistant', approved: false, reason: `טיוטה שנוצרה בתיעוד פגישה ${s.number}`, ...(previous ? { baseVersionId: previous.id } : {}), ...(previous?.author === 'clinician' || previous?.approved && previous?.author === 'assistant' ? { proposal: true } : {}) };
  return { ...state, versions: [...state.versions, version] };
}
function intakeBase(state: PortalState, s: Session, context: ContextPacket) {
  const current = context.documents.find(d => d.kind === 'intake');
  const allowedIds = new Set(context.sources.map(source => source.id));
  const proposal = latest(state.versions.filter(v => v.patientId === s.patientId && v.branchId === s.branchId && v.sessionId === s.id && v.kind === 'intake' && v.proposal && !v.rejected && v.baseVersionId === current?.versionId && atOrBefore(v.createdAt, context.asOf) && v.sourceIds.every(id => allowedIds.has(id)) && v.fields?.every(f => f.sourceIds.every(id => allowedIds.has(id)))));
  return proposal?.fields ?? current?.fields ?? emptyIntakeFields();
}
export function applyTurn(state: PortalState, sessionId: string, baseRevision: number, result: TurnResult): PortalState {
  const s = checkRevision(state, sessionId, baseRevision); const context = buildContext(state, sessionId);
  assertCurrentSession(state, s);
  checkUpdates(context, result.fieldUpdates);
  if (result.action === 'question' && (s.intakeActive ? s.intakeCount >= 2 : s.questionCount >= 3)) throw new Error('הגענו למספר השאלות שנבחר. אפשר לעבור לטיוטה.');
  const preferences = result.preferenceUpdates.map(p => ({ ...p, id: uid('preference'), patientId: s.patientId, branchId: s.branchId, sessionId: s.id, recordedAt: now() }));
  let next = { ...state, preferences: [...state.preferences, ...preferences] };
  if (result.fieldUpdates.length) {
    const fields = mergeFields(intakeBase(state, s, context), result.fieldUpdates);
    next = assistantVersion(next, s, context, 'intake', renderIntakeReport(fields, [...context.preferences, ...preferences]), fields.flatMap(f => f.sourceIds), fields);
  }
  return updateSession(next, { ...s, revision: s.revision + 1, closedAt: undefined, status: result.action === 'question' ? 'asking' : 'draft', messages: [...s.messages, { id: uid('message'), role: 'assistant', text: result.utterance, at: now() }], questionCount: s.questionCount + (result.action === 'question' && !s.intakeActive ? 1 : 0), intakeCount: s.intakeCount + (result.action === 'question' && s.intakeActive ? 1 : 0) });
}
export function saveDraft(state: PortalState, sessionId: string, baseRevision: number, result: DraftResult): PortalState {
  const s = checkRevision(state, sessionId, baseRevision); const context = buildContext(state, sessionId, 'draft');
  assertCurrentSession(state, s);
  checkUpdates(context, result.fieldUpdates);
  if (result.documents.length !== 5 || new Set(result.documents.map(d => d.kind)).size !== 5) throw new Error('הטיוטה אינה כוללת את כל סוגי המסמכים.');
  const ids = new Set(context.sources.map(source => source.id));
  if (result.documents.some(d => !d.sourceIds.every(id => ids.has(id)))) throw new Error('נמצא מקור שאינו שייך להקשר הנוכחי.');
  const fields = mergeFields(intakeBase(state, s, context), result.fieldUpdates);
  let next = state;
  for (const doc of result.documents) next = assistantVersion(next, s, context, doc.kind, doc.kind === 'intake' ? `# אינטייק — עד פגישה ${s.number}\n\nמבנה הדוח מלא. מידע חסר נשאר גלוי.\n\n${renderIntakeReport(fields, context.preferences)}` : doc.content, doc.kind === 'intake' ? fields.flatMap(f => f.sourceIds) : doc.sourceIds, doc.kind === 'intake' ? fields : undefined);
  return updateSession(next, { ...s, revision: s.revision + 1, closedAt: undefined, status: 'draft', intakeActive: false });
}

export function editDocument(state: PortalState, patientId: string, branchId: string, kind: Goal, content: string, fields?: IntakeField[], sessionId?: string): PortalState {
  checkBranch(state, patientId, branchId);
  const session = sessionId ? sessionOf(state, sessionId) : undefined;
  if (session && (session.patientId !== patientId || session.branchId !== branchId)) throw new Error('המסמך שייך לתיק אחר.');
  if (kind === 'note' && !session) throw new Error('יש לבחור פגישה לעריכת רשומה.');
  const previous = currentVersion(state, patientId, branchId, kind, sessionId); const at = now(); const sourceId = uid('manual');
  const normalized = fields?.map(field => {
    const old = previous?.fields?.find(f => f.id === field.id);
    return JSON.stringify(old) === JSON.stringify(field) ? { ...field } : { ...field, sourceIds: [sourceId] };
  });
  const rawContent = kind === 'intake' && normalized ? renderIntake(normalized) : content;
  const reportSessionId = sessionId ?? state.sessions.filter(s => s.patientId === patientId && s.branchId === branchId).sort((a, b) => b.number - a.number)[0]?.id;
  const rendered = kind === 'intake' && normalized ? renderIntakeReport(normalized, preferencesAt(state, patientId, branchId, 1000, at, reportSessionId)) : content;
  const source: Source = { id: sourceId, patientId, branchId, ...(session ? { sessionId: session.id, sessionNumber: session.number } : {}), text: `עריכה ישירה של המטפל — ${kind}\n\n${rawContent}`, recordedAt: at, kind: 'manual' };
  const version: DocumentVersion = { id: uid('version'), patientId, branchId, kind, ...(session ? { sessionId: session.id, sessionNumber: session.number } : {}), content: rendered, ...(normalized ? { fields: normalized } : {}), sourceIds: distinct([...(normalized ? normalized.flatMap(f => f.sourceIds) : []), sourceId]), createdAt: at, author: 'clinician', reason: 'עריכה ישירה של המטפל', approved: false, ...(previous ? { baseVersionId: previous.id } : {}) };
  const edited = invalidate({ ...state, sources: [...state.sources, source], versions: [...state.versions, version] }, patientId, branchId);
  return kind === 'note' && session ? reopenNote(edited, session.id) : edited;
}

export function restoreVersion(state: PortalState, versionId: string): PortalState {
  const original = state.versions.find(v => v.id === versionId && !v.proposal);
  if (!original) throw new Error('הגרסה לא נמצאה.');
  const current = currentVersion(state, original.patientId, original.branchId, original.kind, original.sessionId);
  const restored: DocumentVersion = { ...structuredClone(original), ...(original.kind !== 'note' && current ? { sessionId: current.sessionId, sessionNumber: current.sessionNumber } : {}), id: uid('version'), createdAt: now(), author: 'clinician', approved: false, proposal: false, rejected: false, baseVersionId: current?.id, reason: `שחזור מלא של גרסה ${original.id}` };
  const next = invalidate({ ...state, versions: [...state.versions, restored] }, original.patientId, original.branchId);
  return original.kind === 'note' ? reopenNote(next, original.sessionId) : next;
}
export function acceptProposal(state: PortalState, versionId: string): PortalState {
  const proposal = state.versions.find(v => v.id === versionId && v.proposal && !v.rejected);
  if (!proposal) throw new Error('ההצעה אינה זמינה.');
  const current = currentVersion(state, proposal.patientId, proposal.branchId, proposal.kind, proposal.kind === 'note' ? proposal.sessionId : undefined);
  if (current?.id !== proposal.baseVersionId) throw new Error('המסמך נערך מאז יצירת ההצעה. יש להכין הצעה מול הגרסה העדכנית.');
  const accepted: DocumentVersion = { ...structuredClone(proposal), id: uid('version'), createdAt: now(), author: 'clinician', approved: false, proposal: false, rejected: false, reason: 'המטפל קיבל הצעת עדכון לאחר השוואה' };
  const next = invalidate({ ...state, versions: [...state.versions.map(v => v.id === versionId ? { ...v, rejected: true } : v), accepted] }, proposal.patientId, proposal.branchId);
  return proposal.kind === 'note' ? reopenNote(next, proposal.sessionId) : next;
}
export function rejectProposal(state: PortalState, versionId: string): PortalState {
  return { ...state, versions: state.versions.map(v => v.id === versionId && v.proposal ? { ...v, rejected: true } : v) };
}
export function approveSession(state: PortalState, sessionId: string): PortalState {
  const s = sessionOf(state, sessionId); const at = now();
  const latestDocs = goals.map(kind => currentVersion(state, s.patientId, s.branchId, kind, kind === 'note' ? sessionId : undefined)).filter((v): v is DocumentVersion => Boolean(v && v.sessionId === sessionId));
  if (!latestDocs.some(v => v.kind === 'note')) throw new Error('יש ליצור או לערוך רשומה לפני האישור.');
  const approved = latestDocs.map(v => ({ ...structuredClone(v), id: uid('version'), createdAt: at, approved: true, author: 'clinician' as const, baseVersionId: v.id, reason: 'אישור המטפל לפגישת התיעוד' }));
  return updateSession({ ...state, versions: [...state.versions, ...approved] }, { ...s, revision: s.revision + 1, status: 'approved', closedAt: s.closedAt && nextSession(state, s) ? s.closedAt : at, intakeActive: false });
}
export function forkBranch(state: PortalState, sessionId: string, name: string): { state: PortalState; branch: Branch } {
  const s = sessionOf(state, sessionId);
  const cutoffAt = temporalBoundary(state, s);
  const branch: Branch = { id: uid('branch'), patientId: s.patientId, name: name.trim() || `רצף חלופי אחרי פגישה ${s.number}`, parentId: s.branchId, forkSession: s.number, cutoffAt };
  return { state: { ...state, branches: [...state.branches, branch] }, branch };
}

const identifier = z.string().min(1).max(160);
const date = z.string().datetime({ offset: true });
const kind = z.enum(['note', 'formulation', 'intake', 'gold', 'supervision']);
const fieldSchema = z.object({ id: z.number().int().min(1).max(32), value: z.string().max(30000), status: z.enum(['documented', 'partial', 'unknown', 'not_assessed', 'not_recalled', 'conflict', 'not_applicable']), sourceIds: z.array(identifier).max(200), remaining: z.string().max(5000).optional() }).strict();
const archiveSchema = z.object({
  schemaVersion: z.literal(1),
  patients: z.array(z.object({ id: identifier, name: z.string().max(200), age: z.number().int().min(18).max(120), description: z.string().max(2000), fictional: z.literal(true) }).strict()).min(1).max(50),
  branches: z.array(z.object({ id: identifier, patientId: identifier, name: z.string().max(200), parentId: identifier.optional(), forkSession: z.number().int().min(1).max(1000).optional(), cutoffAt: date.optional() }).strict()).max(300),
  sources: z.array(z.object({ id: identifier, patientId: identifier, branchId: identifier, sessionId: identifier.optional(), sessionNumber: z.number().int().min(1).max(1000).optional(), text: z.string().max(100000), recordedAt: date, kind: z.enum(['clinician', 'manual', 'seed']) }).strict()).max(10000),
  versions: z.array(z.object({ id: identifier, patientId: identifier, branchId: identifier, kind, sessionId: identifier.optional(), sessionNumber: z.number().int().min(1).max(1000).optional(), content: z.string().max(100000), fields: z.array(fieldSchema).max(32).optional(), sourceIds: z.array(identifier).max(10000), createdAt: date, author: z.enum(['clinician', 'assistant', 'seed']), reason: z.string().max(2000), baseVersionId: identifier.optional(), approved: z.boolean(), proposal: z.boolean().optional(), rejected: z.boolean().optional() }).strict()).max(10000),
  preferences: z.array(z.object({ id: identifier, topic: z.string().max(200), goal: kind.optional(), action: z.enum(['less', 'block', 'exclude']), scope: z.enum(['session', 'patient']), sessionId: identifier.optional(), patientId: identifier.optional(), branchId: identifier.optional(), recordedAt: date.optional() }).strict()).max(1000),
  preferenceCancellations: z.array(z.object({ id: identifier, preferenceId: identifier, patientId: identifier, branchId: identifier, sessionId: identifier, recordedAt: date }).strict()).max(1000).optional(),
  sessions: z.array(z.object({ id: identifier, patientId: identifier, branchId: identifier, number: z.number().int().min(1).max(1000), startedAt: date, closedAt: date.optional(), revision: z.number().int().min(0), status: z.enum(['writing', 'asking', 'draft', 'approved']), messages: z.array(z.object({ id: identifier, role: z.enum(['user', 'assistant']), text: z.string().max(100000), sourceId: identifier.optional(), at: date }).strict()).max(500), composer: z.string().max(100000), questionCount: z.number().int().min(0).max(3), intakeCount: z.number().int().min(0).max(2), intakeRound: z.number().int().min(0).max(10).optional(), intakeActive: z.boolean(), skippedTopics: z.array(z.string().max(200)).max(100), traces: z.array(z.unknown()).max(200) }).strict()).max(2000),
}).strict();

export function importState(json: string): PortalState {
  if (json.length > 25_000_000) throw new Error('קובץ הגיבוי גדול מדי.');
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('זה אינו קובץ JSON תקין.'); }
  const parsed = archiveSchema.safeParse(raw);
  if (!parsed.success) throw new Error('מבנה הגיבוי אינו תואם לגרסה זו, או שהמידע אינו מסומן כבדיוני.');
  const state = parsed.data as PortalState;
  for (const list of [state.patients, state.branches, state.sessions, state.sources, state.versions, state.preferences, state.preferenceCancellations ?? []]) if (new Set(list.map(item => item.id)).size !== list.length) throw new Error('יש מזהים כפולים בגיבוי.');
  for (const b of state.branches) {
    checkBranch(state, b.patientId, b.id);
    if (b.parentId && !state.branches.some(parent => parent.id === b.parentId && parent.patientId === b.patientId)) throw new Error('רצף האב אינו שייך לתיק.');
    if (b.parentId && (!b.cutoffAt || !state.sessions.some(s => s.branchId === b.parentId && s.number === b.forkSession))) throw new Error('נקודת הפיצול אינה תקינה.');
    scopeFor(state, b.id, 1000);
  }
  for (const p of state.patients) {
    const rootBranch = state.branches.find(b => b.patientId === p.id && !b.parentId);
    if (!rootBranch || !state.sessions.some(s => s.patientId === p.id && s.branchId === rootBranch.id)) throw new Error('לתיק חסר רצף מקורי עם פגישות.');
  }
  for (const item of [...state.sources, ...state.versions, ...state.sessions]) checkBranch(state, item.patientId, item.branchId);
  if (new Set(state.sessions.map(s => `${s.branchId}:${s.number}`)).size !== state.sessions.length) throw new Error('מספר פגישה כפול ברצף.');
  for (const s of state.sessions) {
    const b = state.branches.find(b => b.id === s.branchId)!;
    if ((b.parentId && s.number <= b.forkSession!) || (s.closedAt && Date.parse(s.closedAt) < Date.parse(s.startedAt))) throw new Error('זמן הפגישה או מיקומה ברצף אינם תקינים.');
  }
  for (const item of [...state.sources, ...state.versions]) {
    const owner = state.sessions.find(s => s.id === item.sessionId);
    if (item.sessionId ? !owner || owner.patientId !== item.patientId || owner.branchId !== item.branchId || owner.number !== item.sessionNumber : item.sessionNumber !== undefined) throw new Error('שיוך המקור או המסמך לפגישה אינו תקין.');
  }
  const sourceAllowed = (source: Source, patientId: string, scope: ContextPacket['branchScope'], at: string) => {
    const access = inScope(source, scope);
    return source.patientId === patientId && access && Date.parse(source.recordedAt) <= Date.parse(at) && (!access.cutoffAt || Date.parse(source.recordedAt) <= Date.parse(access.cutoffAt));
  };
  for (const v of state.versions) {
    const scope = scopeFor(state, v.branchId, v.sessionNumber ?? 1000);
    if ([...v.sourceIds, ...(v.fields?.flatMap(f => f.sourceIds) ?? [])].some(id => !state.sources.some(s => s.id === id && sourceAllowed(s, v.patientId, scope, v.createdAt)))) throw new Error('מקור חסר או מחוץ לתיק, לרצף או לזמן המותרים בגיבוי.');
    if (v.fields && new Set(v.fields.map(f => f.id)).size !== v.fields.length) throw new Error('שדות אינטייק כפולים בגיבוי.');
    if (v.baseVersionId && !state.versions.some(base => base.id === v.baseVersionId && base.patientId === v.patientId && base.kind === v.kind && inScope(base, scope) && Date.parse(base.createdAt) <= Date.parse(v.createdAt) && (!inScope(base, scope)?.cutoffAt || Date.parse(base.createdAt) <= Date.parse(inScope(base, scope)!.cutoffAt!)) && (v.kind !== 'note' || v.sessionId === base.sessionId))) throw new Error('גרסת המקור אינה תקינה.');
  }
  for (const p of state.preferences) {
    const owner = state.sessions.find(s => s.id === p.sessionId);
    if (!p.patientId || !p.branchId) throw new Error('להעדפה חסר שיוך לתיק ולרצף.');
    checkBranch(state, p.patientId, p.branchId);
    if ((p.scope === 'session' && !owner) || (p.sessionId && (!owner || owner.patientId !== p.patientId || owner.branchId !== p.branchId))) throw new Error('שיוך ההעדפה לפגישה אינו תקין.');
  }
  for (const event of state.preferenceCancellations ?? []) {
    const owner = state.sessions.find(s => s.id === event.sessionId);
    const preference = state.preferences.find(p => p.id === event.preferenceId);
    if (!owner || owner.patientId !== event.patientId || owner.branchId !== event.branchId || !preference || preference.patientId !== event.patientId || !preference.branchId || !atOrBefore(owner.startedAt, event.recordedAt)) throw new Error('שיוך ביטול ההעדפה אינו תקין.');
    const origin = state.sessions.find(s => s.id === preference.sessionId);
    const access = inScope({ branchId: preference.branchId, sessionNumber: origin?.number }, scopeFor(state, event.branchId, owner.number));
    const recordedAt = preference.recordedAt ?? origin?.startedAt;
    if (!access || (preference.scope === 'session' && preference.sessionId !== owner.id) || (recordedAt && (!atOrBefore(recordedAt, event.recordedAt) || (access.cutoffAt && !atOrBefore(recordedAt, access.cutoffAt))))) throw new Error('ביטול ההעדפה מחוץ לרצף או לזמן המותרים.');
  }
  for (const s of state.sessions) for (const message of s.messages) if (message.sourceId && !state.sources.some(source => source.id === message.sourceId && source.patientId === s.patientId && source.branchId === s.branchId && source.sessionId === s.id && source.text === message.text)) throw new Error('הודעה אינה תואמת למקור השמור.');
  // Traces are diagnostic snapshots, never executable. Validate their structure before the UI reads them.
  const traceDocument = z.object({ kind, versionId: identifier, content: z.string().max(100000), sourceIds: z.array(identifier).max(10000), fields: z.array(fieldSchema).max(32).optional() }).strict();
  const preferenceUpdate = z.object({ topic: z.string().max(200), goal: kind.optional(), action: z.enum(['less', 'block', 'exclude']), scope: z.enum(['session', 'patient']) }).strict();
  const traceSchema = z.object({ id: identifier, at: date, mode: z.enum(['prepared', 'live']), model: z.string().max(200), promptVersion: z.string().max(200), prompt: z.string().max(100000), context: z.object({
    patientId: identifier, patientName: z.string().max(200), branchId: identifier, sessionId: identifier, sessionNumber: z.number().int().min(1).max(1000),
    baseRevision: z.number().int().min(0), asOf: date, stage: z.enum(['main', 'intake', 'draft']), questionCount: z.number().int().min(0).max(3), intakeCount: z.number().int().min(0).max(2), intakeRound: z.number().int().min(0).max(10).optional(),
    sources: archiveSchema.shape.sources, documents: z.array(traceDocument).max(5), messages: archiveSchema.shape.sessions.element.shape.messages, preferences: archiveSchema.shape.preferences,
    skippedTopics: z.array(z.string().max(200)).max(100), branchScope: z.array(z.object({ branchId: identifier, throughSession: z.number().int().min(1).max(1000), cutoffAt: date.optional() }).strict()).min(1).max(300),
  }).strict(), response: z.union([
    z.object({ action: z.enum(['question', 'draft']), utterance: z.string().max(100000), topic: z.string().max(200), rationale: z.string().max(10000), fieldUpdates: z.array(fieldSchema).max(32), preferenceUpdates: z.array(preferenceUpdate).max(1000) }).strict(),
    z.object({ documents: z.array(z.object({ kind, content: z.string().max(100000), sourceIds: z.array(identifier).max(10000) }).strict()).length(5), fieldUpdates: z.array(fieldSchema).max(32), rationale: z.string().max(10000) }).strict(),
  ]), elapsedMs: z.number().min(0), usage: z.object({ input: z.number().min(0), output: z.number().min(0), cost: z.number().min(0).optional() }).strict().optional() }).strict();
  for (const s of state.sessions) for (const trace of s.traces) {
    const check = traceSchema.safeParse(trace);
    if (!check.success) throw new Error('רישום הפעולה בגיבוי אינו תקין.');
    const context = check.data.context;
    const scope = scopeFor(state, s.branchId, s.number);
    const ids = new Set(context.sources.map(source => source.id));
    const validFields = (fields: IntakeField[]) => new Set(fields.map(f => f.id)).size === fields.length && fields.every(f => f.sourceIds.every(id => ids.has(id)));
    if (context.patientId !== s.patientId || context.branchId !== s.branchId || context.sessionId !== s.id || context.sessionNumber !== s.number || JSON.stringify(context.branchScope) !== JSON.stringify(scope)
      || ids.size !== context.sources.length || new Set(context.documents.map(d => d.kind)).size !== context.documents.length
      || context.sources.some(source => !sourceAllowed(source, s.patientId, scope, context.asOf) || !state.sources.some(saved => saved.id === source.id && JSON.stringify(saved) === JSON.stringify(source)))
      || context.documents.some(doc => !doc.sourceIds.every(id => ids.has(id)) || (doc.fields && !validFields(doc.fields)) || !state.versions.some(v => {
        const access = inScope(v, scope);
        return v.id === doc.versionId && v.patientId === s.patientId && v.kind === doc.kind && v.content === doc.content && JSON.stringify(v.fields) === JSON.stringify(doc.fields) && access && atOrBefore(v.createdAt, context.asOf) && (!access.cutoffAt || atOrBefore(v.createdAt, access.cutoffAt));
      }))
      || context.messages.some(m => m.sourceId && !context.sources.some(source => source.id === m.sourceId && source.sessionId === s.id && source.text === m.text))
      || context.preferences.some(p => {
        const origin = state.sessions.find(item => item.id === p.sessionId);
        const access = p.branchId ? inScope({ branchId: p.branchId, sessionNumber: origin?.number }, scope) : undefined;
        return p.patientId !== s.patientId || !access || (p.scope === 'session' && p.sessionId !== s.id) || (p.recordedAt && (!atOrBefore(p.recordedAt, context.asOf) || (access.cutoffAt && !atOrBefore(p.recordedAt, access.cutoffAt))));
      }) || !validFields(check.data.response.fieldUpdates)
      || ('documents' in check.data.response && (new Set(check.data.response.documents.map(d => d.kind)).size !== 5 || check.data.response.documents.some(d => d.sourceIds.some(id => !ids.has(id)))))) throw new Error('רישום הפעולה בגיבוי אינו תקין.');
  }
  return state;
}
export function exportState(state: PortalState): string { return JSON.stringify(state, null, 2); }

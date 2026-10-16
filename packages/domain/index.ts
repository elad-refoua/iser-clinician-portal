import { z } from 'zod';
import type { Branch, ContextPacket, DocumentVersion, DraftFollowUp, DraftResult, FieldUpdate, Goal, IntakeField, Patient, PendingDraft, PortalState, Preference, PreferenceCancellation, Session, Source, TurnResult } from '../contracts';
import { TEXT_LIMITS } from '../contracts/index.js';
import { emptyIntakeFields, renderIntake } from '../prompts/intake-schema.js';
import { renderIntakeReport } from './intake-report.js';
import { intakeCompletionFocus, intakeReadiness, isCanonicalIntakeCompletionFocus } from './intake-readiness.js';
export { emptyIntakeFields, renderIntake, intakeFields, intakeSections, fieldStatusLabels } from '../prompts/intake-schema.js';
export { renderIntakeReport } from './intake-report.js';

const goals: Goal[] = ['note', 'formulation', 'intake', 'gold', 'supervision'];
const archiveLimits = { patients: 50, branches: 300, sessions: 2000, sources: 10000 };
const patientNameSchema = z.string().trim().min(1, 'יש להזין שם תצוגה או קוד לתיק.').max(200, 'שם התצוגה או הקוד יכול להכיל עד 200 תווים.');
const patientScheduleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'יש להזין שעה תקינה בפורמט HH:mm.').optional(),
}).strict();
const newPatientSchema = z.object({ name: patientNameSchema, schedule: patientScheduleSchema.optional() }).strict();
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
function reopenDocumentSession(state: PortalState, version: DocumentVersion): PortalState {
  const session = state.sessions.find(item => item.id === version.sessionId);
  return version.kind === 'note' || (version.kind === 'intake' && session && !nextSession(state, session))
    ? reopenNote(state, version.sessionId) : state;
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

export function createPatient(state: PortalState, input: Pick<Patient, 'name' | 'schedule'>): { state: PortalState; patient: Patient; branch: Branch; session: Session } {
  const parsed = newPatientSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  if (state.patients.length >= archiveLimits.patients) throw new Error('אפשר לשמור עד 50 תיקים בהדגמה.');
  if (state.branches.length >= archiveLimits.branches || state.sessions.length >= archiveLimits.sessions || state.sources.length >= archiveLimits.sources) throw new Error('האחסון הגיע למגבלת ההדגמה. יש לייצא גיבוי לפני פתיחת תיק נוסף.');
  const patient: Patient = { id: uid('patient'), ...parsed.data, description: '', fictional: true };
  const branch: Branch = { id: uid('branch'), patientId: patient.id, name: 'הרצף המקורי הבדיוני' };
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const schedule = [patient.schedule?.dayOfWeek !== undefined ? `יום ${days[patient.schedule.dayOfWeek]}` : '', patient.schedule?.time ? `שעה ${patient.schedule.time}` : ''].filter(Boolean).join(', ');
  const source: Source = { id: uid('manual'), patientId: patient.id, branchId: branch.id, kind: 'manual', recordedAt: now(),
    text: `פרטי פתיחת תיק הדגמה — מידע מנהלי שהוזן על ידי המטפל.\nשם תצוגה או קוד: ${patient.name}${schedule ? `\nמועד שבועי מתוכנן: ${schedule}. המועד הוא תכנון קבוע בלבד ואינו תיעוד של פגישה שהתקיימה.` : ''}` };
  const next = { ...state, patients: [...state.patients, patient], branches: [...state.branches, branch], sources: [...state.sources, source] };
  const created = createSession(next, patient.id, branch.id, 1);
  return { ...created, patient, branch };
}

export function createSession(state: PortalState, patientId: string, branchId: string, number: number): { state: PortalState; session: Session } {
  checkBranch(state, patientId, branchId);
  if (!Number.isInteger(number) || number < 1 || number > 1000) throw new Error('מספר פגישה חייב להיות בין 1 ל־1000.');
  const existing = state.sessions.find(s => s.patientId === patientId && s.branchId === branchId && s.number === number);
  if (existing) return { state, session: existing };
  if (state.sessions.length >= archiveLimits.sessions) throw new Error('הגענו למגבלת הפגישות בהדגמה. יש לייצא גיבוי לפני המשך העבודה.');
  const branch = state.branches.find(b => b.id === branchId)!;
  if (branch.parentId && number <= (branch.forkSession ?? 0)) throw new Error('ברצף חלופי מתחילים אחרי נקודת הפיצול.');
  const session: Session = { id: uid('session'), patientId, branchId, number, startedAt: now(), revision: 0, status: 'writing', messages: [], composer: '', questionCount: 0, intakeCount: 0, intakeRound: 0, intakeActive: false, skippedTopics: [], traces: [] };
  return { state: { ...state, sessions: [...state.sessions, session] }, session };
}

export function addUserMessage(state: PortalState, sessionId: string, text: string): PortalState {
  const session = sessionOf(state, sessionId); const clean = text.trim();
  if (!clean) return state;
  assertCurrentSession(state, session);
  if (clean.length > TEXT_LIMITS.message) throw new Error('אפשר לשמור עד 16,000 תווים בהודעה אחת.');
  if (state.sources.length >= archiveLimits.sources || session.messages.length >= 500) throw new Error('הגענו למגבלת המקורות או ההודעות בהדגמה. יש לייצא גיבוי לפני המשך העבודה.');
  const at = now();
  const source: Source = { id: uid('source'), patientId: session.patientId, branchId: session.branchId, sessionId, sessionNumber: session.number, text: clean, recordedAt: at, kind: 'clinician' };
  return updateSession({ ...state, sources: [...state.sources, source] }, { ...session, closedAt: undefined, status: session.status === 'approved' ? 'draft' : session.status, revision: session.revision + 1, composer: '', messages: [...session.messages, { id: uid('message'), role: 'user', text: clean, sourceId: source.id, at }] });
}

export function currentVersion(state: PortalState, patientId: string, branchId: string, kind: Goal, sessionId?: string): DocumentVersion | undefined {
  return latest(eligibleVersions(state, patientId, branchId).filter(v => v.kind === kind && (kind !== 'note' || !sessionId || v.sessionId === sessionId)));
}

export function documentHistory(state: PortalState, patientId: string, branchId: string, kind: Goal, sessionId?: string): DocumentVersion[] {
  return eligibleVersions(state, patientId, branchId).filter(version => version.kind === kind && (kind !== 'note' || version.sessionId === sessionId));
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
    return version ? [{ kind, versionId: version.id, content: version.content, sourceIds: version.sourceIds, author: version.author, approved: version.approved, createdAt: version.createdAt, reason: version.reason, ...(version.fields ? { fields: structuredClone(version.fields) } : {}) }] : [];
  });
  const preferences = preferencesAt(state, s.patientId, s.branchId, s.number, asOf, s.id, !nextSession(state, s) && s.status !== 'approved');
  const pending = (s.pendingFields ?? []).filter(f => f.sourceIds.every(id => ids.has(id)));
  const workingDraft = s.pendingDraft && atOrBefore(s.pendingDraft.createdAt, asOf)
    && s.pendingDraft.result.documents.every(d => d.sourceIds.every(id => ids.has(id)))
    && s.pendingDraft.result.fieldUpdates.every(f => f.sourceIds.every(id => ids.has(id))) ? structuredClone(s.pendingDraft.result) : undefined;
  return { patientId: s.patientId, patientName: state.patients.find(p => p.id === s.patientId)!.name, branchId: s.branchId, sessionId: s.id, sessionNumber: s.number, baseRevision: s.revision, asOf, stage: stage ?? (s.intakeActive ? 'intake' : 'main'), questionCount: s.questionCount, intakeCount: s.intakeCount, intakeRound: s.intakeRound ?? 0, branchScope: scope, sources, documents, messages: structuredClone(s.messages.filter(m => atOrBefore(m.at, asOf))), skippedTopics: [...s.skippedTopics], preferences,
    ...(s.focusGoal ? { focusGoal: s.focusGoal } : {}), ...(s.focusSelection ? { focusSelection: structuredClone(s.focusSelection) } : {}), ...(workingDraft ? { workingDraft, workingDraftMetadata: {
      draftId: s.pendingDraft!.id, createdAt: s.pendingDraft!.createdAt, reviewRevision: s.pendingDraft!.reviewRevision, baseVersionIds: structuredClone(s.pendingDraft!.baseVersionIds), derivative: true as const,
      stale: Boolean(nextSession(state, s) || s.pendingDraft!.reviewRevision !== s.revision || !s.pendingDraft!.preferenceSnapshot
        || preferenceSignature(s.pendingDraft!.preferenceSnapshot) !== preferenceSignature(preferences)
        || goals.some(goal => currentVersion(state, s.patientId, s.branchId, goal, goal === 'note' ? s.id : undefined)?.id !== s.pendingDraft!.baseVersionIds[goal])),
    } } : {}),
    ...(pending.length ? { pendingIntakeFields: mergeFields(documents.find(d => d.kind === 'intake')?.fields ?? emptyIntakeFields(), pending) } : {}) };
}

function compactIntakeText(content: string, fields: IntakeField[] | undefined, preferences: Preference[]): string {
  if (!fields || fields.length !== 32 || new Set(fields.map(field => field.id)).size !== 32) return content;
  // Remove only an exact renderer-produced suffix. Any independently authored text stays.
  for (const rendered of [renderIntake(fields), renderIntakeReport(fields, preferences)]) {
    if (content.endsWith(rendered)) return `${content.slice(0, -rendered.length)}פרטי האינטייק המלאים, מצבם ומקורותיהם מופיעים בשדות המובנים בחבילת ההקשר.`;
  }
  return content;
}

/** A lossless request projection: source text and stored records are never changed. */
export function compactModelContext(context: ContextPacket): ContextPacket {
  const compact = structuredClone(context);
  compact.documents = compact.documents.map(document => document.kind === 'intake'
    ? { ...document, content: compactIntakeText(document.content, document.fields, compact.preferences) } : document);
  if (compact.workingDraft) {
    const fields = compact.pendingIntakeFields ?? compact.documents.find(document => document.kind === 'intake')?.fields;
    compact.workingDraft.documents = compact.workingDraft.documents.map(document => document.kind === 'intake'
      ? { ...document, content: compactIntakeText(document.content, fields, compact.preferences) } : document);
    if (compact.pendingIntakeFields) {
      const sameField = (left: IntakeField, right: IntakeField) => left.id === right.id && left.value === right.value && left.status === right.status
        && (left.remaining ?? '') === (right.remaining ?? '') && JSON.stringify(left.sourceIds) === JSON.stringify(right.sourceIds);
      compact.workingDraft.fieldUpdates = compact.workingDraft.fieldUpdates.filter(update => !compact.pendingIntakeFields!.some(field => sameField(field, update)));
    }
  }
  return compact;
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
  if (new Set(updates.map(f => f.id)).size !== updates.length || updates.some(f => !Number.isInteger(f.id) || f.id < 1 || f.id > 32 || new Set(f.sourceIds).size !== f.sourceIds.length || !f.sourceIds.every(id => ids.has(id)) || (f.status !== 'unknown' && f.sourceIds.length === 0) || (f.status === 'unknown' && f.value.trim()))) throw new Error('העדכון מכיל שדה או מקור שאינו שייך להקשר הנוכחי.');
}
function accumulateUpdates(previous: FieldUpdate[], updates: FieldUpdate[]): FieldUpdate[] {
  const fields = new Map(previous.map(field => [field.id, structuredClone(field)]));
  for (const field of updates) fields.set(field.id, structuredClone(field));
  return [...fields.values()].sort((a, b) => a.id - b.id);
}
function clearPendingFields(state: PortalState, patientId: string, branchId: string, fieldIds: Set<number>): PortalState {
  return { ...state, sessions: state.sessions.map(s => s.patientId === patientId && s.branchId === branchId && s.pendingFields
    ? { ...s, pendingFields: s.pendingFields.filter(field => !fieldIds.has(field.id)) } : s) };
}
function applyPreferenceUpdates(state: PortalState, session: Session, updates: NonNullable<DraftResult['preferenceUpdates']>): PortalState {
  const checked = z.array(preferenceUpdateSchema).max(10).safeParse(updates);
  if (!checked.success) throw new Error('העדפות התיעוד אינן תקינות.');
  const existing = preferencesAt(state, session.patientId, session.branchId, session.number, now(), session.id);
  const additions: Preference[] = [];
  for (const preference of checked.data) {
    if ([...existing, ...additions].some(p => p.topic === preference.topic && p.goal === preference.goal && p.action === preference.action && p.scope === preference.scope)) continue;
    additions.push({ ...preference, id: uid('preference'), patientId: session.patientId, branchId: session.branchId, sessionId: session.id, recordedAt: now() });
  }
  if (state.preferences.length + additions.length > 1000) throw new Error('הגענו למגבלת ההעדפות בהדגמה. יש לייצא גיבוי לפני המשך העבודה.');
  return { ...state, preferences: [...state.preferences, ...additions] };
}
function preferenceSignature(preferences: Preference[]) {
  return JSON.stringify([...preferences].sort((a, b) => a.id.localeCompare(b.id)).map(p => [p.id, p.topic, p.goal ?? null, p.action, p.scope, p.sessionId ?? null, p.patientId ?? null, p.branchId ?? null, p.recordedAt ?? null]));
}
function checkDraft(context: ContextPacket, result: DraftResult) {
  checkUpdates(context, result.fieldUpdates);
  if (result.documents.length !== 5 || new Set(result.documents.map(d => d.kind)).size !== 5 || result.documents.some(d => !goals.includes(d.kind))) throw new Error('הטיוטה אינה כוללת את כל סוגי המסמכים.');
  const ids = new Set(context.sources.map(source => source.id));
  if (result.documents.some(d => new Set(d.sourceIds).size !== d.sourceIds.length || !d.sourceIds.every(id => ids.has(id)))) throw new Error('נמצא מקור שאינו שייך להקשר הנוכחי.');
}
export function startExpansion(state: PortalState, sessionId: string, goal: Goal, selection?: DraftFollowUp): PortalState {
  const s = sessionOf(state, sessionId);
  assertCurrentSession(state, s);
  if (!goals.includes(goal)) throw new Error('נושא ההרחבה אינו מוכר.');
  if (selection && (selection.goal !== goal || selection.kind !== 'expand' || !s.pendingDraft?.result.followUps?.some(item => JSON.stringify(item) === JSON.stringify(selection)))) throw new Error('הצעת ההרחבה אינה שייכת לסיכום הנוכחי.');
  if ((s.intakeRound ?? 0) >= 10) throw new Error('הגענו למספר ההרחבות לפגישה. אפשר לערוך את המסמכים ישירות.');
  return updateSession(state, { ...s, revision: s.revision + 1, closedAt: undefined, status: 'asking', intakeActive: true, focusGoal: goal, focusSelection: selection ? structuredClone(selection) : undefined, intakeCount: 0, intakeRound: (s.intakeRound ?? 0) + 1 });
}
/** Explicit panel choice; derives the focus afresh instead of trusting a stale UI suggestion. */
export function startIntakeCompletion(state: PortalState, sessionId: string, fieldId: number, expectedRevision: number): PortalState {
  const session = checkRevision(state, sessionId, expectedRevision);
  assertCurrentSession(state, session);
  const readiness = intakeReadiness(buildContext(state, sessionId));
  if (!readiness.visible || !readiness.gaps.some(gap => gap.field.id === fieldId && gap.canDiscuss)) throw new Error('הנושא השתנה או שאינו זמין להשלמה בשיחה. יש לבחור מתוך המצב המעודכן.');
  const next = startExpansion(state, sessionId, 'intake');
  return updateSession(next, { ...sessionOf(next, sessionId), focusSelection: intakeCompletionFocus(fieldId) });
}
export function rollbackExpansion(state: PortalState, sessionId: string, expectedRevision: number, previousSession: Session): PortalState {
  const current = sessionOf(state, sessionId);
  if (previousSession.id !== sessionId || previousSession.patientId !== current.patientId || previousSession.branchId !== current.branchId
    || expectedRevision < previousSession.revision + 1 || current.revision !== expectedRevision || !current.intakeActive
    || (current.intakeRound ?? 0) !== (previousSession.intakeRound ?? 0) + 1) return state;
  const content = (session: Session) => JSON.stringify([session.messages, session.pendingFields, session.pendingDraft, session.draftHistory, session.traces, session.composer, session.skippedTopics, session.questionCount]);
  if (content(current) !== content(previousSession)) return state;
  const revision = current.revision + 1;
  const pending = previousSession.pendingDraft;
  const canRestoreReview = pending && pending.reviewRevision === previousSession.revision && pending.preferenceSnapshot
    && preferenceSignature(pending.preferenceSnapshot) === preferenceSignature(buildContext(state, sessionId).preferences)
    && goals.every(goal => currentVersion(state, current.patientId, current.branchId, goal, goal === 'note' ? sessionId : undefined)?.id === pending.baseVersionIds[goal]);
  return updateSession(state, { ...current, revision, status: previousSession.status, closedAt: previousSession.closedAt,
    intakeActive: previousSession.intakeActive, intakeCount: previousSession.intakeCount,
    focusGoal: previousSession.focusGoal, focusSelection: previousSession.focusSelection,
    ...(canRestoreReview ? { pendingDraft: { ...pending, reviewRevision: revision } } : {}) });
}
/** Advance only the request revision after the server rejects an already-completed revision.
 * Existing proposal review revisions remain unchanged, so the advance cannot approve stale work. */
export function advanceRequestRevision(state: PortalState, sessionId: string, expectedRevision: number, minimumRevision: number): PortalState {
  const session = checkRevision(state, sessionId, expectedRevision);
  assertCurrentSession(state, session);
  if (!Number.isSafeInteger(minimumRevision) || minimumRevision <= session.revision) throw new Error('גרסת הבקשה שהתקבלה מהשרת אינה תקינה.');
  return updateSession(state, { ...session, revision: minimumRevision });
}
export function applyTurn(state: PortalState, sessionId: string, baseRevision: number, result: TurnResult): PortalState {
  const s = checkRevision(state, sessionId, baseRevision); const context = buildContext(state, sessionId);
  assertCurrentSession(state, s);
  checkUpdates(context, result.fieldUpdates);
  if (s.messages.length >= 500) throw new Error('הגענו למגבלת ההודעות בהדגמה. יש לייצא גיבוי לפני המשך העבודה.');
  if (result.action === 'question' && (s.intakeActive ? s.intakeCount >= 2 : s.questionCount >= 3)) throw new Error('הגענו למספר השאלות שנבחר. אפשר לעבור לטיוטה.');
  const next = applyPreferenceUpdates(state, s, result.preferenceUpdates);
  return updateSession(next, { ...s, pendingFields: accumulateUpdates(s.pendingFields ?? [], result.fieldUpdates), revision: s.revision + 1, closedAt: undefined, status: result.action === 'question' ? 'asking' : 'draft', messages: [...s.messages, { id: uid('message'), role: 'assistant', text: result.utterance, at: now() }], questionCount: s.questionCount + (result.action === 'question' && !s.intakeActive ? 1 : 0), intakeCount: s.intakeCount + (result.action === 'question' && s.intakeActive ? 1 : 0) });
}
export function saveDraft(state: PortalState, sessionId: string, baseRevision: number, result: DraftResult): PortalState {
  const s = checkRevision(state, sessionId, baseRevision);
  assertCurrentSession(state, s);
  if (!draftResultSchema.safeParse(result).success) throw new Error('הטיוטה חורגת ממגבלות התיעוד או שאינה תקינה.');
  const next = updateSession(applyPreferenceUpdates(state, s, result.preferenceUpdates ?? []), { ...s, closedAt: undefined });
  const context = buildContext(next, sessionId, 'draft');
  checkDraft(context, result);
  if ((s.draftHistory?.length ?? 0) + (s.pendingDraft ? 1 : 0) >= 100) throw new Error('הגענו למגבלת גרסאות הטיוטה בפגישה. יש לייצא גיבוי לפני המשך העבודה.');
  const pendingFields = accumulateUpdates(s.pendingFields ?? [], result.fieldUpdates);
  const fields = mergeFields(context.documents.find(d => d.kind === 'intake')?.fields ?? emptyIntakeFields(), pendingFields);
  const reviewResult = structuredClone(result);
  // The structured ledger renders the intake so missing information stays explicit.
  reviewResult.documents = reviewResult.documents.map(doc => doc.kind === 'intake' ? { ...doc, content: `# אינטייק — עד פגישה ${s.number}\n\nמבנה הדוח מלא. מידע חסר נשאר גלוי.\n\n${renderIntakeReport(fields, context.preferences)}`, sourceIds: distinct(fields.flatMap(f => f.sourceIds)) } : doc);
  if (reviewResult.documents.some(doc => doc.content.length > TEXT_LIMITS.document)) throw new Error('דוח האינטייק המלא חורג ממגבלת 100,000 תווים. ההצעה הקודמת נשארה שמורה.');
  const pendingDraft: PendingDraft = { id: uid('draft'), createdAt: now(), baseVersionIds: Object.fromEntries(context.documents.map(doc => [doc.kind, doc.versionId])), result: reviewResult, fields: structuredClone(fields), reviewRevision: s.revision + 1, preferenceSnapshot: structuredClone(context.preferences) };
  return updateSession(next, { ...s, revision: s.revision + 1, closedAt: undefined, status: 'draft', intakeActive: false, focusGoal: undefined, focusSelection: undefined, pendingFields, pendingDraft, draftHistory: [...(s.draftHistory ?? []), ...(s.pendingDraft ? [s.pendingDraft] : [])] });
}

export function editDocument(state: PortalState, patientId: string, branchId: string, kind: Goal, content: string, fields?: IntakeField[], sessionId?: string, expectedBaseVersionId?: string | null): PortalState {
  checkBranch(state, patientId, branchId);
  const session = sessionId ? sessionOf(state, sessionId) : undefined;
  if (session && (session.patientId !== patientId || session.branchId !== branchId)) throw new Error('המסמך שייך לתיק אחר.');
  if (kind === 'note' && !session) throw new Error('יש לבחור פגישה לעריכת רשומה.');
  const previous = currentVersion(state, patientId, branchId, kind, sessionId); const at = now(); const sourceId = uid('manual');
  if (expectedBaseVersionId !== undefined && (previous?.id ?? null) !== expectedBaseVersionId) throw new Error('המסמך השתנה מאז פתיחת העורך. העריכה שלך נשארה פתוחה; יש להשוות לנוסח העדכני לפני השמירה.');
  if (kind !== 'intake' && content.length > TEXT_LIMITS.manualDocument) throw new Error(`אפשר לשמור עד ${TEXT_LIMITS.manualDocument.toLocaleString('en-US')} תווים בעריכה ישירה.`);
  if (fields && (!z.array(fieldSchema).length(32).safeParse(fields).success || new Set(fields.map(field => field.id)).size !== 32)) throw new Error('שדות האינטייק חורגים ממגבלות התיעוד או שאינם תקינים.');
  if (state.sources.length >= archiveLimits.sources || state.versions.length >= 10000) throw new Error('האחסון הגיע למגבלת ההדגמה. יש לייצא גיבוי לפני עריכה נוספת.');
  const normalized = fields?.map(field => {
    const old = previous?.fields?.find(f => f.id === field.id);
    return JSON.stringify(old) === JSON.stringify(field) ? { ...field } : { ...field, sourceIds: [sourceId] };
  });
  const rawContent = kind === 'intake' && normalized ? renderIntake(normalized) : content;
  const reportSessionId = sessionId ?? state.sessions.filter(s => s.patientId === patientId && s.branchId === branchId).sort((a, b) => b.number - a.number)[0]?.id;
  const rendered = kind === 'intake' && normalized ? renderIntakeReport(normalized, preferencesAt(state, patientId, branchId, 1000, at, reportSessionId)) : content;
  const source: Source = { id: sourceId, patientId, branchId, ...(session ? { sessionId: session.id, sessionNumber: session.number } : {}), text: `עריכה ישירה של המטפל — ${kind}\n\n${rawContent}`, recordedAt: at, kind: 'manual' };
  if (source.text.length > TEXT_LIMITS.source || rendered.length > TEXT_LIMITS.document) throw new Error('התוכן המלא של העריכה חורג ממגבלת 100,000 תווים. העריכה נשארה פתוחה ולא נשמרה.');
  const version: DocumentVersion = { id: uid('version'), patientId, branchId, kind, ...(session ? { sessionId: session.id, sessionNumber: session.number } : {}), content: rendered, ...(normalized ? { fields: normalized } : {}), sourceIds: distinct([...(normalized ? normalized.flatMap(f => f.sourceIds) : []), sourceId]), createdAt: at, author: 'clinician', reason: 'עריכה ישירה של המטפל', approved: false, ...(previous ? { baseVersionId: previous.id } : {}) };
  const manuallyChangedFields = new Set(normalized?.filter(field => field.sourceIds.includes(sourceId)).map(field => field.id) ?? []);
  const edited = invalidate(clearPendingFields({ ...state, sources: [...state.sources, source], versions: [...state.versions, version] }, patientId, branchId, manuallyChangedFields), patientId, branchId);
  return reopenDocumentSession(edited, version);
}

export function restoreVersion(state: PortalState, versionId: string): PortalState {
  const original = state.versions.find(v => v.id === versionId && !v.proposal);
  if (!original) throw new Error('הגרסה לא נמצאה.');
  const current = currentVersion(state, original.patientId, original.branchId, original.kind, original.sessionId);
  const restored: DocumentVersion = { ...structuredClone(original), ...(original.kind !== 'note' && current ? { sessionId: current.sessionId, sessionNumber: current.sessionNumber } : {}), id: uid('version'), createdAt: now(), author: 'clinician', approved: false, proposal: false, rejected: false, baseVersionId: current?.id, reason: `שחזור מלא של גרסה ${original.id}` };
  if (state.versions.length >= 10000) throw new Error('הגענו למגבלת גרסאות המסמכים. יש לייצא גיבוי לפני המשך העבודה.');
  const next = invalidate(clearPendingFields({ ...state, versions: [...state.versions, restored] }, original.patientId, original.branchId,
    new Set(original.kind === 'intake' ? (original.fields ?? []).map(field => field.id) : [])), original.patientId, original.branchId);
  return reopenDocumentSession(next, restored);
}
export function acceptProposal(state: PortalState, versionId: string): PortalState {
  const proposal = state.versions.find(v => v.id === versionId && v.proposal && !v.rejected);
  if (!proposal) throw new Error('ההצעה אינה זמינה.');
  const current = currentVersion(state, proposal.patientId, proposal.branchId, proposal.kind, proposal.kind === 'note' ? proposal.sessionId : undefined);
  if (current?.id !== proposal.baseVersionId) throw new Error('המסמך נערך מאז יצירת ההצעה. יש להכין הצעה מול הגרסה העדכנית.');
  if (state.versions.length >= 10000) throw new Error('הגענו למגבלת גרסאות המסמכים. יש לייצא גיבוי לפני המשך העבודה.');
  const accepted: DocumentVersion = { ...structuredClone(proposal), id: uid('version'), createdAt: now(), author: 'clinician', approved: false, proposal: false, rejected: false, reason: 'המטפל קיבל הצעת עדכון לאחר השוואה' };
  const next = invalidate({ ...state, versions: [...state.versions.map(v => v.id === versionId ? { ...v, rejected: true } : v), accepted] }, proposal.patientId, proposal.branchId);
  return reopenDocumentSession(next, accepted);
}
export function rejectProposal(state: PortalState, versionId: string): PortalState {
  return { ...state, versions: state.versions.map(v => v.id === versionId && v.proposal ? { ...v, rejected: true } : v) };
}
export function pendingDraftIsCurrent(state: PortalState, sessionId: string): boolean {
  const s = sessionOf(state, sessionId); const pending = s.pendingDraft;
  return Boolean(pending && !nextSession(state, s) && pending.reviewRevision === s.revision && pending.preferenceSnapshot
    && preferenceSignature(pending.preferenceSnapshot) === preferenceSignature(buildContext(state, sessionId).preferences)
    && goals.every(goal => currentVersion(state, s.patientId, s.branchId, goal, goal === 'note' ? sessionId : undefined)?.id === pending.baseVersionIds[goal]));
}
export function approveSession(state: PortalState, sessionId: string, expectedDraftId?: string): PortalState {
  const s = sessionOf(state, sessionId); const at = now();
  if (s.pendingDraft) {
    assertCurrentSession(state, s);
    const pending = s.pendingDraft;
    if ((expectedDraftId && expectedDraftId !== pending.id) || pending.reviewRevision !== s.revision) throw new Error('הטיוטה השתנתה או שנוסף מידע מאז הכנתה. יש להכין סיכום מעודכן לפני האישור.');
    if (!pending.preferenceSnapshot || preferenceSignature(pending.preferenceSnapshot) !== preferenceSignature(buildContext(state, sessionId).preferences)) throw new Error('העדפות התיעוד השתנו או שלא נשמרו עם הטיוטה. יש להכין סיכום מעודכן לפני האישור.');
    for (const goal of goals) {
      if (currentVersion(state, s.patientId, s.branchId, goal, goal === 'note' ? sessionId : undefined)?.id !== pending.baseVersionIds[goal]) throw new Error('אחד המסמכים נערך מאז הכנת הטיוטה. יש להכין סיכום מול הגרסה המעודכנת; העריכה שלך נשמרה.');
    }
    checkDraft(buildContext(state, sessionId, 'draft'), pending.result);
    if (state.versions.length + goals.length > 10000) throw new Error('הגענו למגבלת גרסאות המסמכים. יש לייצא גיבוי לפני המשך העבודה.');
    const approved: DocumentVersion[] = pending.result.documents.map(doc => ({ id: uid('version'), patientId: s.patientId, branchId: s.branchId, kind: doc.kind,
      sessionId, sessionNumber: s.number, content: doc.content, sourceIds: distinct(doc.sourceIds), ...(doc.kind === 'intake' ? { fields: structuredClone(pending.fields) } : {}), createdAt: at,
      author: 'assistant', approved: true, reason: 'סיכום שהוכן בידי העוזר ונשמר לאחר אישור המטפל', ...(pending.baseVersionIds[doc.kind] ? { baseVersionId: pending.baseVersionIds[doc.kind] } : {}) }));
    return updateSession({ ...state, versions: [...state.versions, ...approved] }, { ...s, revision: s.revision + 1, status: 'approved', closedAt: at, intakeActive: false, focusGoal: undefined, focusSelection: undefined, pendingFields: [], pendingDraft: undefined, draftHistory: [...(s.draftHistory ?? []), { ...pending, approvedAt: at, approvedVersionIds: approved.map(version => version.id) }] });
  }
  if (expectedDraftId) throw new Error('הטיוטה שאושרה אינה זמינה עוד. יש לבדוק את הרשומה העדכנית.');
  if (s.pendingFields?.length) throw new Error('נאסף מידע שטרם נכלל בסיכום לעיון. יש להכין סיכום מעודכן לפני האישור.');
  const latestDocs = goals.map(kind => currentVersion(state, s.patientId, s.branchId, kind, kind === 'note' ? sessionId : undefined)).filter((v): v is DocumentVersion => Boolean(v && v.sessionId === sessionId));
  if (!latestDocs.some(v => v.kind === 'note')) throw new Error('יש ליצור או לערוך רשומה לפני האישור.');
  if (state.versions.length + latestDocs.length > 10000) throw new Error('הגענו למגבלת גרסאות המסמכים. יש לייצא גיבוי לפני המשך העבודה.');
  const approved = latestDocs.map(v => ({ ...structuredClone(v), id: uid('version'), createdAt: at, approved: true, author: 'clinician' as const, baseVersionId: v.id, reason: 'אישור המטפל לפגישת התיעוד' }));
  return updateSession({ ...state, versions: [...state.versions, ...approved] }, { ...s, revision: s.revision + 1, status: 'approved', closedAt: s.closedAt && nextSession(state, s) ? s.closedAt : at, intakeActive: false });
}
export function forkBranch(state: PortalState, sessionId: string, name: string): { state: PortalState; branch: Branch } {
  const s = sessionOf(state, sessionId);
  if (state.branches.length >= archiveLimits.branches) throw new Error('הגענו למגבלת הרצפים בהדגמה. יש לייצא גיבוי לפני המשך העבודה.');
  if (name.trim().length > 200) throw new Error('שם הרצף יכול להכיל עד 200 תווים.');
  const cutoffAt = temporalBoundary(state, s);
  const branch: Branch = { id: uid('branch'), patientId: s.patientId, name: name.trim() || `רצף חלופי אחרי פגישה ${s.number}`, parentId: s.branchId, forkSession: s.number, cutoffAt };
  return { state: { ...state, branches: [...state.branches, branch] }, branch };
}

const identifier = z.string().min(1).max(160);
const date = z.string().datetime({ offset: true });
const kind = z.enum(['note', 'formulation', 'intake', 'gold', 'supervision']);
const fieldSchema = z.object({ id: z.number().int().min(1).max(32), value: z.string().max(TEXT_LIMITS.fieldValue), status: z.enum(['documented', 'partial', 'unknown', 'not_assessed', 'not_recalled', 'conflict', 'not_applicable']), sourceIds: z.array(identifier).max(200), remaining: z.string().max(TEXT_LIMITS.fieldRemaining).optional() }).strict();
const preferenceSchema = z.object({ id: identifier, topic: z.string().max(200), goal: kind.optional(), action: z.enum(['less', 'block', 'exclude']), scope: z.enum(['session', 'patient']), sessionId: identifier.optional(), patientId: identifier.optional(), branchId: identifier.optional(), recordedAt: date.optional() }).strict();
const preferenceUpdateSchema = z.object({ topic: z.string().min(1).max(200), goal: kind.optional(), action: z.enum(['less', 'block', 'exclude']), scope: z.enum(['session', 'patient']) }).strict();
const draftBasesSchema = z.object({ note: identifier.optional(), formulation: identifier.optional(), intake: identifier.optional(), gold: identifier.optional(), supervision: identifier.optional() }).strict();
const workingDraftMetadataSchema = z.object({ draftId: identifier, createdAt: date, reviewRevision: z.number().int().min(0), baseVersionIds: draftBasesSchema, stale: z.boolean(), derivative: z.literal(true) }).strict();
const focusSelectionSchema = z.object({ goal: kind, text: z.string().min(1).max(1200), kind: z.literal('expand'), fieldIds: z.array(z.number().int().min(1).max(32)).max(32) }).strict().refine(value => new Set(value.fieldIds).size === value.fieldIds.length);
const draftResultSchema = z.object({
  documents: z.array(z.object({ kind, content: z.string().max(100000), sourceIds: z.array(identifier).max(10000) }).strict()).length(5),
  fieldUpdates: z.array(fieldSchema.extend({ remaining: z.string().max(5000) })).max(32), rationale: z.string().max(10000), summary: z.string().max(1600).optional(),
  followUps: z.array(z.object({ goal: kind, text: z.string().max(1200), kind: z.enum(['expand', 'next_session']), fieldIds: z.array(z.number().int().min(1).max(32)).max(32) }).strict()).max(3).optional(),
  preferenceUpdates: z.array(preferenceUpdateSchema).max(10).optional(),
}).strict();
const pendingDraftSchema = z.object({ id: identifier, createdAt: date, baseVersionIds: draftBasesSchema, result: draftResultSchema, fields: z.array(fieldSchema).length(32), reviewRevision: z.number().int().min(0), preferenceSnapshot: z.array(preferenceSchema).max(1000).optional(), approvedAt: date.optional(), approvedVersionIds: z.array(identifier).length(5).optional() }).strict();
const archiveSchema = z.object({
  schemaVersion: z.literal(1),
  patients: z.array(z.object({ id: identifier, name: patientNameSchema, age: z.number().int().min(18).max(120).optional(), schedule: patientScheduleSchema.optional(), description: z.string().max(2000), fictional: z.literal(true) }).strict()).min(1).max(archiveLimits.patients),
  branches: z.array(z.object({ id: identifier, patientId: identifier, name: z.string().max(200), parentId: identifier.optional(), forkSession: z.number().int().min(1).max(1000).optional(), cutoffAt: date.optional() }).strict()).max(archiveLimits.branches),
  sources: z.array(z.object({ id: identifier, patientId: identifier, branchId: identifier, sessionId: identifier.optional(), sessionNumber: z.number().int().min(1).max(1000).optional(), text: z.string().max(100000), recordedAt: date, kind: z.enum(['clinician', 'manual', 'seed']) }).strict()).max(archiveLimits.sources),
  versions: z.array(z.object({ id: identifier, patientId: identifier, branchId: identifier, kind, sessionId: identifier.optional(), sessionNumber: z.number().int().min(1).max(1000).optional(), content: z.string().max(100000), fields: z.array(fieldSchema).max(32).optional(), sourceIds: z.array(identifier).max(10000), createdAt: date, author: z.enum(['clinician', 'assistant', 'seed']), reason: z.string().max(2000), baseVersionId: identifier.optional(), approved: z.boolean(), proposal: z.boolean().optional(), rejected: z.boolean().optional() }).strict()).max(10000),
  preferences: z.array(preferenceSchema).max(1000),
  preferenceCancellations: z.array(z.object({ id: identifier, preferenceId: identifier, patientId: identifier, branchId: identifier, sessionId: identifier, recordedAt: date }).strict()).max(1000).optional(),
  sessions: z.array(z.object({ id: identifier, patientId: identifier, branchId: identifier, number: z.number().int().min(1).max(1000), startedAt: date, closedAt: date.optional(), revision: z.number().int().min(0), status: z.enum(['writing', 'asking', 'draft', 'approved']), messages: z.array(z.object({ id: identifier, role: z.enum(['user', 'assistant']), text: z.string().max(100000), sourceId: identifier.optional(), at: date }).strict()).max(500), composer: z.string().max(100000), questionCount: z.number().int().min(0).max(3), intakeCount: z.number().int().min(0).max(2), intakeRound: z.number().int().min(0).max(10).optional(), intakeActive: z.boolean(), focusGoal: kind.optional(), focusSelection: focusSelectionSchema.optional(), pendingFields: z.array(fieldSchema.extend({ remaining: z.string().max(5000) })).max(32).optional(), pendingDraft: pendingDraftSchema.optional(), draftHistory: z.array(pendingDraftSchema).max(100).optional(), skippedTopics: z.array(z.string().max(200)).max(100), traces: z.array(z.unknown()).max(200) }).strict()).max(archiveLimits.sessions),
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
    if (s.focusSelection) {
      const savedFollowUp = s.pendingDraft?.result.followUps?.some(item => JSON.stringify(item) === JSON.stringify(s.focusSelection));
      const intakePanelChoice = s.number >= 4 && (s.intakeRound ?? 0) > 0 && isCanonicalIntakeCompletionFocus(s.focusSelection);
      if (s.focusSelection.goal !== s.focusGoal || !s.intakeActive || (!savedFollowUp && !intakePanelChoice)) throw new Error('בחירת ההרחבה בגיבוי אינה תואמת לפגישה.');
    }
  }
  for (const item of [...state.sources, ...state.versions]) {
    const owner = state.sessions.find(s => s.id === item.sessionId);
    if (item.sessionId ? !owner || owner.patientId !== item.patientId || owner.branchId !== item.branchId || owner.number !== item.sessionNumber : item.sessionNumber !== undefined) throw new Error('שיוך המקור או המסמך לפגישה אינו תקין.');
  }
  const sourceAllowed = (source: Source, patientId: string, scope: ContextPacket['branchScope'], at: string) => {
    const access = inScope(source, scope);
    return source.patientId === patientId && access && Date.parse(source.recordedAt) <= Date.parse(at) && (!access.cutoffAt || Date.parse(source.recordedAt) <= Date.parse(access.cutoffAt));
  };
  for (const session of state.sessions) {
    const scope = scopeFor(state, session.branchId, session.number);
    const following = nextSession(state, session);
    const lastTime = following ? new Date(Date.parse(following.startedAt) - 1).toISOString() : '9999-12-31T23:59:59.999Z';
    const allowedFields = (fields: IntakeField[], at: string) => new Set(fields.map(f => f.id)).size === fields.length
      && fields.every(f => new Set(f.sourceIds).size === f.sourceIds.length && (f.status === 'unknown' || f.sourceIds.length > 0)
        && f.sourceIds.every(id => state.sources.some(source => source.id === id && sourceAllowed(source, session.patientId, scope, at))));
    if (session.pendingFields && !allowedFields(session.pendingFields, lastTime)) throw new Error('מקור של מידע ממתין אינו שייך לפגישה, לתיק או לרצף המותרים.');
    const drafts = [...(session.draftHistory ?? []), ...(session.pendingDraft ? [session.pendingDraft] : [])];
    if (new Set(drafts.map(d => d.id)).size !== drafts.length || (session.status === 'approved' && (session.pendingDraft || session.pendingFields?.length)) || session.pendingDraft?.approvedAt || session.pendingDraft?.approvedVersionIds) throw new Error('מצב הטיוטות הממתינות אינו תקין.');
    for (const draft of drafts) {
      if (!atOrBefore(session.startedAt, draft.createdAt) || !atOrBefore(draft.createdAt, lastTime) || draft.reviewRevision > session.revision
        || !allowedFields(draft.fields, draft.createdAt) || !allowedFields(draft.result.fieldUpdates, draft.createdAt)
        || new Set(draft.result.documents.map(d => d.kind)).size !== 5
        || draft.result.documents.some(doc => new Set(doc.sourceIds).size !== doc.sourceIds.length || doc.sourceIds.some(id => !state.sources.some(source => source.id === id && sourceAllowed(source, session.patientId, scope, draft.createdAt))))
        || draft.result.followUps?.some(item => new Set(item.fieldIds).size !== item.fieldIds.length)) throw new Error('מקור או מבנה של טיוטה ממתינה אינו תקין.');
      if (draft.preferenceSnapshot && (new Set(draft.preferenceSnapshot.map(p => p.id)).size !== draft.preferenceSnapshot.length || draft.preferenceSnapshot.some(p => {
        const origin = state.sessions.find(s => s.id === p.sessionId);
        const access = p.branchId ? inScope({ branchId: p.branchId, sessionNumber: origin?.number }, scope) : undefined;
        return p.patientId !== session.patientId || !access || (p.scope === 'session' && p.sessionId !== session.id)
          || (p.recordedAt && (!atOrBefore(p.recordedAt, draft.createdAt) || (access.cutoffAt && !atOrBefore(p.recordedAt, access.cutoffAt))))
          || !state.preferences.some(saved => saved.id === p.id && preferenceSignature([saved]) === preferenceSignature([p]));
      }))) throw new Error('העדפות הטיוטה אינן שייכות להקשר השמור.');
      for (const [goal, versionId] of Object.entries(draft.baseVersionIds)) {
        if (!state.versions.some(version => {
          const access = inScope(version, scope);
          return version.id === versionId && version.patientId === session.patientId && version.kind === goal && access && atOrBefore(version.createdAt, draft.createdAt)
            && (!access.cutoffAt || atOrBefore(version.createdAt, access.cutoffAt)) && (goal !== 'note' || version.sessionId === session.id);
        })) throw new Error('גרסת המקור של הטיוטה הממתינה אינה תקינה.');
      }
      if (Boolean(draft.approvedAt) !== Boolean(draft.approvedVersionIds)) throw new Error('סימון אישור הטיוטה אינו שלם.');
      if (draft.approvedAt && draft.approvedVersionIds) {
        const approvedAt = draft.approvedAt;
        const versions = draft.approvedVersionIds.map(id => state.versions.find(version => version.id === id));
        if (!atOrBefore(draft.createdAt, approvedAt) || !atOrBefore(approvedAt, lastTime) || new Set(draft.approvedVersionIds).size !== 5 || new Set(versions.map(version => version?.kind)).size !== 5
          || versions.some(version => {
            const document = draft.result.documents.find(doc => doc.kind === version?.kind);
            return !version || !document || !version.approved || version.proposal || version.rejected || version.patientId !== session.patientId || version.branchId !== session.branchId || version.sessionId !== session.id
              || version.createdAt !== approvedAt || version.content !== document.content || JSON.stringify(version.sourceIds) !== JSON.stringify(document.sourceIds)
              || version.baseVersionId !== draft.baseVersionIds[version.kind] || (version.kind === 'intake' && JSON.stringify(version.fields) !== JSON.stringify(draft.fields));
          })) throw new Error('המסמכים שאושרו אינם תואמים לטיוטה השמורה.');
      }
    }
  }
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
  const traceDocument = z.object({ kind, versionId: identifier, content: z.string().max(TEXT_LIMITS.document), sourceIds: z.array(identifier).max(10000), fields: z.array(fieldSchema).max(32).optional(), author: z.enum(['clinician', 'assistant', 'seed']).optional(), approved: z.boolean().optional(), createdAt: date.optional(), reason: z.string().max(2000).optional() }).strict();
  const preferenceUpdate = z.object({ topic: z.string().max(200), goal: kind.optional(), action: z.enum(['less', 'block', 'exclude']), scope: z.enum(['session', 'patient']) }).strict();
  const traceSchema = z.object({ id: identifier, at: date, mode: z.enum(['prepared', 'live']), model: z.string().max(200), promptVersion: z.string().max(200), prompt: z.string().max(100000), contextOrigin: z.enum(['server', 'client']).optional(), context: z.object({
    patientId: identifier, patientName: z.string().max(200), branchId: identifier, sessionId: identifier, sessionNumber: z.number().int().min(1).max(1000),
    baseRevision: z.number().int().min(0), asOf: date, stage: z.enum(['main', 'intake', 'draft']), questionCount: z.number().int().min(0).max(3), intakeCount: z.number().int().min(0).max(2), intakeRound: z.number().int().min(0).max(10).optional(), focusGoal: kind.optional(), focusSelection: focusSelectionSchema.optional(), workingDraft: draftResultSchema.optional(), workingDraftMetadata: workingDraftMetadataSchema.optional(), pendingIntakeFields: z.array(fieldSchema).max(32).optional(),
    sources: archiveSchema.shape.sources, documents: z.array(traceDocument).max(5), messages: archiveSchema.shape.sessions.element.shape.messages, preferences: archiveSchema.shape.preferences,
    skippedTopics: z.array(z.string().max(200)).max(100), branchScope: z.array(z.object({ branchId: identifier, throughSession: z.number().int().min(1).max(1000), cutoffAt: date.optional() }).strict()).min(1).max(300),
  }).strict(), response: z.union([
    z.object({ action: z.enum(['question', 'draft']), utterance: z.string().max(100000), topic: z.string().max(200), rationale: z.string().max(10000), fieldUpdates: z.array(fieldSchema).max(32), preferenceUpdates: z.array(preferenceUpdate).max(1000) }).strict(),
    draftResultSchema,
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
        const sameContent = v.content === doc.content || (v.kind === 'intake' && compactIntakeText(v.content, v.fields, context.preferences) === doc.content);
        return v.id === doc.versionId && v.patientId === s.patientId && v.kind === doc.kind && sameContent && JSON.stringify(v.fields) === JSON.stringify(doc.fields)
          && (doc.author === undefined || doc.author === v.author) && (doc.approved === undefined || doc.approved === v.approved)
          && (doc.createdAt === undefined || doc.createdAt === v.createdAt) && (doc.reason === undefined || doc.reason === v.reason)
          && access && atOrBefore(v.createdAt, context.asOf) && (!access.cutoffAt || atOrBefore(v.createdAt, access.cutoffAt));
      }))
      || context.messages.some(m => m.sourceId && !context.sources.some(source => source.id === m.sourceId && source.sessionId === s.id && source.text === m.text))
      || context.preferences.some(p => {
        const origin = state.sessions.find(item => item.id === p.sessionId);
        const access = p.branchId ? inScope({ branchId: p.branchId, sessionNumber: origin?.number }, scope) : undefined;
        return p.patientId !== s.patientId || !access || (p.scope === 'session' && p.sessionId !== s.id) || (p.recordedAt && (!atOrBefore(p.recordedAt, context.asOf) || (access.cutoffAt && !atOrBefore(p.recordedAt, access.cutoffAt))));
      }) || !validFields(check.data.response.fieldUpdates)
      || (context.pendingIntakeFields && !validFields(context.pendingIntakeFields))
      || (context.focusSelection && context.focusSelection.goal !== context.focusGoal)
      || (context.workingDraft && (!validFields(context.workingDraft.fieldUpdates) || new Set(context.workingDraft.documents.map(d => d.kind)).size !== 5 || context.workingDraft.documents.some(d => d.sourceIds.some(id => !ids.has(id)))))
      || ('documents' in check.data.response && (new Set(check.data.response.documents.map(d => d.kind)).size !== 5 || check.data.response.documents.some(d => d.sourceIds.some(id => !ids.has(id)))))) throw new Error('רישום הפעולה בגיבוי אינו תקין.');
  }
  return state;
}
export function exportState(state: PortalState): string { return JSON.stringify(state, null, 2); }

import { describe, expect, it, vi, afterEach } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { preparedDraft } from '../fixtures/fictional/prepared';
import { acceptProposal, addUserMessage, applyTurn, approveSession, buildContext, cancelPreference, createPatient, createSession, currentVersion, editDocument, emptyIntakeFields, exportState, forkBranch, importState, renderIntakeReport, restoreVersion, saveDraft } from '../packages/domain';
import type { PortalState, TurnResult } from '../packages/contracts';

const patient = 'fictional-tamar'; const branch = `${patient}-main`;
function active() { return createSession(createDemoState(), patient, branch, 5); }
const question: TurnResult = { action: 'question', utterance: 'מה חשוב לך לשמור מהרגע הזה?', topic: 'רגע בפגישה', rationale: 'בירור לתיעוד', fieldUpdates: [], preferenceUpdates: [] };
afterEach(() => vi.useRealTimers());

describe('new patient records', () => {
  it('atomically creates an empty first session and only the supplied administrative information', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
    const original = createDemoState(); const before = exportState(original);
    const created = createPatient(original, { name: '  תיק בדיקה א  ', schedule: { dayOfWeek: 0, time: '09:30' } });
    expect(exportState(original)).toBe(before);
    expect(created.patient).toMatchObject({ name: 'תיק בדיקה א', description: '', fictional: true, schedule: { dayOfWeek: 0, time: '09:30' } });
    expect(created.patient).not.toHaveProperty('age');
    expect(created.branch).toMatchObject({ patientId: created.patient.id });
    expect(created.branch).not.toHaveProperty('parentId');
    expect(created.session).toMatchObject({ patientId: created.patient.id, branchId: created.branch.id, number: 1, startedAt: '2026-10-16T10:00:00.000Z', status: 'writing', revision: 0, composer: '', messages: [], traces: [], questionCount: 0, intakeCount: 0 });
    expect(created.state.versions).toEqual(original.versions);
    const context = buildContext(created.state, created.session.id);
    expect(context.documents).toEqual([]); expect(context.messages).toEqual([]); expect(context.preferences).toEqual([]);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]).toMatchObject({ patientId: created.patient.id, branchId: created.branch.id, kind: 'manual', recordedAt: '2026-10-16T10:00:00.000Z' });
    expect(context.sources[0]).not.toHaveProperty('sessionId');
    expect(context.sources[0].text).toContain('תיק בדיקה א');
    expect(context.sources[0].text).toContain('יום ראשון, שעה 09:30');
    expect(context.sources[0].text).toContain('אינו תיעוד של פגישה שהתקיימה');
  });
  it('allows name only, day only, time only and all valid day/time boundaries without inventing values', () => {
    for (const schedule of [undefined, { dayOfWeek: 0 }, { dayOfWeek: 6 }, { time: '00:00' }, { time: '23:59' }]) {
      const created = createPatient(createDemoState(), { name: 'בדיקה', ...(schedule ? { schedule } : {}) });
      expect(created.patient.schedule).toEqual(schedule);
      expect(created.patient.age).toBeUndefined();
      expect(importState(exportState(created.state))).toEqual(created.state);
    }
  });
  it('isolates same-named new patients from one another and from seeded records', () => {
    const first = createPatient(createDemoState(), { name: 'תיק בדיקה' });
    const firstState = addUserMessage(first.state, first.session.id, 'מידע בדיוני ששייך לתיק הראשון בלבד');
    const second = createPatient(firstState, { name: 'תיק בדיקה' });
    expect(new Set([first.patient.id, second.patient.id, first.branch.id, second.branch.id, first.session.id, second.session.id]).size).toBe(6);
    const firstContext = buildContext(second.state, first.session.id);
    const secondContext = buildContext(second.state, second.session.id);
    expect(firstContext.sources.every(source => source.patientId === first.patient.id)).toBe(true);
    expect(secondContext.sources.every(source => source.patientId === second.patient.id)).toBe(true);
    expect(JSON.stringify(secondContext)).not.toContain('מידע בדיוני ששייך לתיק הראשון בלבד');
    expect(buildContext(second.state, `${patient}-session-4`).sources.every(source => source.patientId === patient)).toBe(true);
  });
  it('continues to session two while preserving the first session and its saved note', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
    const first = createPatient(createDemoState(), { name: 'בדיקת רצף', schedule: { dayOfWeek: 2, time: '14:00' } });
    let state = addUserMessage(first.state, first.session.id, 'תיאור פגישה בדיוני ראשון');
    state = editDocument(state, first.patient.id, first.branch.id, 'note', 'רשומת בדיקה ראשונה', undefined, first.session.id);
    const savedSession = structuredClone(state.sessions.find(s => s.id === first.session.id));
    const savedNote = structuredClone(currentVersion(state, first.patient.id, first.branch.id, 'note', first.session.id));
    vi.setSystemTime(new Date('2026-10-23T10:00:00.000Z'));
    const second = createSession(state, first.patient.id, first.branch.id, 2);
    expect(second.state.sessions.find(s => s.id === first.session.id)).toEqual(savedSession);
    expect(currentVersion(second.state, first.patient.id, first.branch.id, 'note', first.session.id)).toEqual(savedNote);
    expect(second.session).toMatchObject({ number: 2, messages: [], composer: '', startedAt: '2026-10-23T10:00:00.000Z' });
    expect(buildContext(second.state, second.session.id).sources.some(source => source.text === 'תיאור פגישה בדיוני ראשון')).toBe(true);
    expect(importState(exportState(second.state))).toEqual(second.state);
  });
  it('imports older records with their existing ages and newer records without a supplied age', () => {
    const old = createDemoState();
    expect(old.patients.every(p => p.age !== undefined && p.schedule === undefined)).toBe(true);
    expect(importState(exportState(old))).toEqual(old);
    const created = createPatient(old, { name: 'בדיקת גיבוי', schedule: { dayOfWeek: 3, time: '17:45' } });
    expect(importState(exportState(created.state))).toEqual(created.state);
  });
  it('rejects blank or overlong names consistently during creation and import', () => {
    for (const name of ['', ' \t\n ', 'א'.repeat(201)]) {
      const state = createDemoState(); const before = exportState(state);
      expect(() => createPatient(state, { name })).toThrow();
      expect(exportState(state)).toBe(before);
      state.patients[0].name = name;
      expect(() => importState(exportState(state))).toThrow();
    }
    const created = createPatient(createDemoState(), { name: 'א'.repeat(200) });
    expect(importState(exportState(created.state))).toEqual(created.state);
  });
  it('rejects malformed or unknown schedule fields consistently during creation and import', () => {
    for (const schedule of [{ dayOfWeek: -1 }, { dayOfWeek: 7 }, { dayOfWeek: 1.5 }, { dayOfWeek: '1' }, { time: '24:00' }, { time: '09:60' }, { time: '9:00' }, { time: '09:00Z' }, { time: '' }, { time: null }, { duration: 50 }]) {
      const state = createDemoState();
      expect(() => createPatient(state, { name: 'בדיקה', schedule } as any)).toThrow();
      (state.patients[0] as any).schedule = schedule;
      expect(() => importState(exportState(state))).toThrow();
    }
  });
  it('keeps supplied ages adult-only and rejects non-fictional imports', () => {
    for (const age of [17, 121, 20.5, null, '30']) {
      const state = createDemoState(); (state.patients[0] as any).age = age;
      expect(() => importState(exportState(state))).toThrow();
    }
    const created = createPatient(createDemoState(), { name: 'בדיקה' });
    (created.patient as any).fictional = false;
    expect(() => importState(exportState(created.state))).toThrow();
  });
  it('allows the fiftieth patient but rejects further creation without changing existing work', () => {
    let state = createDemoState();
    while (state.patients.length < 50) state = createPatient(state, { name: `תיק בדיקה ${state.patients.length + 1}` }).state;
    expect(importState(exportState(state))).toEqual(state);
    const before = exportState(state);
    expect(() => createPatient(state, { name: 'תיק נוסף' })).toThrow('50');
    expect(exportState(state)).toBe(before);
  });
});

describe('time, case and branch context', () => {
  it('includes only the selected case and available past, never future sessions', () => {
    const state = createDemoState(); const context = buildContext(state, `${patient}-session-2`);
    expect(context.sources).toHaveLength(2);
    expect(context.sources.every(s => s.patientId === patient && s.sessionNumber! <= 2)).toBe(true);
    expect(context.documents.find(d => d.kind === 'formulation')?.content).not.toContain('להשהות את הרגע');
  });
  it('excludes late retrospective edits from earlier context but includes them in the next session', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
    let state = editDocument(createDemoState(), patient, branch, 'formulation', 'עריכה מאוחרת ומזוהה');
    expect(buildContext(state, `${patient}-session-2`).documents.some(d => d.content.includes('מאוחרת ומזוהה'))).toBe(false);
    vi.setSystemTime(new Date('2026-10-16T10:01:00Z'));
    const next = createSession(state, patient, branch, 5);
    expect(buildContext(next.state, next.session.id).documents.find(d => d.kind === 'formulation')?.content).toBe('עריכה מאוחרת ומזוהה');
  });
  it('freezes the parent at branch creation and isolates sibling work', () => {
    let original = createDemoState();
    const fork = forkBranch(original, `${patient}-session-2`, 'מהלך אחר');
    const next = createSession(fork.state, patient, fork.branch.id, 3);
    const ctx = buildContext(next.state, next.session.id);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.branchScope.find(s => s.branchId === branch)?.throughSession).toBe(2);
    const changed = addUserMessage(next.state, next.session.id, 'תוכן ייחודי לענף החלופי');
    const originalFourth = buildContext(changed, `${patient}-session-4`);
    expect(originalFourth.sources.some(s => s.text.includes('ייחודי לענף'))).toBe(false);
  });
  it('scopes persistent and session preferences to the selected case and branch', () => {
    const { state, session } = active();
    const changed = applyTurn(state, session.id, 0, { ...question, preferenceUpdates: [{ topic: 'משפחה', action: 'less', scope: 'patient' }] });
    expect(buildContext(changed, session.id).preferences).toHaveLength(1);
    expect(buildContext(changed, 'fictional-eitan-session-4').preferences).toHaveLength(0);
  });
});
describe('version integrity and bounded flow', () => {
  it('makes manual edits a protected base and requires explicit proposal acceptance', () => {
    let { state, session } = active();
    state = editDocument(state, patient, branch, 'formulation', 'הנוסח שהמטפל בחר');
    state = addUserMessage(state, session.id, 'פרט חדש מהפגישה');
    let context = buildContext(state, session.id, 'draft');
    const result = preparedDraft(context); result.documents.find(d => d.kind === 'formulation')!.content = 'הצעת עדכון חדשה';
    state = saveDraft(state, session.id, context.baseRevision, result);
    expect(currentVersion(state, patient, branch, 'formulation')?.content).toBe('הנוסח שהמטפל בחר');
    const proposal = state.versions.find(v => v.kind === 'formulation' && v.proposal)!;
    expect(proposal).toBeDefined();
    const before = state.versions.length;
    state = acceptProposal(state, proposal.id);
    expect(currentVersion(state, patient, branch, 'formulation')?.content).toBe('הצעת עדכון חדשה');
    expect(state.versions).toHaveLength(before + 1);
  });
  it('rejects stale model replies after direct editing', () => {
    let { state, session } = active(); const context = buildContext(state, session.id);
    state = editDocument(state, patient, branch, 'supervision', 'עדכון בזמן ההמתנה');
    expect(() => applyTurn(state, session.id, context.baseRevision, question)).toThrow('התיק נערך');
  });
  it('restores by appending a full version and keeps all inherited history', () => {
    let state = createDemoState(); const original = currentVersion(state, patient, branch, 'formulation')!;
    state = editDocument(state, patient, branch, 'formulation', 'נוסח לבדיקה'); const count = state.versions.length;
    state = restoreVersion(state, original.id);
    expect(state.versions).toHaveLength(count + 1);
    expect(currentVersion(state, patient, branch, 'formulation')?.content).toBe(original.content);
    expect(state.versions.some(v => v.content === 'נוסח לבדיקה')).toBe(true);
  });
  it('limits main questions to three and each explicit intake block to two', () => {
    let { state, session } = active();
    for (let n = 0; n < 3; n++) state = applyTurn(state, session.id, state.sessions.at(-1)!.revision, question);
    expect(() => applyTurn(state, session.id, state.sessions.at(-1)!.revision, question)).toThrow('מספר השאלות');
    state = { ...state, sessions: state.sessions.map(s => s.id === session.id ? { ...s, intakeActive: true, intakeRound: 1 } : s) };
    for (let n = 0; n < 2; n++) state = applyTurn(state, session.id, state.sessions.at(-1)!.revision, question);
    expect(() => applyTurn(state, session.id, state.sessions.at(-1)!.revision, question)).toThrow('מספר השאלות');
  });
  it('produces all32 intake fields at5 and approval creates new versions', () => {
    let { state, session } = active(); state = addUserMessage(state, session.id, 'הפגישה הסתיימה.');
    const context = buildContext(state, session.id, 'draft'); state = saveDraft(state, session.id, context.baseRevision, preparedDraft(context));
    expect(currentVersion(state, patient, branch, 'intake')?.fields).toHaveLength(32);
    expect(currentVersion(state, patient, branch, 'intake')?.content).toContain('מידע חסר');
    const count = state.versions.length; state = approveSession(state, session.id);
    expect(state.versions.length).toBeGreaterThan(count);
    expect(state.sessions.find(s => s.id === session.id)?.status).toBe('approved');
  });
});
describe('archive boundaries', () => {
  it('round trips complete fixture and edited state without losing versions', () => {
    const { state, session } = active(); const changed = addUserMessage(state, session.id, 'טקסט בדיוני חדש');
    expect(importState(exportState(changed))).toEqual(changed);
  });
  it('rejects real-data flags and cross-patient source references', () => {
    const state = createDemoState(); const unsafe = structuredClone(state) as any; unsafe.patients[0].fictional = false;
    expect(() => importState(JSON.stringify(unsafe))).toThrow();
    state.versions[0].sourceIds = ['fictional-eitan-source-1'];
    expect(() => importState(exportState(state))).toThrow('מקור');
  });
});

describe('completed session and preference boundaries', () => {
  function clock(at: string) { vi.useFakeTimers(); vi.setSystemTime(new Date(`2026-10-16T${at}:00.000Z`)); }
  function completed() {
    clock('10:00'); let { state, session } = active();
    clock('10:01'); state = addUserMessage(state, session.id, 'Completed fictional session work.');
    clock('10:02'); const context = buildContext(state, session.id, 'draft');
    state = saveDraft(state, session.id, context.baseRevision, preparedDraft(context));
    clock('10:03'); state = approveSession(state, session.id);
    return { state, session: state.sessions.find(s => s.id === session.id)! };
  }
  it('retains work created after the session start in approved context and forks', () => {
    const { state, session } = completed();
    expect(session.closedAt).toBe('2026-10-16T10:03:00.000Z');
    expect(buildContext(state, session.id).documents.find(d => d.kind === 'note')?.content).toContain('Completed fictional');
    clock('10:04'); const sixth = createSession(state, patient, branch, 6);
    const fork = forkBranch(sixth.state, session.id, 'Completion boundary');
    const child = createSession(fork.state, patient, fork.branch.id, 6);
    expect(fork.branch.cutoffAt).toBe(session.closedAt);
    expect(buildContext(child.state, child.session.id).sources.some(s => s.text === 'Completed fictional session work.')).toBe(true);
    expect(buildContext(child.state, child.session.id).documents.find(d => d.kind === 'intake')?.versionId).toBe(currentVersion(state, patient, branch, 'intake')!.id);
  });
  it('recovers a legacy approved boundary from its own completed work', () => {
    const { state, session } = completed(); delete session.closedAt;
    expect(buildContext(state, session.id).asOf).toBe('2026-10-16T10:03:00.000Z');
    expect(buildContext(state, session.id).documents.some(d => d.kind === 'note')).toBe(true);
  });
  it('uses the instant before the next session for an unfinished historical session', () => {
    clock('10:00'); let { state, session } = active();
    clock('10:01'); state = addUserMessage(state, session.id, 'Earlier unfinished content');
    clock('10:02'); const context = buildContext(state, session.id); state = saveDraft(state, session.id, context.baseRevision, preparedDraft(context));
    clock('10:04'); state = createSession(state, patient, branch, 6).state;
    clock('10:05'); state = editDocument(state, patient, branch, 'formulation', 'Future between-session edit');
    const historical = buildContext(state, session.id);
    expect(historical.asOf).toBe('2026-10-16T10:03:59.999Z');
    expect(historical.documents.find(d => d.kind === 'note')?.content).toContain('Earlier unfinished content');
    expect(JSON.stringify(historical)).not.toContain('Future between-session edit');
  });
  it('blocks AI mutation of historical sessions without importing future intake fields', () => {
    clock('10:00'); const state = createDemoState(); const id = `${patient}-session-2`; const context = buildContext(state, id);
    const latestFields = currentVersion(state, patient, branch, 'intake')!.fields!;
    latestFields[0].value = 'Future-only intake value';
    const before = exportState(state);
    expect(() => saveDraft(state, id, context.baseRevision, preparedDraft(context))).toThrow('רצף חלופי');
    expect(() => applyTurn(state, id, context.baseRevision, question)).toThrow('רצף חלופי');
    expect(exportState(state)).toBe(before);
    expect(JSON.stringify(buildContext(state, id))).not.toContain('Future-only intake value');
  });
  it('retains the old boundary after historical note editing and clears it when reopening the latest note', () => {
    const { state, session } = completed();
    clock('10:04'); const following = createSession(state, patient, branch, 6);
    clock('10:05'); const changed = editDocument(following.state, patient, branch, 'note', 'Late historical note edit', undefined, session.id);
    expect(changed.sessions.find(s => s.id === session.id)?.closedAt).toBe(session.closedAt);
    expect(JSON.stringify(buildContext(changed, session.id))).not.toContain('Late historical note edit');
    const reopened = editDocument(state, patient, branch, 'note', 'Latest note reopened', undefined, session.id);
    expect(reopened.sessions.find(s => s.id === session.id)?.closedAt).toBeUndefined();
    expect(buildContext(reopened, session.id).documents.find(d => d.kind === 'note')?.content).toBe('Latest note reopened');
  });
  it('inherits dated patient preferences at a fork and excludes future parent or sibling preferences', () => {
    clock('10:00'); let { state, session } = active();
    clock('10:01'); state = applyTurn(state, session.id, session.revision, { ...question, preferenceUpdates: [{ topic: 'early', action: 'block', scope: 'patient' }] });
    expect(state.preferences[0].recordedAt).toBe('2026-10-16T10:01:00.000Z');
    clock('10:02'); const fork = forkBranch(state, session.id, 'Alternative'); const child = createSession(fork.state, patient, fork.branch.id, 6);
    clock('10:03'); const parent = createSession(child.state, patient, branch, 6);
    state = applyTurn(parent.state, parent.session.id, 0, { ...question, preferenceUpdates: [{ topic: 'future', action: 'block', scope: 'patient' }] });
    clock('10:04'); state = applyTurn(state, child.session.id, 0, { ...question, preferenceUpdates: [{ topic: 'child-only', action: 'less', scope: 'patient' }] });
    expect(buildContext(state, session.id).preferences.map(p => p.topic)).toEqual(['early']);
    expect(buildContext(state, child.session.id).preferences.map(p => p.topic)).toEqual(['early', 'child-only']);
    expect(buildContext(state, parent.session.id).preferences.map(p => p.topic)).toEqual(['early', 'future']);
    expect(importState(exportState(state))).toEqual(state);
  });
  it('freezes ancestor cutoffs through a second fork', () => {
    const { state, session } = completed(); clock('10:04');
    const first = forkBranch(state, session.id, 'first'); const child = createSession(first.state, patient, first.branch.id, 6);
    clock('10:05'); const updated = editDocument(child.state, patient, branch, 'formulation', 'Parent edit after fork');
    const second = forkBranch(updated, child.session.id, 'second'); const grandchild = createSession(second.state, patient, second.branch.id, 7);
    const context = buildContext(grandchild.state, grandchild.session.id);
    expect(context.branchScope.find(s => s.branchId === branch)?.cutoffAt).toBe(session.closedAt);
    expect(JSON.stringify(context)).not.toContain('Parent edit after fork');
  });
});

describe('intake report exclusions preserve the structured ledger', () => {
  it('redacts labels, literal values and remaining text in prepared and saved reports', () => {
    let { state, session } = active();
    const fields = currentVersion(state, patient, branch, 'intake')!.fields!;
    const updated = fields.map(f => f.id === 13 ? { ...f, value: 'Unique family detail', remaining: 'Unique family follow-up' }
      : f.id === 5 ? { ...f, value: 'Keep source value', remaining: 'private marker pending' } : f);
    state = editDocument(state, patient, branch, 'intake', '', updated);
    state.preferences.push({ id: 'exclude-family', patientId: patient, branchId: branch, sessionId: session.id, recordedAt: new Date().toISOString(), topic: 'משפחה', action: 'exclude', goal: 'intake', scope: 'patient' },
      { id: 'exclude-remaining', patientId: patient, branchId: branch, sessionId: session.id, recordedAt: new Date().toISOString(), topic: 'private marker', action: 'exclude', goal: 'intake', scope: 'session' });
    const context = buildContext(state, session.id); const result = preparedDraft(context);
    const prepared = result.documents.find(d => d.kind === 'intake')!.content;
    state = saveDraft(state, session.id, context.baseRevision, result);
    const saved = state.versions.filter(v => v.kind === 'intake' && v.sessionId === session.id).at(-1)!;
    for (const report of [prepared, saved.content]) {
      expect(report).not.toContain('Unique family'); expect(report).not.toContain('private marker'); expect(report).not.toContain('Keep source value');
      expect((report.match(/^### /gm) ?? []).length).toBe(32);
    }
    expect(saved.fields).toHaveLength(32);
    expect(saved.fields!.find(f => f.id === 13)?.value).toBe('Unique family detail');
    expect(saved.fields!.find(f => f.id === 5)?.remaining).toBe('private marker pending');
    expect(saved.proposal).toBe(true);
    expect(currentVersion(state, patient, branch, 'intake')!.author).toBe('clinician');
  });
  it('does not infer excluded topics from incidental word fragments', () => {
    const fields = emptyIntakeFields(); fields[4].value = 'מאבק עבודה';
    const report = renderIntakeReport(fields, [{ id: 'pref', topic: 'אב', action: 'exclude', scope: 'patient', goal: 'intake' }]);
    expect(report).toContain('מאבק עבודה');
  });
  it('applies an exclusion returned in the same turn as a structured field update', () => {
    let { state, session } = active(); state = addUserMessage(state, session.id, 'private marker');
    const context = buildContext(state, session.id);
    state = applyTurn(state, session.id, context.baseRevision, { ...question,
      preferenceUpdates: [{ topic: 'private marker', action: 'exclude', scope: 'patient', goal: 'intake' }],
      fieldUpdates: [{ id: 5, value: 'private marker', remaining: 'private marker', status: 'partial', sourceIds: [state.sources.at(-1)!.id] }],
    });
    const intake = currentVersion(state, patient, branch, 'intake')!;
    expect(intake.content).not.toContain('private marker');
    expect(intake.fields!.find(f => f.id === 5)?.value).toBe('private marker');
  });
});

describe('archive provenance validation', () => {
  it('allows an exported empty child branch while keeping a usable root session', () => {
    const fork = forkBranch(createDemoState(), `${patient}-session-2`, 'empty child');
    fork.state.branches.unshift(fork.state.branches.pop()!);
    expect(importState(exportState(fork.state))).toEqual(fork.state);
  });
  it('rejects a source from a sibling branch or a future ancestor time', () => {
    let { state, session } = active(); const fork = forkBranch(state, session.id, 'child');
    const child = createSession(fork.state, patient, fork.branch.id, 6); state = addUserMessage(child.state, child.session.id, 'Sibling source');
    state.versions.find(v => v.patientId === patient && v.kind === 'note')!.sourceIds = [state.sources.at(-1)!.id];
    expect(() => importState(exportState(state))).toThrow('מקור');
  });
  it('rejects an ancestor source that was recorded after the child fork cutoff', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
    const first = active(); const fork = forkBranch(first.state, first.session.id, 'child'); const child = createSession(fork.state, patient, fork.branch.id, 6);
    vi.setSystemTime(new Date('2026-10-16T10:01:00.000Z'));
    const state = editDocument(child.state, patient, branch, 'formulation', 'Late parent source');
    state.versions.push({ ...state.versions.at(-1)!, id: 'bad-child-version', branchId: fork.branch.id, sessionId: child.session.id, sessionNumber: 6, baseVersionId: undefined });
    expect(() => importState(exportState(state))).toThrow('מקור');
  });
  it('round trips a complete restored older cumulative version', () => {
    const state = createDemoState();
    const restored = restoreVersion(state, `${patient}-session-1-intake-v1`);
    expect(importState(exportState(restored))).toEqual(restored);
  });
  it('validates trace structure and owning session before the UI reads it', () => {
    let { state, session } = active(); const context = buildContext(state, session.id); const response = preparedDraft(context);
    state.sessions.find(s => s.id === session.id)!.traces.push({ id: 'trace', at: new Date().toISOString(), mode: 'prepared', model: 'prepared', promptVersion: 'test', prompt: 'test', context, response, elapsedMs: 1 });
    expect(importState(exportState(state))).toEqual(state);
    state = structuredClone(state); state.sessions.find(s => s.id === session.id)!.traces[0].context.branchId = 'unrelated';
    expect(() => importState(exportState(state))).toThrow('רישום');
  });
  it('rejects a malformed diagnostic document instead of letting it reach rendering', () => {
    const { state, session } = active();
    const unsafe = state as any;
    unsafe.sessions.find((s: any) => s.id === session.id).traces.push({ id: 'trace', at: new Date().toISOString(), mode: 'prepared', model: 'prepared', promptVersion: 'test', prompt: 'test', context: { ...buildContext(state, session.id), documents: [null] }, response: question, elapsedMs: 1 });
    expect(() => importState(exportState(state))).toThrow('רישום');
  });
});

describe('review regressions: reopening, exclusions and preference cancellation', () => {
  function clock(time: string) {
    vi.useFakeTimers(); vi.setSystemTime(new Date(`2026-10-16T${time}:00.000Z`));
  }
  it('includes new shared text immediately after reopening the latest approved session', () => {
    clock('10:00'); let { state, session } = active();
    clock('10:01'); state = addUserMessage(state, session.id, 'Original fictional description');
    let context = buildContext(state, session.id);
    state = saveDraft(state, session.id, context.baseRevision, preparedDraft(context));
    clock('10:02'); state = approveSession(state, session.id);
    const approved = currentVersion(state, patient, branch, 'note', session.id)!;
    clock('10:03'); state = addUserMessage(state, session.id, 'Fictional detail added after approval');
    context = buildContext(state, session.id, 'draft');
    expect(context.messages.at(-1)?.text).toBe('Fictional detail added after approval');
    expect(context.sources.some(s => s.text === 'Fictional detail added after approval')).toBe(true);
    expect(state.sessions.find(s => s.id === session.id)?.status).toBe('draft');
    expect(state.versions.find(v => v.id === approved.id)).toEqual(approved);
  });
  it('requires a branch before adding conversation text to a historical session', () => {
    const state = createDemoState(); const before = exportState(state);
    expect(() => addUserMessage(state, `${patient}-session-2`, 'Late fictional conversation')).toThrow('רצף חלופי');
    expect(exportState(state)).toBe(before);
  });
  it('redacts a Hebrew topic with an attached preposition without matching internal fragments', () => {
    const fields = emptyIntakeFields(); fields[15].value = 'עובדת בהוצאה לאור.';
    const preference = { id: 'pref', topic: 'הוצאה לאור', action: 'exclude' as const, scope: 'patient' as const, goal: 'intake' as const };
    expect(renderIntakeReport(fields, [preference])).not.toContain('עובדת בהוצאה לאור');
    fields[4].value = 'מאבק עבודה';
    expect(renderIntakeReport(fields, [{ ...preference, topic: 'אב' }])).toContain('מאבק עבודה');
  });
  it('keeps exclusions in a directly saved report while preserving its raw fields and source', () => {
    clock('10:00'); let { state, session } = active();
    state.preferences.push({ id: 'exclude-work', patientId: patient, branchId: branch, sessionId: session.id, recordedAt: new Date().toISOString(), topic: 'עבודה', action: 'exclude', goal: 'intake', scope: 'patient' });
    const context = buildContext(state, session.id, 'draft');
    state = saveDraft(state, session.id, context.baseRevision, preparedDraft(context));
    const fields = structuredClone(currentVersion(state, patient, branch, 'intake')!.fields!);
    fields[0].remaining = 'Unrelated fictional administrative update';
    clock('10:01'); state = editDocument(state, patient, branch, 'intake', '', fields);
    const edited = currentVersion(state, patient, branch, 'intake')!;
    expect(edited.content).not.toContain('עובדת בהוצאה לאור');
    expect(edited.fields!.find(f => f.id === 16)?.value).toBe('עובדת בהוצאה לאור.');
    expect(state.sources.at(-1)?.text).toContain('עובדת בהוצאה לאור.');
  });
  it('applies a cancellation only in its branch and descendants after the cancellation time', () => {
    clock('10:00'); let { state, session } = active();
    clock('10:01'); state = applyTurn(state, session.id, 0, { ...question, preferenceUpdates: [{ topic: 'private fictional topic', action: 'block', scope: 'patient' }] });
    const preference = state.preferences[0];
    clock('10:02'); const fork = forkBranch(state, session.id, 'Child'); const child = createSession(fork.state, patient, fork.branch.id, 6);
    clock('10:03'); const oldFork = forkBranch(child.state, child.session.id, 'Before cancellation'); const oldChild = createSession(oldFork.state, patient, oldFork.branch.id, 7);
    clock('10:04'); const cancelled = cancelPreference(oldChild.state, child.session.id, preference.id);
    expect(cancelled.preferences).toEqual(oldChild.state.preferences);
    expect(cancelled.sessions.find(s => s.id === child.session.id)!.revision).toBe(child.session.revision + 1);
    expect(buildContext(cancelled, child.session.id).preferences).toHaveLength(0);
    expect(buildContext(cancelled, session.id).preferences.map(p => p.id)).toEqual([preference.id]);
    expect(buildContext(cancelled, oldChild.session.id).preferences.map(p => p.id)).toEqual([preference.id]);
    clock('10:05'); const newFork = forkBranch(cancelled, child.session.id, 'After cancellation'); const newChild = createSession(newFork.state, patient, newFork.branch.id, 7);
    expect(buildContext(newChild.state, newChild.session.id).preferences).toHaveLength(0);
    expect(importState(exportState(newChild.state))).toEqual(newChild.state);
  });
  it('retains historical preferences after cancelling them in a later session of the same branch', () => {
    clock('10:00'); let { state, session } = active();
    clock('10:01'); state = applyTurn(state, session.id, 0, { ...question, preferenceUpdates: [{ topic: 'private fictional topic', action: 'block', scope: 'patient' }] });
    const preference = state.preferences[0];
    clock('10:02'); const next = createSession(state, patient, branch, 6);
    clock('10:03'); state = cancelPreference(next.state, next.session.id, preference.id);
    expect(buildContext(state, session.id).preferences.map(p => p.id)).toEqual([preference.id]);
    expect(buildContext(state, next.session.id).preferences).toHaveLength(0);
    expect(() => cancelPreference(state, session.id, preference.id)).toThrow('רצף חלופי');
    expect(() => cancelPreference(state, 'fictional-eitan-session-4', preference.id)).toThrow('אינה פעילה');
    const invalid = structuredClone(state);
    invalid.preferenceCancellations![0].patientId = 'fictional-eitan';
    expect(() => importState(exportState(invalid))).toThrow('ביטול');
  });
  it('preserves a current session exclusion across repeated direct intake saves', () => {
    clock('10:00'); let { state, session } = active();
    state.preferences.push({ id: 'session-exclusion', patientId: patient, branchId: branch, sessionId: session.id, recordedAt: new Date().toISOString(), topic: 'עבודה', action: 'exclude', goal: 'intake', scope: 'session' });
    for (const time of ['10:01', '10:02']) {
      clock(time);
      const fields = structuredClone(currentVersion(state, patient, branch, 'intake')!.fields!);
      fields[0].remaining = `Unrelated fictional update ${time}`;
      state = editDocument(state, patient, branch, 'intake', '', fields);
      expect(currentVersion(state, patient, branch, 'intake')!.content).not.toContain('עובדת בהוצאה לאור');
    }
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DraftResult, FieldStatus, Goal, PortalState, Preference, Session, TurnResult } from '../packages/contracts';
import { acceptProposal, addUserMessage, applyTurn, approveSession, buildContext, createPatient, createSession, currentVersion, editDocument, emptyIntakeFields, exportState, forkBranch, importState, pendingDraftIsCurrent, restoreVersion, rollbackExpansion, saveDraft, startIntakeCompletion } from '../packages/domain';
import { intakeCompletionFocus, intakeReadiness, isIntakeCompletionFocus } from '../packages/domain/intake-readiness';
import IntakeCompletion from '../apps/web/IntakeCompletion';
import { DocumentEditor } from '../apps/web/Documents';
import { clearEditorDrafts, editorDrafts, saveEditorDraft, writeEditorDraft } from '../apps/web/document-editing';
import { validateRequest } from '../apps/api/validation';
import { digest, issueToken } from '../apps/api/auth';
import { handleWorkspace } from '../apps/api/workspace';
import type { WorkspaceSnapshot, WorkspaceStore } from '../apps/api/workspace-store';

const get = (state: PortalState, id: string) => state.sessions.find(session => session.id === id)!;
function setup(number = 4) {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  const empty: PortalState = { schemaVersion: 1, patients: [], branches: [], sessions: [], sources: [], versions: [], preferences: [] };
  const created = createPatient(empty, { name: 'Fictional intake test' });
  vi.advanceTimersByTime(1000);
  return number === 1 ? created : { ...created, ...createSession(created.state, created.patient.id, created.branch.id, number) };
}
function field(state: PortalState, session: Session, id: number, status: FieldStatus, value = '', remaining = '') {
  vi.advanceTimersByTime(1);
  const fields = structuredClone(currentVersion(state, session.patientId, session.branchId, 'intake')?.fields ?? emptyIntakeFields());
  Object.assign(fields.find(item => item.id === id)!, { status, value, remaining });
  return editDocument(state, session.patientId, session.branchId, 'intake', '', fields, session.id);
}
const draft = (): DraftResult => ({ documents: ['note', 'formulation', 'intake', 'gold', 'supervision'].map(kind => ({ kind: kind as Goal, content: '', sourceIds: [] })), fieldUpdates: [], preferenceUpdates: [], summary: 'Fictional summary', rationale: 'Test', followUps: [] });
const question: TurnResult = { action: 'question', utterance: 'Which detail is known?', topic: 'test', rationale: 'Test', preferenceUpdates: [], fieldUpdates: [] };
afterEach(() => { vi.useRealTimers(); clearEditorDrafts(); });

describe('effective intake readiness', () => {
  it('recognizes a medical discussion block without blocking medication and respects skipped topics', () => {
    const { state, session } = setup();
    const context = buildContext(state, session.id);
    context.preferences.push({ id: 'medical-block', topic: 'מצב רפואי', action: 'block', scope: 'session', patientId: session.patientId, branchId: session.branchId, sessionId: session.id, recordedAt: context.asOf });
    const readiness = intakeReadiness(context);
    expect(readiness.gaps.find(gap => gap.field.id === 10)?.canDiscuss).toBe(false);
    expect(readiness.gaps.find(gap => gap.field.id === 11)?.canDiscuss).toBe(true);
    expect(isIntakeCompletionFocus(context, intakeCompletionFocus(10))).toBe(false);
    context.preferences = [];
    context.skippedTopics = ['מצב רפואי'];
    expect(intakeReadiness(context).gaps.find(gap => gap.field.id === 10)?.canDiscuss).toBe(false);
  });

  it.each([[3, false, 'early'], [4, true, 'approaching'], [5, true, 'due'], [6, true, 'overdue']] as const)('shows the appropriate panel in session %s', (number, visible, phase) => {
    const { state, session } = setup(number);
    const context = buildContext(state, session.id);
    expect(intakeReadiness(context)).toMatchObject({ visible, phase });
    const html = renderToStaticMarkup(createElement(IntakeCompletion, { context, disabled: false, historical: false, composer: '', onComposerChange() {}, onManual() {}, onDiscuss: () => true }));
    if (!visible) expect(html).toBe('');
    else { expect(html).toContain('32 נושאים פתוחים'); expect(html).toContain('למילוי ידני'); expect(html).toContain('אספר לעוזר והוא יארגן'); }
    if (number === 6) expect(html).toContain('השלמות שנותרו אחרי פגישה 5');
  });

  it('distinguishes every gap status from documented and not-applicable fields', () => {
    let { state, session } = setup();
    const statuses: FieldStatus[] = ['documented', 'not_applicable', 'unknown', 'partial', 'conflict', 'not_assessed', 'not_recalled'];
    for (const [index, status] of statuses.entries()) state = field(state, session, index + 1, status, status === 'unknown' ? '' : `Fictional ${status}`, status === 'partial' ? 'Specific missing detail' : '');
    const readiness = intakeReadiness(buildContext(state, session.id));
    expect(readiness.gaps.map(gap => gap.field.id)).not.toEqual(expect.arrayContaining([1, 2]));
    expect(readiness.gaps.filter(gap => gap.field.id <= 7).map(gap => gap.field.status)).toEqual(statuses.slice(2));
    expect(readiness.gaps.find(gap => gap.field.id === 4)?.field.remaining).toBe('Specific missing detail');
    expect(readiness.gaps.find(gap => gap.field.id === 7)?.canDiscuss).toBe(false);
  });

  it('merges pending fields and rejects stale draft claims after a direct edit', () => {
    let { state, session } = setup();
    state = field(state, session, 6, 'partial', 'Earlier clinician wording', 'Timing missing');
    vi.advanceTimersByTime(1);
    state = addUserMessage(state, session.id, 'Fictional newly supplied information');
    const sourceId = state.sources.at(-1)!.id;
    state = applyTurn(state, session.id, get(state, session.id).revision, { ...question, fieldUpdates: [{ id: 8, status: 'partial', value: 'Pending course', remaining: 'Onset', sourceIds: [sourceId] }] });
    state = saveDraft(state, session.id, get(state, session.id).revision, { ...draft(), fieldUpdates: [{ id: 6, status: 'documented', value: 'Proposed complete complaint', remaining: '', sourceIds: [sourceId] }] });
    let readiness = intakeReadiness(buildContext(state, session.id));
    expect(readiness.gaps.some(gap => gap.field.id === 6)).toBe(false);
    expect(readiness.fields.find(item => item.id === 8)?.value).toBe('Pending course');
    expect(readiness.hasPendingInformation).toBe(true);
    state = field(state, session, 6, 'partial', 'Later clinician correction', 'Still missing');
    const context = buildContext(state, session.id);
    expect(context.workingDraftMetadata?.stale).toBe(true);
    readiness = intakeReadiness(context);
    expect(readiness.gaps.find(gap => gap.field.id === 6)?.field.value).toBe('Later clinician correction');
    expect(readiness.fields.find(item => item.id === 8)?.value).toBe('Pending course');
    expect(pendingDraftIsCurrent(state, session.id)).toBe(false);
  });

  it('uses the scoped historical and fork context without later or other-patient facts', () => {
    let { state, session } = setup();
    state = field(state, session, 6, 'partial', 'Before cut-off', 'Duration');
    vi.advanceTimersByTime(1000);
    const later = createSession(state, session.patientId, session.branchId, 5); state = later.state;
    state = field(state, later.session, 6, 'documented', 'Future fact must not appear');
    const other = createPatient(state, { name: 'Other fictional case' }); state = field(other.state, other.session, 6, 'documented', 'Other patient must not appear');
    const historical = intakeReadiness(buildContext(state, session.id));
    expect(historical.fields.find(item => item.id === 6)?.value).toBe('Before cut-off');
    const fork = forkBranch(state, session.id, 'Fictional cutoff branch');
    const alternative = createSession(fork.state, session.patientId, fork.branch.id, 5);
    const scoped = intakeReadiness(buildContext(alternative.state, alternative.session.id));
    expect(scoped.fields.find(item => item.id === 6)?.value).toBe('Before cut-off');
    expect(JSON.stringify(scoped)).not.toMatch(/Future fact|Other patient/);
    expect(() => startIntakeCompletion(state, session.id, 6, get(state, session.id).revision)).toThrow('היסטורית');
  });

  it('applies exclusion, blocking, skip and lower priority before offering a discussion', () => {
    const { state, session } = setup();
    const pref = (id: string, topic: string, action: Preference['action'], goal?: Preference['goal']): Preference => ({ id, topic, action, scope: 'session', patientId: session.patientId, branchId: session.branchId, sessionId: session.id, recordedAt: new Date().toISOString(), ...(goal ? { goal } : {}) });
    state.preferences.push(pref('exclude', 'תרופות', 'exclude', 'intake'), pref('block', 'משפחה', 'block'), pref('less', 'עבודה', 'less'), pref('other-output', 'תלונת המטופל', 'exclude', 'note'));
    get(state, session.id).skippedTopics = ['סיכון'];
    const context = buildContext(state, session.id); const readiness = intakeReadiness(context);
    expect(readiness.gaps.some(gap => gap.field.id === 11)).toBe(false);
    expect(readiness.gaps.find(gap => gap.field.id === 13)?.canDiscuss).toBe(false);
    expect(readiness.gaps.find(gap => gap.field.id === 22)?.canDiscuss).toBe(false);
    expect(readiness.gaps.find(gap => gap.field.id === 6)?.canDiscuss).toBe(true);
    expect(readiness.gaps.at(-1)?.field.id).toBe(16);
    expect(isIntakeCompletionFocus(context, intakeCompletionFocus(13))).toBe(false);
    expect(() => startIntakeCompletion(state, session.id, 11, session.revision)).toThrow('אינו זמין');
    expect(() => startIntakeCompletion(state, session.id, 13, session.revision)).toThrow('אינו זמין');
    expect(() => startIntakeCompletion(state, session.id, 22, session.revision)).toThrow('אינו זמין');
  });

  it('does not import an out-of-context patch or a stale derivative when pending fields are absent', () => {
    const { state, session } = setup(); const context = buildContext(state, session.id);
    context.workingDraft = { ...draft(), fieldUpdates: [{ id: 6, value: 'Stale claim', status: 'documented', remaining: '', sourceIds: [] }] };
    context.workingDraftMetadata = { draftId: 'stale', createdAt: context.asOf, reviewRevision: 0, baseVersionIds: {}, stale: true, derivative: true };
    context.pendingIntakeFields = [{ id: 8, value: 'Foreign source', status: 'documented', sourceIds: ['not-in-context'] }];
    const readiness = intakeReadiness(context);
    expect(readiness.fields.find(item => item.id === 6)?.status).toBe('unknown');
    expect(readiness.fields.find(item => item.id === 8)?.status).toBe('unknown');
  });
});

describe('explicit intake completion and manual edits', () => {
  it('saves and reloads a panel round before any draft and after its selected field is filled', async () => {
    let { state, session } = setup();
    state = addUserMessage(state, session.id, 'Explicit fictional detail for the selected intake gap');
    state = startIntakeCompletion(state, session.id, 6, get(state, session.id).revision);
    const restored = importState(exportState(state));
    const context = buildContext(restored, session.id);
    expect(isIntakeCompletionFocus(context, context.focusSelection!)).toBe(true);
    expect(validateRequest({ requestId: 'panel-round', model: 'anthropic/claude-sonnet-5.5', context }, 'turn').context.focusSelection).toEqual(intakeCompletionFocus(6));

    const env = { DEMO_ACCESS_CODE_HASH: digest('fictional-intake-access'), SESSION_SECRET: 'fictional-intake-secret-more-than-32-characters' };
    let snapshot: WorkspaceSnapshot = { revision: 0, updatedAt: null, state: null };
    const store: WorkspaceStore = {
      async load() { return structuredClone(snapshot); },
      async save(_id, revision, saved) {
        if (revision !== snapshot.revision) return null;
        const version = { revision: revision + 1, updatedAt: new Date().toISOString() };
        snapshot = { ...version, state: structuredClone(saved) }; return version;
      },
    };
    const headers = { Authorization: `Bearer ${issueToken(env, Date.now()).token}`, 'Content-Type': 'application/json' };
    const put = await handleWorkspace(new Request('https://fictional.test/api/workspace', { method: 'PUT', headers, body: JSON.stringify({ expectedRevision: 0, state }) }), { env, store });
    expect(put.status).toBe(200);
    const loaded = await handleWorkspace(new Request('https://fictional.test/api/workspace', { headers }), { env, store });
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).state).toEqual(JSON.parse(exportState(state)));

    const sourceId = state.sources.at(-1)!.id;
    state = applyTurn(restored, session.id, get(restored, session.id).revision, { ...question,
      fieldUpdates: [{ id: 6, status: 'documented', value: 'Complete fictional complaint', remaining: '', sourceIds: [sourceId] }],
      preferenceUpdates: [{ topic: 'תלונת המטופל', action: 'block', scope: 'session' }],
    });
    expect(isIntakeCompletionFocus(buildContext(state, session.id), intakeCompletionFocus(6))).toBe(false);
    // A completed gap or new preference must not make already-valid saved state unreadable.
    expect(importState(exportState(state))).toEqual(JSON.parse(exportState(state)));
  });

  it('rejects forged panel focus labels and panel rounds before session four on import', () => {
    const { state, session } = setup();
    const started = startIntakeCompletion(state, session.id, 6, session.revision);
    const forged = structuredClone(started);
    get(forged, session.id).focusSelection!.text = 'Unvalidated arbitrary focus';
    expect(() => importState(exportState(forged))).toThrow('בחירת ההרחבה');
    const early = structuredClone(started); get(early, session.id).number = 3;
    expect(() => importState(exportState(early))).toThrow('בחירת ההרחבה');
  });

  it('keeps main-question count, limits the voluntary round and retains input on cancellation', () => {
    let { state, session } = setup();
    get(state, session.id).questionCount = 3;
    state = addUserMessage(state, session.id, 'New fictional detail supplied explicitly');
    const previous = structuredClone(get(state, session.id));
    const started = startIntakeCompletion(state, session.id, 6, previous.revision);
    expect(get(started, session.id)).toMatchObject({ intakeActive: true, intakeCount: 0, intakeRound: 1, questionCount: 3, focusGoal: 'intake', focusSelection: intakeCompletionFocus(6) });
    expect(isIntakeCompletionFocus(buildContext(started, session.id), intakeCompletionFocus(6))).toBe(true);
    let answered = applyTurn(started, session.id, get(started, session.id).revision, question);
    answered = applyTurn(answered, session.id, get(answered, session.id).revision, question);
    expect(() => applyTurn(answered, session.id, get(answered, session.id).revision, question)).toThrow('מספר השאלות');
    const cancelled = rollbackExpansion(started, session.id, get(started, session.id).revision, previous);
    expect(get(cancelled, session.id).messages).toEqual(previous.messages);
    expect(get(cancelled, session.id)).toMatchObject({ intakeActive: false, intakeRound: 1, questionCount: 3 });
    expect(cancelled.sources).toEqual(state.sources);
    expect(() => startIntakeCompletion(cancelled, session.id, 6, previous.revision)).toThrow();
    get(cancelled, session.id).intakeRound = 10;
    expect(() => startIntakeCompletion(cancelled, session.id, 6, get(cancelled, session.id).revision)).toThrow('מספר ההרחבות');
  });

  it('reopens an approved current intake edit and offers explicit manual approval without AI', () => {
    let { state, session } = setup(5);
    state = editDocument(state, session.patientId, session.branchId, 'note', 'Fictional note', undefined, session.id);
    state = field(state, session, 6, 'partial', 'Known complaint', 'Timing');
    state = approveSession(state, session.id);
    const oldVersion = currentVersion(state, session.patientId, session.branchId, 'intake')!;
    vi.advanceTimersByTime(1000);
    state = field(state, session, 6, 'documented', 'Manually completed complaint');
    expect(get(state, session.id)).toMatchObject({ status: 'draft', closedAt: undefined });
    expect(intakeReadiness(buildContext(state, session.id)).gaps.some(gap => gap.field.id === 6)).toBe(false);
    expect(state.versions.find(version => version.id === oldVersion.id)).toEqual(oldVersion);
    const html = renderToStaticMarkup(createElement(DocumentEditor, { state, update: () => true, patientId: session.patientId, branchId: session.branchId, kind: 'note', sessionId: session.id, notify() {} }));
    expect(html).toContain('אישור העדכונים הידניים');
    state = approveSession(state, session.id);
    expect(get(state, session.id).status).toBe('approved');
    expect(currentVersion(state, session.patientId, session.branchId, 'intake')?.approved).toBe(true);
    expect(importState(exportState(state))).toEqual(JSON.parse(exportState(state)));
  });

  it('rejects a stale manual intake buffer without discarding it or accepting an old draft', () => {
    let { state, session } = setup(); state = field(state, session, 6, 'partial', 'Original text');
    state = saveDraft(state, session.id, get(state, session.id).revision, draft());
    const current = currentVersion(state, session.patientId, session.branchId, 'intake')!;
    const key = `${session.patientId}/${session.branchId}/intake/${session.id}`;
    const fields = structuredClone(current.fields!); fields[5].value = 'Unsaved manual change';
    writeEditorDraft(key, { text: current.content, fields, baseVersionId: current.id });
    state = field(state, session, 6, 'partial', 'Intervening clinician change');
    expect(() => saveEditorDraft(state, key, session.patientId, session.branchId, 'intake', session.id)).toThrow('המסמך השתנה');
    expect(editorDrafts.get(key)?.fields[5].value).toBe('Unsaved manual change');
    expect(pendingDraftIsCurrent(state, session.id)).toBe(false);
    expect(() => approveSession(state, session.id)).toThrow();
  });

  it('does not offer a no-op approval before the session note exists', () => {
    let { state, session } = setup(5);
    state = field(state, session, 6, 'documented', 'Fictional intake detail before any note');
    const html = renderToStaticMarkup(createElement(DocumentEditor, { state, update: () => true, patientId: session.patientId, branchId: session.branchId, kind: 'note', sessionId: session.id, notify() {} }));
    expect(html).not.toContain('אישור העדכונים הידניים');
  });

  it.each(['restore', 'accept'] as const)('%s intake reopens its current owner and preserves a prior fork cutoff', operation => {
    let { state, session } = setup(4);
    state = editDocument(state, session.patientId, session.branchId, 'note', 'Fictional session four', undefined, session.id);
    state = field(state, session, 6, 'partial', 'Fictional intake A', 'Timing missing');
    state = approveSession(state, session.id);
    const original = currentVersion(state, session.patientId, session.branchId, 'intake')!;
    vi.advanceTimersByTime(1000);
    const fifth = createSession(state, session.patientId, session.branchId, 5); state = fifth.state;
    state = editDocument(state, session.patientId, session.branchId, 'note', 'Fictional session five', undefined, fifth.session.id);
    state = field(state, fifth.session, 6, 'documented', 'Fictional complete intake B');
    state = approveSession(state, fifth.session.id);
    const approved = currentVersion(state, session.patientId, session.branchId, 'intake')!;
    const fork = forkBranch(state, fifth.session.id, 'Before intake replacement');
    vi.advanceTimersByTime(1000);
    const child = createSession(fork.state, session.patientId, fork.branch.id, 6); state = child.state;
    vi.advanceTimersByTime(1000);
    if (operation === 'restore') state = restoreVersion(state, original.id);
    else {
      state.versions.push({ ...structuredClone(original), id: 'fictional-intake-proposal', sessionId: fifth.session.id, sessionNumber: 5,
        author: 'assistant', approved: false, proposal: true, baseVersionId: approved.id, createdAt: new Date().toISOString() });
      state = acceptProposal(state, 'fictional-intake-proposal');
    }
    const latest = currentVersion(state, session.patientId, session.branchId, 'intake')!;
    expect(latest).toMatchObject({ sessionId: fifth.session.id, approved: false, author: 'clinician' });
    expect(get(state, fifth.session.id)).toMatchObject({ status: 'draft', closedAt: undefined });
    expect(get(state, session.id).status).toBe('approved');
    const context = buildContext(state, fifth.session.id);
    expect(context.documents.find(document => document.kind === 'intake')?.versionId).toBe(latest.id);
    expect(intakeReadiness(context).gaps.find(gap => gap.field.id === 6)?.field.value).toBe('Fictional intake A');
    expect(intakeReadiness(buildContext(state, child.session.id)).fields.find(item => item.id === 6)?.value).toBe('Fictional complete intake B');
    expect(state.versions.find(version => version.id === approved.id)).toEqual(approved);
    expect(importState(exportState(state))).toEqual(JSON.parse(exportState(state)));
  });

  it.each(['restore', 'accept'] as const)('%s intake keeps an historical owner closed and its old context intact', operation => {
    let { state, session } = setup(5);
    state = editDocument(state, session.patientId, session.branchId, 'note', 'Fictional session five', undefined, session.id);
    state = field(state, session, 6, 'partial', 'Fictional earlier intake', 'Timing missing');
    const original = currentVersion(state, session.patientId, session.branchId, 'intake')!;
    state = field(state, session, 6, 'documented', 'Fictional closed intake');
    state = approveSession(state, session.id);
    const approved = currentVersion(state, session.patientId, session.branchId, 'intake')!;
    const closedAt = get(state, session.id).closedAt;
    vi.advanceTimersByTime(1000);
    const later = createSession(state, session.patientId, session.branchId, 6); state = later.state;
    vi.advanceTimersByTime(1000);
    if (operation === 'restore') state = restoreVersion(state, original.id);
    else {
      state.versions.push({ ...structuredClone(original), id: 'fictional-historical-intake-proposal', author: 'assistant', approved: false,
        proposal: true, baseVersionId: approved.id, createdAt: new Date().toISOString() });
      state = acceptProposal(state, 'fictional-historical-intake-proposal');
    }
    expect(get(state, session.id)).toMatchObject({ status: 'approved', closedAt });
    expect(buildContext(state, session.id).documents.find(document => document.kind === 'intake')?.versionId).toBe(approved.id);
    expect(intakeReadiness(buildContext(state, session.id)).gaps.some(gap => gap.field.id === 6)).toBe(false);
    expect(intakeReadiness(buildContext(state, later.session.id)).gaps.find(gap => gap.field.id === 6)?.field.value).toBe('Fictional earlier intake');
    expect(importState(exportState(state))).toEqual(JSON.parse(exportState(state)));
  });
});

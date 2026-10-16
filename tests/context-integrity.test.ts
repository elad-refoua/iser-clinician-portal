import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { preparedDraft } from '../fixtures/fictional/prepared';
import { TEXT_LIMITS, type DraftResult, type PortalState, type TurnResult } from '../packages/contracts';
import { addUserMessage, advanceRequestRevision, applyTurn, approveSession, buildContext, compactModelContext, createSession, currentVersion, editDocument, exportState, importState, pendingDraftIsCurrent, restoreVersion, rollbackExpansion, saveDraft, startExpansion } from '../packages/domain';
import { normalizeWireResult, responseSchema, validateRequest, validateResult } from '../apps/api/validation';

const patient = 'fictional-tamar';
const branch = `${patient}-main`;
const model = 'anthropic/claude-sonnet-5.5';
const getSession = (state: PortalState, id: string) => state.sessions.find(session => session.id === id)!;
function active() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
  const result = createSession(createDemoState(), patient, branch, 5);
  return { ...result, state: addUserMessage(result.state, result.session.id, 'Artificial source for context integrity checks.') };
}
function draft(state: PortalState, sessionId: string): DraftResult {
  return { ...preparedDraft(buildContext(state, sessionId, 'draft')), fieldUpdates: [], summary: 'Artificial summary', followUps: [], preferenceUpdates: [] };
}
function request(state: PortalState, sessionId: string) {
  return { requestId: 'context-integrity', model, context: compactModelContext(buildContext(state, sessionId, 'draft')) };
}
afterEach(() => vi.useRealTimers());

describe('manual document and intake integrity', () => {
  it('keeps restored intake values when an older unapproved AI patch exists', () => {
    let { state, session } = active();
    const original = currentVersion(state, patient, branch, 'intake')!;
    const originalValue = original.fields!.find(field => field.id === 5)!.value;
    const turn: TurnResult = { action: 'draft', utterance: 'Draft now.', topic: '', rationale: 'Artificial test', preferenceUpdates: [],
      fieldUpdates: [{ id: 5, value: 'Superseded AI value', status: 'partial', remaining: '', sourceIds: [state.sources.at(-1)!.id] }] };
    state = applyTurn(state, session.id, getSession(state, session.id).revision, turn);
    state = saveDraft(state, session.id, getSession(state, session.id).revision, draft(state, session.id));
    vi.advanceTimersByTime(1);
    state = restoreVersion(state, original.id);
    expect(getSession(state, session.id).pendingFields).toEqual([]);
    expect(pendingDraftIsCurrent(state, session.id)).toBe(false);
    state = saveDraft(state, session.id, getSession(state, session.id).revision, draft(state, session.id));
    expect(getSession(state, session.id).pendingDraft!.fields.find(field => field.id === 5)!.value).toBe(originalValue);
    state = approveSession(state, session.id);
    expect(currentVersion(state, patient, branch, 'intake')!.fields!.find(field => field.id === 5)!.value).toBe(originalValue);
    expect(importState(exportState(state))).toEqual(state);
  });

  it('accepts archive-valid historical manual text and field values in live context', () => {
    let { state, session } = active();
    state = editDocument(state, patient, branch, 'note', 'x'.repeat(16_000), undefined, session.id);
    expect(state.sources.at(-1)!.text.length).toBeGreaterThan(16_000);
    expect(validateRequest(request(state, session.id), 'draft').context.sources.at(-1)!.text).toBe(state.sources.at(-1)!.text);
    state = editDocument(state, patient, branch, 'note', 'Short replacement', undefined, session.id);
    const fields = structuredClone(currentVersion(state, patient, branch, 'intake')!.fields!);
    fields.find(field => field.id === 5)!.value = 'y'.repeat(5_001);
    state = editDocument(state, patient, branch, 'intake', '', fields);
    expect(validateRequest(request(state, session.id), 'draft').context.documents.find(doc => doc.kind === 'intake')!.fields!.find(field => field.id === 5)!.value).toHaveLength(5_001);
    expect(importState(exportState(state))).toEqual(state);
  });

  it('rejects invalid direct edits before changing any source or version', () => {
    const { state, session } = active(); const before = exportState(state);
    expect(() => editDocument(state, patient, branch, 'note', 'x'.repeat(100_000), undefined, session.id)).toThrow('תווים');
    const fields = structuredClone(currentVersion(state, patient, branch, 'intake')!.fields!);
    fields[0].value = 'x'.repeat(TEXT_LIMITS.fieldValue + 1);
    expect(() => editDocument(state, patient, branch, 'intake', '', fields)).toThrow('מגבלות');
    fields[0].value = '';
    for (const field of fields.slice(0, 4)) field.value = 'x'.repeat(TEXT_LIMITS.fieldValue);
    expect(() => editDocument(state, patient, branch, 'intake', '', fields)).toThrow('100,000');
    expect(exportState(state)).toBe(before);
    expect(importState(exportState(state))).toEqual(state);
  });

  it('rejects a save against a replaced document base without losing the competing version', () => {
    const { state, session } = active();
    const first = editDocument(state, patient, branch, 'note', 'First edit', undefined, session.id, null);
    const base = currentVersion(first, patient, branch, 'note', session.id)!;
    const changed = editDocument(first, patient, branch, 'note', 'Competing edit', undefined, session.id, base.id);
    expect(() => editDocument(changed, patient, branch, 'note', 'Stale editor', undefined, session.id, base.id)).toThrow('המסמך השתנה');
    expect(currentVersion(changed, patient, branch, 'note', session.id)!.content).toBe('Competing edit');
  });

  it('rejects a cumulative AI intake report beyond the archive bound without replacing the prior state', () => {
    let { state, session } = active();
    const fields = structuredClone(currentVersion(state, patient, branch, 'intake')!.fields!);
    for (const field of fields.slice(0, 3)) field.value = 'x'.repeat(29_000);
    state = editDocument(state, patient, branch, 'intake', '', fields);
    const before = exportState(state); const result = draft(state, session.id);
    result.fieldUpdates = [10, 11, 12].map(id => ({ id, value: 'y'.repeat(5_000), status: 'partial', remaining: '', sourceIds: [state.sources.at(-1)!.id] }));
    expect(() => saveDraft(state, session.id, getSession(state, session.id).revision, result)).toThrow('100,000');
    expect(exportState(state)).toBe(before);
    expect(importState(before)).toEqual(state);
  });
});

describe('context provenance and compatible traces', () => {
  it('identifies clinician edits and stale derivative proposals while preserving edit targets', () => {
    let { state, session } = active();
    state = saveDraft(state, session.id, getSession(state, session.id).revision, draft(state, session.id));
    const pending = getSession(state, session.id).pendingDraft!;
    expect(buildContext(state, session.id).workingDraftMetadata).toMatchObject({ draftId: pending.id, derivative: true, stale: false });
    vi.advanceTimersByTime(1);
    state = editDocument(state, patient, branch, 'formulation', 'Clinician wording');
    const context = request(state, session.id).context;
    expect(context.documents.find(doc => doc.kind === 'formulation')).toMatchObject({ author: 'clinician', approved: false, createdAt: new Date().toISOString(), reason: 'עריכה ישירה של המטפל' });
    expect(context.workingDraftMetadata).toMatchObject({ draftId: pending.id, stale: true, reviewRevision: pending.reviewRevision, baseVersionIds: pending.baseVersionIds });
    expect(context.workingDraft!.summary).toBe(pending.result.summary);
    expect(context.workingDraft!.rationale).toBe(pending.result.rationale);
    validateRequest({ requestId: 'provenance', model, context }, 'draft');
    getSession(state, session.id).traces.push({ id: 'provenance-trace', at: new Date().toISOString(), mode: 'live', model, promptVersion: 'test', prompt: 'test', context, response: draft(state, session.id), elapsedMs: 1 });
    expect(importState(exportState(state))).toEqual(state);
    const legacy = structuredClone(state);
    const legacyContext = getSession(legacy, session.id).traces[0].context;
    delete legacyContext.workingDraftMetadata;
    for (const doc of legacyContext.documents) { delete doc.author; delete doc.approved; delete doc.createdAt; delete doc.reason; }
    delete legacyContext.workingDraft!.preferenceUpdates;
    expect(importState(exportState(legacy))).toEqual(legacy);
  });
});

describe('preferences returned directly by drafting', () => {
  it('applies draft preferences before intake rendering and records the same approval snapshot', () => {
    let { state, session } = active();
    const result = draft(state, session.id);
    result.preferenceUpdates = [{ topic: 'עבודה', action: 'exclude', scope: 'session', goal: 'intake' }];
    state = saveDraft(state, session.id, getSession(state, session.id).revision, result);
    const pending = getSession(state, session.id).pendingDraft!;
    expect(pending.preferenceSnapshot).toEqual(buildContext(state, session.id).preferences);
    expect(pending.result.documents.find(doc => doc.kind === 'intake')!.content).toContain('תוכן השדה הוחרג');
    expect(pending.fields.find(field => field.id === 5)!.value).toContain('העבודה');
    expect(pendingDraftIsCurrent(state, session.id)).toBe(true);
    state = approveSession(state, session.id);
    expect(importState(exportState(state))).toEqual(state);
    state = addUserMessage(state, session.id, 'Another artificial edit');
    state = saveDraft(state, session.id, getSession(state, session.id).revision, { ...draft(state, session.id), preferenceUpdates: result.preferenceUpdates });
    expect(state.preferences.filter(preference => preference.topic === 'עבודה')).toHaveLength(1);
  });

  it('requires live draft preferences, normalizes null goals and checks same-result exclusions', () => {
    const { state, session } = active(); const context = buildContext(state, session.id, 'draft');
    const result: DraftResult = { ...draft(state, session.id), documents: draft(state, session.id).documents.map(doc => ({ ...doc, content: '', sourceIds: [] })) };
    expect(() => validateResult({ ...result, preferenceUpdates: undefined }, 'draft', context)).toThrow('invalid_model_output');
    const wire = { ...result, preferenceUpdates: [{ topic: 'Artificial topic', action: 'block', scope: 'session', goal: null }] };
    expect((validateResult(normalizeWireResult(wire), 'draft', context) as DraftResult).preferenceUpdates![0]).not.toHaveProperty('goal');
    const excluded = { ...result, preferenceUpdates: [{ topic: 'excluded marker', action: 'exclude' as const, scope: 'session' as const, goal: 'note' as const }] };
    excluded.documents.find(doc => doc.kind === 'note')!.content = 'The excluded marker is here';
    expect(() => validateResult(excluded, 'draft', context)).toThrow('excluded_topic_in_output');
    const blocked = { ...result, preferenceUpdates: [{ topic: 'blocked marker', action: 'block' as const, scope: 'patient' as const }], followUps: [{ goal: 'intake' as const, text: 'Expand on blocked marker', kind: 'expand' as const, fieldIds: [] }] };
    expect(() => validateResult(blocked, 'draft', context)).toThrow('blocked_question_topic');
    const schema = responseSchema('draft') as { required: string[]; properties: Record<string, any> };
    expect(schema.required).toContain('preferenceUpdates');
    expect(schema.properties.preferenceUpdates.items.required).toContain('goal');
  });
});

describe('cancelled expansion recovery', () => {
  function reviewing() {
    const initial = active();
    const state = saveDraft(initial.state, initial.session.id, getSession(initial.state, initial.session.id).revision, draft(initial.state, initial.session.id));
    return { state, previous: structuredClone(getSession(state, initial.session.id)) };
  }
  it('restores the reviewed proposal after an untouched cancellation with monotonic revisions', () => {
    const { state, previous } = reviewing();
    const expanded = startExpansion(state, previous.id, 'intake');
    const revision = getSession(expanded, previous.id).revision;
    const cancelled = rollbackExpansion(expanded, previous.id, revision, previous);
    const session = getSession(cancelled, previous.id);
    expect(session).toMatchObject({ status: 'draft', intakeActive: false, intakeRound: (previous.intakeRound ?? 0) + 1, revision: revision + 1 });
    expect(getSession(startExpansion(cancelled, session.id, 'intake'), session.id).intakeRound).toBe((previous.intakeRound ?? 0) + 2);
    expect(pendingDraftIsCurrent(cancelled, session.id)).toBe(true);
    expect(() => approveSession(cancelled, session.id, previous.pendingDraft!.id)).not.toThrow();
    expect(importState(exportState(cancelled))).toEqual(JSON.parse(exportState(cancelled)));
  });
  it('does not undo a model result or an intervening unsent edit', () => {
    const { state, previous } = reviewing();
    const expanded = startExpansion(state, previous.id, 'intake'); const revision = getSession(expanded, previous.id).revision;
    const reply: TurnResult = { action: 'question', utterance: 'What happened?', topic: 'event', rationale: 'test', fieldUpdates: [], preferenceUpdates: [] };
    const answered = applyTurn(expanded, previous.id, revision, reply);
    expect(rollbackExpansion(answered, previous.id, revision, previous)).toBe(answered);
    const edited = structuredClone(expanded); getSession(edited, previous.id).composer = 'Keep this unsent edit';
    expect(rollbackExpansion(edited, previous.id, revision, previous)).toBe(edited);
  });
  it('keeps expansion cancellation safe after a server revision rebase', () => {
    const { state, previous } = reviewing();
    const expanded = startExpansion(state, previous.id, 'intake');
    const rebased = advanceRequestRevision(expanded, previous.id, getSession(expanded, previous.id).revision, 50);
    expect(pendingDraftIsCurrent(rebased, previous.id)).toBe(false);
    const cancelled = rollbackExpansion(rebased, previous.id, 50, previous);
    expect(getSession(cancelled, previous.id)).toMatchObject({ revision: 51, status: 'draft', intakeActive: false, intakeRound: 1 });
    expect(pendingDraftIsCurrent(cancelled, previous.id)).toBe(true);
    expect(importState(exportState(cancelled))).toEqual(JSON.parse(exportState(cancelled)));
    const changed = addUserMessage(rebased, previous.id, 'Intervening information must remain');
    expect(rollbackExpansion(changed, previous.id, 50, previous)).toBe(changed);
  });
  it('does not make an old proposal approvable when an ordinary request revision advances', () => {
    const { state, previous } = reviewing();
    const rebased = advanceRequestRevision(state, previous.id, previous.revision, 50);
    expect(getSession(rebased, previous.id).pendingDraft).toEqual(previous.pendingDraft);
    expect(pendingDraftIsCurrent(rebased, previous.id)).toBe(false);
    expect(() => approveSession(rebased, previous.id, previous.pendingDraft!.id)).toThrow();
    expect(() => advanceRequestRevision(state, previous.id, previous.revision + 1, 50)).toThrow();
    expect(() => advanceRequestRevision(state, previous.id, previous.revision, previous.revision)).toThrow();
  });
  it('does not restore approval eligibility when preferences changed independently', () => {
    const { state, previous } = reviewing();
    const expanded = startExpansion(state, previous.id, 'intake'); const revision = getSession(expanded, previous.id).revision;
    expanded.preferences.push({ id: 'new-exclusion', patientId: patient, branchId: branch, sessionId: previous.id, recordedAt: new Date().toISOString(), topic: 'new topic', action: 'exclude', scope: 'session', goal: 'note' });
    const cancelled = rollbackExpansion(expanded, previous.id, revision, previous);
    expect(pendingDraftIsCurrent(cancelled, previous.id)).toBe(false);
  });
});

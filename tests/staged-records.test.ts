import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { preparedDraft } from '../fixtures/fictional/prepared';
import type { DraftResult, FieldUpdate, PortalState, TurnResult } from '../packages/contracts';
import { acceptProposal, addUserMessage, applyTurn, approveSession, buildContext, cancelPreference, createSession, currentVersion, editDocument, exportState, forkBranch, importState, pendingDraftIsCurrent, saveDraft, startExpansion } from '../packages/domain';
import { responseSchema, validateRequest, validateResult } from '../apps/api/validation';

const patient = 'fictional-tamar';
const branch = `${patient}-main`;
const question: TurnResult = { action: 'question', utterance: 'איך תמר הגיבה כשהתעכבתם על השתיקה שתיארת?', topic: 'תגובה לשתיקה', rationale: 'השלמת התיאור שנמסר.', fieldUpdates: [], preferenceUpdates: [] };
function active() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
  const created = createSession(createDemoState(), patient, branch, 5);
  return { ...created, state: addUserMessage(created.state, created.session.id, 'תיאור מלאכותי לבדיקה: תמר שתקה לאחר שיחה על העבודה.') };
}
function session(state: PortalState, id: string) { return state.sessions.find(s => s.id === id)!; }
function field(state: PortalState, id: number, value: string): FieldUpdate { return { id, value, status: 'partial', remaining: 'נדרש בירור בהמשך', sourceIds: [state.sources.at(-1)!.id] }; }
function draft(state: PortalState, id: string, updates: FieldUpdate[] = []): DraftResult {
  const result = preparedDraft(buildContext(state, id, 'draft'));
  return { ...result, fieldUpdates: updates, summary: 'הוכנה רשומת הפגישה ועדכון להמשגה.', followUps: [{ goal: 'intake', text: 'אפשר להשלים את הרקע הרפואי.', kind: 'expand', fieldIds: [10] }] };
}
afterEach(() => vi.useRealTimers());

describe('clinical records require a reviewed approval', () => {
  it('stages extracted facts and a full draft without changing any clinical document', () => {
    let { state, session: s } = active(); const before = structuredClone(state.versions);
    state = applyTurn(state, s.id, session(state, s.id).revision, { ...question, fieldUpdates: [field(state, 5, 'עובדה ממתינה')] });
    expect(state.versions).toEqual(before);
    expect(buildContext(state, s.id).pendingIntakeFields?.find(f => f.id === 5)?.value).toBe('עובדה ממתינה');
    expect(buildContext(state, s.id).documents.find(d => d.kind === 'intake')?.fields?.find(f => f.id === 5)?.value).not.toBe('עובדה ממתינה');
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    expect(state.versions).toEqual(before);
    expect(currentVersion(state, patient, branch, 'note', s.id)).toBeUndefined();
    const pending = session(state, s.id).pendingDraft!;
    expect(pending.fields).toHaveLength(32);
    expect(pending.fields.find(f => f.id === 5)?.value).toBe('עובדה ממתינה');
    expect(buildContext(state, s.id).workingDraft).toEqual(pending.result);
    expect(importState(exportState(state))).toEqual(state);
    state = approveSession(state, s.id, pending.id);
    expect(state.versions.slice(0, before.length)).toEqual(before);
    expect(state.versions.slice(before.length)).toHaveLength(5);
    expect(state.versions.slice(before.length).every(v => v.approved && v.author === 'assistant')).toBe(true);
    expect(currentVersion(state, patient, branch, 'intake')!.fields!.find(f => f.id === 5)?.value).toBe('עובדה ממתינה');
    expect(session(state, s.id).pendingDraft).toBeUndefined();
    expect(session(state, s.id).pendingFields).toEqual([]);
    expect(session(state, s.id).draftHistory).toEqual([{ ...pending, approvedAt: session(state, s.id).closedAt, approvedVersionIds: state.versions.slice(before.length).map(v => v.id) }]);
    expect(buildContext(state, s.id).workingDraft).toBeUndefined();
    expect(importState(exportState(state))).toEqual(state);
  });

  it('preserves extracted facts across regeneration and keeps the full previous review', () => {
    let { state, session: s } = active();
    state = applyTurn(state, s.id, session(state, s.id).revision, { ...question, fieldUpdates: [field(state, 5, 'פרט ראשון')] });
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    const first = structuredClone(session(state, s.id).pendingDraft!);
    vi.advanceTimersByTime(1000);
    state = addUserMessage(state, s.id, 'תוספת בדיונית אחרת לצורך הבדיקה בלבד.');
    const next = draft(state, s.id, [field(state, 10, 'פרט נוסף')]);
    next.documents.find(d => d.kind === 'note')!.content = 'רשומה מתוקנת לאחר התוספת';
    state = saveDraft(state, s.id, session(state, s.id).revision, next);
    const pending = session(state, s.id).pendingDraft!;
    expect(pending.fields.find(f => f.id === 5)?.value).toBe('פרט ראשון');
    expect(pending.fields.find(f => f.id === 10)?.value).toBe('פרט נוסף');
    expect(session(state, s.id).draftHistory).toEqual([first]);
    expect(pending.result.summary).toBe(next.summary);
    expect(pending.result.followUps).toEqual(next.followUps);
    const before = exportState(state);
    expect(() => approveSession(state, s.id, first.id)).toThrow('הטיוטה השתנתה');
    expect(exportState(state)).toBe(before);
    const approved = approveSession(state, s.id, pending.id);
    expect(currentVersion(approved, patient, branch, 'note', s.id)?.content).toBe('רשומה מתוקנת לאחר התוספת');
    expect(importState(exportState(approved))).toEqual(approved);
  });

  it('rejects an approval after more conversation even if document bases did not change', () => {
    let { state, session: s } = active();
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    const pending = session(state, s.id).pendingDraft!;
    state = addUserMessage(state, s.id, 'מידע בדיוני נוסף שלא נכלל בסיכום.');
    expect(buildContext(state, s.id).workingDraft).toEqual(pending.result);
    const before = exportState(state);
    expect(() => approveSession(state, s.id, pending.id)).toThrow('הטיוטה השתנתה');
    expect(exportState(state)).toBe(before);
  });

  it('does not drop unreviewed extracted facts through the legacy direct-note approval path', () => {
    let { state, session: s } = active();
    state = applyTurn(state, s.id, session(state, s.id).revision, { ...question, fieldUpdates: [field(state, 5, 'מידע שטרם נבדק')] });
    state = editDocument(state, patient, branch, 'note', 'רשומה שהמטפל ערך ישירות', undefined, s.id);
    expect(() => approveSession(state, s.id)).toThrow('מידע שטרם נכלל');
    expect(importState(exportState(state))).toEqual(state);
    expect(session(state, s.id).pendingFields?.find(f => f.id === 5)?.value).toBe('מידע שטרם נבדק');
  });

  it('preserves a direct clinician edit and blocks both stale revisions and stale document bases', () => {
    let { state, session: s } = active();
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    const pending = session(state, s.id).pendingDraft!;
    state = editDocument(state, patient, branch, 'formulation', 'עריכה מפורשת של המטפל לאחר הטיוטה');
    expect(() => approveSession(state, s.id, pending.id)).toThrow('הטיוטה השתנתה');
    // A revision check alone is insufficient: a competing document can arrive independently.
    const forged = structuredClone(state); session(forged, s.id).revision = pending.reviewRevision;
    expect(() => approveSession(forged, s.id, pending.id)).toThrow('אחד המסמכים נערך');
    expect(currentVersion(state, patient, branch, 'formulation')?.content).toBe('עריכה מפורשת של המטפל לאחר הטיוטה');
  });

  it('invalidates review after an effective preference is added without a revision change or cancelled', () => {
    let { state, session: s } = active();
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    expect(pendingDraftIsCurrent(state, s.id)).toBe(true);
    state.preferences.push({ id: 'exclude-work', topic: 'עבודה', goal: 'note', scope: 'patient', action: 'exclude', patientId: patient, branchId: branch, sessionId: s.id, recordedAt: new Date().toISOString() });
    expect(pendingDraftIsCurrent(state, s.id)).toBe(false);
    expect(() => approveSession(state, s.id, session(state, s.id).pendingDraft!.id)).toThrow('העדפות התיעוד השתנו');
    expect(importState(exportState(state))).toEqual(state);
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    const revision = session(state, s.id).revision;
    state = cancelPreference(state, s.id, 'exclude-work');
    expect(session(state, s.id).revision).toBe(revision + 1);
    expect(pendingDraftIsCurrent(state, s.id)).toBe(false);
    expect(() => approveSession(state, s.id, session(state, s.id).pendingDraft!.id)).toThrow('הטיוטה השתנתה');
    expect(importState(exportState(state))).toEqual(state);
  });

  it('keeps older unmarked draft history readable and requires a fresh review when its preference snapshot is absent', () => {
    let { state, session: s } = active();
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    delete session(state, s.id).pendingDraft!.preferenceSnapshot;
    expect(importState(exportState(state))).toEqual(state);
    expect(pendingDraftIsCurrent(state, s.id)).toBe(false);
    expect(() => approveSession(state, s.id, session(state, s.id).pendingDraft!.id)).toThrow('העדפות התיעוד השתנו');
  });

  it('requires archived approval markers to refer to the exact five committed versions', () => {
    let { state, session: s } = active();
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    state = approveSession(state, s.id, session(state, s.id).pendingDraft!.id);
    for (const mutate of [
      (value: PortalState) => { session(value, s.id).draftHistory![0].approvedVersionIds![0] = 'missing'; },
      (value: PortalState) => { delete session(value, s.id).draftHistory![0].approvedAt; },
      (value: PortalState) => { session(value, s.id).draftHistory![0].approvedVersionIds![0] = value.versions[0].id; },
      (value: PortalState) => { const id = session(value, s.id).draftHistory![0].approvedVersionIds![0]; value.versions.find(v => v.id === id)!.content = 'changed'; },
    ]) {
      const bad = structuredClone(state); mutate(bad); expect(() => importState(exportState(bad))).toThrow();
    }
  });

  it('does not reapply an older extracted fact over a directly edited intake field during regeneration', () => {
    let { state, session: s } = active();
    state = applyTurn(state, s.id, session(state, s.id).revision, { ...question, fieldUpdates: [field(state, 5, 'הצעה מוקדמת')] });
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    const fields = structuredClone(currentVersion(state, patient, branch, 'intake')!.fields!);
    fields.find(f => f.id === 5)!.value = 'תיקון המטפל';
    state = editDocument(state, patient, branch, 'intake', '', fields);
    expect(session(state, s.id).pendingFields?.some(f => f.id === 5)).toBe(false);
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    expect(session(state, s.id).pendingDraft?.fields.find(f => f.id === 5)?.value).toBe('תיקון המטפל');
  });

  it('retains a compatible explicit acceptance path for legacy version proposals', () => {
    let { state, session: s } = active();
    const base = currentVersion(state, patient, branch, 'formulation')!;
    state.versions.push({ ...base, id: 'legacy-proposal', sessionId: s.id, sessionNumber: s.number, content: 'הצעה ישנה', createdAt: new Date().toISOString(), approved: false, proposal: true, baseVersionId: base.id });
    state = acceptProposal(state, 'legacy-proposal');
    expect(currentVersion(state, patient, branch, 'formulation')!.content).toBe('הצעה ישנה');
    expect(importState(exportState(state))).toEqual(state);
  });
});

describe('pending context and archive isolation', () => {
  it('does not inherit pending AI fields or documents into another session or branch', () => {
    let { state, session: s } = active();
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id, [field(state, 5, 'סימן מתוך טיוטה שלא אושרה')]));
    const fork = forkBranch(state, s.id, 'ענף בדיקה');
    vi.advanceTimersByTime(1000);
    const child = createSession(fork.state, patient, fork.branch.id, 6);
    const next = createSession(child.state, patient, branch, 6);
    for (const id of [child.session.id, next.session.id, 'fictional-eitan-session-4']) {
      const context = buildContext(next.state, id);
      expect(context.workingDraft).toBeUndefined();
      expect(context.pendingIntakeFields).toBeUndefined();
      expect(JSON.stringify(context)).not.toContain('סימן מתוך טיוטה שלא אושרה');
    }
    expect(buildContext(next.state, s.id).workingDraft).toBeDefined();
    expect(importState(exportState(next.state))).toEqual(next.state);
  });

  it('rejects cross-patient and sibling sources before staging and when importing pending data', () => {
    let { state, session: s } = active();
    const fork = forkBranch(state, s.id, 'ענף'); const child = createSession(fork.state, patient, fork.branch.id, 6);
    state = addUserMessage(child.state, child.session.id, 'מקור מלאכותי לענף האחר');
    const prohibited = [state.sources.find(source => source.patientId !== patient)!.id, state.sources.at(-1)!.id];
    for (const sourceId of prohibited) {
      const update = { ...field(state, 5, 'נתון לא מורשה להקשר'), sourceIds: [sourceId] };
      expect(() => applyTurn(state, s.id, session(state, s.id).revision, { ...question, fieldUpdates: [update] })).toThrow('מקור');
      expect(() => saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id, [update]))).toThrow('מקור');
      const bad = structuredClone(state); session(bad, s.id).pendingFields = [update];
      expect(() => importState(exportState(bad))).toThrow('מקור');
    }
  });

  it('rejects future ancestor sources and out-of-scope draft bases during import', () => {
    const first = active(); const fork = forkBranch(first.state, first.session.id, 'ענף'); const child = createSession(fork.state, patient, fork.branch.id, 6);
    vi.advanceTimersByTime(1000);
    let state = editDocument(child.state, patient, branch, 'formulation', 'מקור מאוחר בענף האב');
    const lateSource = state.sources.at(-1)!.id;
    const bad = structuredClone(state); session(bad, child.session.id).pendingFields = [{ ...field(state, 5, 'מידע עתידי'), sourceIds: [lateSource] }];
    expect(() => importState(exportState(bad))).toThrow('מקור');
    state = saveDraft(state, child.session.id, session(state, child.session.id).revision, draft(state, child.session.id));
    session(state, child.session.id).pendingDraft!.baseVersionIds.formulation = currentVersion(state, patient, branch, 'formulation')!.id;
    expect(() => importState(exportState(state))).toThrow('גרסת המקור');
  });

  it('rejects malformed pending ledgers and duplicate draft history without weakening legacy imports', () => {
    const original = createDemoState(); expect(importState(exportState(original))).toEqual(original);
    let { state, session: s } = active(); state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    for (const mutate of [
      (value: PortalState) => { session(value, s.id).pendingDraft!.fields[1] = session(value, s.id).pendingDraft!.fields[0]; },
      (value: PortalState) => { session(value, s.id).draftHistory = [session(value, s.id).pendingDraft!]; },
      (value: PortalState) => { session(value, s.id).pendingDraft!.result.documents[1] = session(value, s.id).pendingDraft!.result.documents[0]; },
      (value: PortalState) => { session(value, s.id).pendingDraft!.reviewRevision += 1; },
      (value: PortalState) => { session(value, s.id).pendingDraft!.result.documents[0].sourceIds = ['missing-source']; },
    ]) {
      const bad = structuredClone(state); mutate(bad); expect(() => importState(exportState(bad))).toThrow();
    }
  });

  it('round trips live traces containing separate working material and server context provenance', () => {
    let { state, session: s } = active();
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id, [field(state, 5, 'מידע ממתין')]));
    state = startExpansion(state, s.id, 'formulation');
    const context = buildContext(state, s.id);
    session(state, s.id).traces.push({ id: 'live-trace', at: new Date().toISOString(), mode: 'live', model: 'test', promptVersion: 'test', prompt: 'test', contextOrigin: 'server', context, response: question, elapsedMs: 1 });
    expect(importState(exportState(state))).toEqual(state);
    const bad = structuredClone(state); session(bad, s.id).traces[0].context.workingDraft!.documents[0].sourceIds = ['missing'];
    expect(() => importState(exportState(bad))).toThrow('רישום');
  });
});

describe('optional focus and live wire validation', () => {
  it('preserves the exact chosen invitation when two expansions target intake', () => {
    let { state, session: s } = active();
    const result = draft(state, s.id);
    result.followUps!.push({ goal: 'intake', text: 'אפשר להרחיב על שגרת הבקרים שתוארה.', kind: 'expand', fieldIds: [18] });
    state = saveDraft(state, s.id, session(state, s.id).revision, result);
    const selected = result.followUps![1];
    state = startExpansion(state, s.id, 'intake', selected);
    const context = buildContext(state, s.id);
    expect(context.focusSelection).toEqual(selected);
    expect(validateRequest({ requestId: 'selected-expansion', model: 'anthropic/claude-sonnet-5.5', context }, 'turn').context.focusSelection).toEqual(selected);
    expect(importState(exportState(state))).toEqual(JSON.parse(exportState(state)));
    expect(() => startExpansion(state, s.id, 'intake', { ...selected, text: 'הזמנה שאינה בהצעה' })).toThrow('הצעת ההרחבה');
    expect(() => startExpansion(state, s.id, 'supervision', selected)).toThrow('הצעת ההרחבה');
    state = saveDraft(state, s.id, session(state, s.id).revision, result);
    expect(buildContext(state, s.id).focusSelection).toBeUndefined();
  });

  it('rejects malformed selected invitations and clears a prior selection for a general expansion', () => {
    let { state, session: s } = active();
    const result = draft(state, s.id);
    state = saveDraft(state, s.id, session(state, s.id).revision, result);
    state = startExpansion(state, s.id, 'intake', result.followUps![0]);
    const context = buildContext(state, s.id);
    expect(() => validateRequest({ requestId: 'bad-expansion', model: 'anthropic/claude-sonnet-5.5', context: { ...context, focusGoal: 'gold' } }, 'turn')).toThrow('invalid_expansion_selection');
    expect(() => validateRequest({ requestId: 'bad-fields', model: 'anthropic/claude-sonnet-5.5', context: { ...context, focusSelection: { ...context.focusSelection, fieldIds: [10, 10] } } }, 'turn')).toThrow('invalid_expansion_selection');
    state = startExpansion(state, s.id, 'supervision');
    expect(buildContext(state, s.id).focusSelection).toBeUndefined();
  });

  it('gives each requested focus a separate bounded two-question round without resetting the main limit', () => {
    let { state, session: s } = active();
    for (let i = 0; i < 3; i++) state = applyTurn(state, s.id, session(state, s.id).revision, question);
    state = startExpansion(state, s.id, 'supervision');
    expect(buildContext(state, s.id)).toMatchObject({ stage: 'intake', focusGoal: 'supervision', intakeCount: 0, intakeRound: 1, questionCount: 3 });
    for (let i = 0; i < 2; i++) state = applyTurn(state, s.id, session(state, s.id).revision, question);
    expect(() => applyTurn(state, s.id, session(state, s.id).revision, question)).toThrow('מספר השאלות');
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id));
    expect(buildContext(state, s.id).focusGoal).toBeUndefined();
    expect(() => applyTurn(state, s.id, session(state, s.id).revision, question)).toThrow('מספר השאלות');
  });

  it('validates pending context source references and requires summary/followUps on the provider wire', () => {
    let { state, session: s } = active();
    state = saveDraft(state, s.id, session(state, s.id).revision, draft(state, s.id, [field(state, 5, 'מידע ממתין')]));
    const context = buildContext(state, s.id, 'draft');
    const request = { requestId: 'test-request', model: 'anthropic/claude-sonnet-5.5', context };
    expect(validateRequest(request, 'draft').context.workingDraft).toEqual(context.workingDraft);
    const bad = structuredClone(request); bad.context.pendingIntakeFields![0].sourceIds = ['missing'];
    expect(() => validateRequest(bad, 'draft')).toThrow('unknown_pending_source');
    const badDraft = structuredClone(request); badDraft.context.workingDraft!.documents[0].sourceIds = ['missing'];
    expect(() => validateRequest(badDraft, 'draft')).toThrow('unknown_pending_source');
    const schema = responseSchema('draft') as { required: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(['summary', 'followUps', 'documents', 'fieldUpdates']));
    const live = draft(state, s.id);
    expect(() => validateResult({ ...live, summary: undefined }, 'draft', context)).toThrow('invalid_model_output');
    expect(() => validateResult({ ...live, followUps: undefined }, 'draft', context)).toThrow('invalid_model_output');
    expect(() => validateResult({ ...live, summary: 'א'.repeat(1601) }, 'draft', context)).toThrow('invalid_model_output');
    expect(() => validateResult({ ...live, followUps: Array.from({ length: 4 }, () => live.followUps![0]) }, 'draft', context)).toThrow('invalid_model_output');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { preparedDraft } from '../fixtures/fictional/prepared';
import type { DraftFollowUp } from '../packages/contracts';
import { addUserMessage, advanceRequestRevision, applyTurn, buildContext, createSession, exportState, importState, rollbackExpansion, saveDraft, startExpansion } from '../packages/domain';
import { canRetryExpansion, rememberExpansionRetry, retryAfterStaleRevision } from '../apps/web/model-retry';
import { safeApiErrorCode } from '../apps/web/api-errors';

const rejected = (minimumRevision = 8) => Object.assign(new Error('stale_revision'), { status: 409, code: 'stale_revision', minimumRevision });
function active() {
  const made = createSession(createDemoState(), 'fictional-tamar', 'fictional-tamar-main', 5);
  return { state: addUserMessage(made.state, made.session.id, 'Fictional input preserved before interruption'), id: made.session.id };
}

describe('explicit model retry after an interrupted response', () => {
  it('exposes only known fixed error codes in the diagnostic disclosure', () => {
    expect(safeApiErrorCode('invalid_model_output')).toBe('invalid_model_output');
    expect(safeApiErrorCode('invalid_question')).toBe('invalid_question');
    expect(safeApiErrorCode('PRIVATE_UPSTREAM_TEXT')).toBe('');
    expect(safeApiErrorCode({ message: 'private' })).toBe('');
  });
  it.each(['cancelled', 'reloaded'])('regenerates after a %s response without duplicating user input or applying a result twice', async interruption => {
    const initial = active();
    let state = interruption === 'reloaded' ? importState(exportState(initial.state)) : initial.state;
    const prior = structuredClone(state);
    let paidCalls = 0;
    const attempt = vi.fn(async () => {
      if (buildContext(state, initial.id).baseRevision < 8) throw rejected();
      paidCalls++;
      return { action: 'question' as const, utterance: 'Which detail matters?', topic: 'detail', rationale: 'Clarification', fieldUpdates: [], preferenceUpdates: [] };
    });
    const result = await retryAfterStaleRevision(attempt, minimum => {
      state = advanceRequestRevision(state, initial.id, buildContext(state, initial.id).baseRevision, minimum);
      return true;
    });
    state = applyTurn(state, initial.id, 8, result);
    const session = state.sessions.find(item => item.id === initial.id)!;
    expect(attempt).toHaveBeenCalledTimes(2); expect(paidCalls).toBe(1);
    expect(session.messages.filter(item => item.role === 'user')).toHaveLength(1);
    expect(session.messages.filter(item => item.role === 'assistant')).toHaveLength(1);
    expect(state.sources).toEqual(prior.sources); expect(state.versions).toEqual(prior.versions);
    expect(session.revision).toBe(9);
    expect(importState(exportState(state))).toEqual(JSON.parse(exportState(state)));
  });
  it('stops after a second stale rejection without an unbounded retry loop', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(rejected(8)).mockRejectedValueOnce(rejected(9));
    const rebase = vi.fn(() => true);
    await expect(retryAfterStaleRevision(attempt, rebase)).rejects.toMatchObject({ minimumRevision: 9 });
    expect(attempt).toHaveBeenCalledTimes(2); expect(rebase).toHaveBeenCalledTimes(1);
  });
  it('does not rebase or send another request when the state changed during the rejected attempt', async () => {
    const initial = active(); let state = initial.state;
    const expected = buildContext(state, initial.id).baseRevision;
    const attempt = vi.fn(async () => { state = addUserMessage(state, initial.id, 'New intervening fictional information'); throw rejected(); });
    await expect(retryAfterStaleRevision(attempt, minimum => {
      if (buildContext(state, initial.id).baseRevision !== expected) return false;
      state = advanceRequestRevision(state, initial.id, expected, minimum); return true;
    })).rejects.toMatchObject({ code: 'stale_revision' });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(buildContext(state, initial.id).baseRevision).toBe(expected + 1);
    expect(state.sessions.find(item => item.id === initial.id)?.messages.at(-1)?.text).toContain('intervening');
  });
  it.each([
    { status: 502, code: 'provider_outcome_uncertain', minimumRevision: 8 },
    { status: 409, code: 'request_done', minimumRevision: 8 },
    { status: 409, code: 'stale_revision' },
    { status: 409, code: 'stale_revision', minimumRevision: Number.NaN },
  ])('never repeats provider failures or malformed retry metadata: $code', async failure => {
    const attempt = vi.fn().mockRejectedValue(failure); const rebase = vi.fn(() => true);
    await expect(retryAfterStaleRevision(attempt, rebase)).rejects.toBe(failure);
    expect(attempt).toHaveBeenCalledTimes(1); expect(rebase).not.toHaveBeenCalled();
  });
});

describe('failed optional expansion retry', () => {
  function rolledBackExpansion() {
    const initial = active();
    const focus: DraftFollowUp = { goal: 'intake', kind: 'expand', fieldIds: [5, 8], text: 'Fictional specific intake follow-up' };
    const proposal = { ...preparedDraft(buildContext(initial.state, initial.id, 'draft')), followUps: [focus], preferenceUpdates: [] };
    const reviewing = saveDraft(initial.state, initial.id, buildContext(initial.state, initial.id).baseRevision, proposal);
    const previous = reviewing.sessions.find(item => item.id === initial.id)!;
    const expanded = startExpansion(reviewing, initial.id, focus.goal, focus);
    const rolledBack = rollbackExpansion(expanded, initial.id, buildContext(expanded, initial.id).baseRevision, previous);
    const selection = { patientId: previous.patientId, branchId: previous.branchId, sessionId: previous.id };
    return { state: rolledBack, selection, focus, retry: rememberExpansionRetry(rolledBack, selection, focus.goal, focus) };
  }

  it('restarts exactly the same goal and selected suggestion in a new voluntary round', () => {
    const { state, selection, focus, retry } = rolledBackExpansion();
    expect(canRetryExpansion(state, selection, retry)).toBe(true);
    const before = state.sessions.find(item => item.id === selection.sessionId)!;
    const restarted = startExpansion(state, selection.sessionId, retry.goal, retry.focusSelection);
    const context = buildContext(restarted, selection.sessionId);
    expect(context.stage).toBe('intake'); expect(context.focusGoal).toBe(focus.goal);
    expect(context.focusSelection).toEqual(focus);
    expect(context.intakeRound).toBe((before.intakeRound ?? 0) + 1);
    expect(context.intakeCount).toBe(0);
    expect(restarted.sessions.find(item => item.id === selection.sessionId)!.messages).toEqual(before.messages);
    expect(restarted.sources).toEqual(state.sources);
    // The retained descriptor is not an alias to the UI's suggestion object.
    focus.fieldIds.push(9); expect(retry.focusSelection?.fieldIds).toEqual([5, 8]);
  });

  it('does not replay an expansion for another patient, branch, or session', () => {
    const { state, selection, retry } = rolledBackExpansion();
    for (const key of ['patientId', 'branchId', 'sessionId'] as const) {
      expect(canRetryExpansion(state, { ...selection, [key]: `other-${key}` }, retry)).toBe(false);
    }
  });

  it('requires a fresh suggestion after new composer text, preferences, or proposal changes', () => {
    const { state, selection, retry } = rolledBackExpansion();
    const composer = structuredClone(state); composer.sessions.find(item => item.id === selection.sessionId)!.composer = 'New unsent fictional text';
    const preference = structuredClone(state); preference.preferences.push({ id: 'retry-test-preference', topic: 'changed goal', action: 'block', scope: 'session', ...selection, recordedAt: new Date().toISOString() });
    const proposal = structuredClone(state); proposal.sessions.find(item => item.id === selection.sessionId)!.pendingDraft!.id = 'new-proposal';
    for (const changed of [composer, preference, proposal]) expect(canRetryExpansion(changed, selection, retry)).toBe(false);
    expect(canRetryExpansion(importState(exportState(state)), selection, retry)).toBe(true);
  });
});

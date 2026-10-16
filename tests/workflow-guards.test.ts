import { describe, expect, it } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { createSession } from '../packages/domain';
import { stateSignature } from '../packages/domain/storage';
import { canReconnectLocal, unfinishedSession } from '../apps/web/workflow-guards';

const patientId = 'fictional-tamar';
const branchId = `${patientId}-main`;

describe('session continuation guards', () => {
  it('continues the current unapproved session instead of stranding its work', () => {
    const { state, session } = createSession(createDemoState(), patientId, branchId, 5);
    expect(unfinishedSession(state, patientId, branchId)?.id).toBe(session.id);
    state.sessions.find(item => item.id === session.id)!.status = 'approved';
    expect(unfinishedSession(state, patientId, branchId)).toBeUndefined();
  });

  it('does not treat a saved retrospective manual edit as an unfinished conversation', () => {
    const state = createDemoState();
    const historical = state.sessions.find(session => session.patientId === patientId && session.number === 1)!;
    historical.status = 'draft';
    expect(unfinishedSession(state, patientId, branchId)).toBeUndefined();
    historical.composer = 'Unsent fictional text';
    expect(unfinishedSession(state, patientId, branchId)?.id).toBe(historical.id);
  });

  it('does not block another patient or branch', () => {
    const { state } = createSession(createDemoState(), patientId, branchId, 5);
    const other = state.patients.find(patient => patient.id !== patientId)!;
    const branch = state.branches.find(item => item.patientId === other.id && !item.parentId)!;
    expect(unfinishedSession(state, other.id, branch.id)).toBeUndefined();
  });
});

describe('explicit reconnect eligibility', () => {
  it('allows the choice only while the server still equals this tab baseline', () => {
    const remote = createDemoState();
    const base = stateSignature(remote);
    expect(canReconnectLocal(remote, base)).toBe(true);
    remote.sessions[0].composer = 'Changed in another browser';
    expect(canReconnectLocal(remote, base)).toBe(false);
  });

  it('does not enable an overwrite choice without a known server baseline', () => {
    expect(canReconnectLocal(createDemoState(), null)).toBe(false);
    expect(canReconnectLocal(null, stateSignature(createDemoState()))).toBe(false);
  });
});

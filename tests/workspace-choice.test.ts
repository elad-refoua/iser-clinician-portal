import { describe, expect, it } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import type { PortalState } from '../packages/contracts';
import { stateSignature } from '../apps/web/workspace-state';
import { chooseWorkspaceAction } from '../apps/web/workspace-choice';

const baseline = createDemoState();
function edited(text: string): PortalState {
  const state = structuredClone(baseline);
  state.sessions[0].composer = text;
  return state;
}

describe('workspace reconnect decisions', () => {
  it('connects to an empty workspace so the local state can be saved', () => {
    expect(chooseWorkspaceAction(edited('local work'), null, null)).toBe('connect');
  });

  it('connects identical content even when object properties have different order', () => {
    const local = edited('same content');
    const remote = JSON.parse(JSON.stringify(local, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value)) as PortalState;
    expect(JSON.stringify(remote)).not.toBe(JSON.stringify(local));
    expect(chooseWorkspaceAction(local, remote, null)).toBe('connect');
  });

  it('requires a choice if shared local storage contains another tab snapshot despite a newer matching cloud base', () => {
    const otherTabLocal = edited('tab B changes based on an older revision');
    const currentRemote = edited('tab A changes saved at the current revision');
    expect(chooseWorkspaceAction(otherTabLocal, currentRemote, stateSignature(currentRemote))).toBe('choose');
  });

  it('requires a choice for pending local edits even when the server has not changed', () => {
    const local = edited('pending local work');
    expect(chooseWorkspaceAction(local, baseline, stateSignature(baseline))).toBe('choose');
  });

  it('loads newer remote content only when the local state still matches its confirmed base', () => {
    expect(chooseWorkspaceAction(baseline, edited('newer remote work'), stateSignature(baseline))).toBe('load');
  });

  it('requires a choice for different local content when no confirmed base is known', () => {
    expect(chooseWorkspaceAction(edited('local work'), edited('remote work'), null)).toBe('choose');
  });
});

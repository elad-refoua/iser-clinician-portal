import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDemoState } from '../fixtures/fictional';
import { hasUnconfirmedWork, requiresLogin, stateSignature } from '../apps/web/workspace-state';
import { readWorkspace, WorkspaceRequestError, WorkspaceSync } from '../apps/web/workspace-sync';
import { chooseWorkspaceAction } from '../apps/web/workspace-choice';
import { canReconnectLocal } from '../apps/web/workflow-guards';
import { apiErrorMessage } from '../apps/web/api-errors';

afterEach(() => vi.unstubAllGlobals());

describe('server-only workspace lifecycle', () => {
  it.each([503, 429, 500, 413])('does not invalidate authentication when GET returns %i', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status })));
    const failure = await readWorkspace('', 'in-memory-token').catch(error => error);
    expect(failure).toBeInstanceOf(WorkspaceRequestError);
    expect(requiresLogin(failure)).toBe(false);
  });

  it('requires login only on an actual 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    expect(requiresLogin(await readWorkspace('', 'expired').catch(error => error))).toBe(true);
    expect(requiresLogin(new TypeError('network unavailable'))).toBe(false);
  });

  it('never treats initial fixtures as unsaved user work before server bootstrap', () => {
    const state = createDemoState();
    expect(hasUnconfirmedWork(state, null, false)).toBe(false);
    const confirmed = stateSignature(state);
    expect(hasUnconfirmedWork(state, confirmed, true)).toBe(false);
    state.sessions[0].composer = 'Fictional pending edit';
    expect(hasUnconfirmedWork(state, confirmed, true)).toBe(true);
  });

  it('retains the in-memory draft after a failed server write and retries with the same CAS revision', async () => {
    const base = createDemoState();
    const work = structuredClone(base); work.sessions[0].composer = 'Unsaved fictional text';
    const calls: RequestInit[] = [];
    const statuses: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      return calls.length === 1 ? new Response(null, { status: 503 }) : Response.json({ revision: 8, updatedAt: '2026-10-16T12:00:00Z' });
    }));
    const sync = new WorkspaceSync({ apiURL: '', token: 'memory', revision: 7, updatedAt: '2026-10-16T11:00:00Z', confirmedState: base, onStatus: event => statuses.push(event.status) });
    sync.requestSave(work);
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('error'));
    expect(hasUnconfirmedWork(work, stateSignature(sync.getConfirmedState()!), true)).toBe(true);
    expect(work.sessions[0].composer).toBe('Unsaved fictional text');
    expect(sync.retry()).toBe(true);
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('saved'));
    expect(sync.getConfirmedState()?.sessions[0].composer).toBe('Unsaved fictional text');
    // Transport details are covered by workspace-sync tests; revision must not advance on failure.
    expect(sync.revision).toBe(8);
    expect(calls).toHaveLength(2);
    sync.stop();
  });

  it('requires a choice when both server and in-memory work diverged from the baseline', () => {
    const base = createDemoState();
    const work = structuredClone(base); work.sessions[0].composer = 'This tab';
    const remote = structuredClone(base); remote.sessions[0].composer = 'Other tab';
    expect(chooseWorkspaceAction(work, remote, stateSignature(base))).toBe('choose');
    expect(work.sessions[0].composer).toBe('This tab');
  });

  it('retains an intermediate acknowledged baseline when logout interrupts a newer queued save', async () => {
    const original = createDemoState();
    const first = structuredClone(original); first.sessions[0].composer = 'First acknowledged edit';
    const latest = structuredClone(first); latest.sessions[0].composer = 'Newer pending edit';
    const acknowledgments: Array<(response: Response) => void> = [];
    const statuses: string[] = [];
    let confirmedBase = stateSignature(original);
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { acknowledgments.push(resolve); })));
    const sync = new WorkspaceSync({ apiURL: '', token: 'memory', revision: 2, updatedAt: '2026-10-16T11:00:00Z', confirmedState: original, onStatus: event => {
      const acknowledged = sync.getConfirmedState();
      if (acknowledged) confirmedBase = stateSignature(acknowledged);
      statuses.push(event.status);
    } });
    sync.requestSave(first);
    await vi.waitFor(() => expect(acknowledgments).toHaveLength(1));
    sync.requestSave(latest);
    acknowledgments[0](Response.json({ revision: 3, updatedAt: '2026-10-16T12:00:00Z' }));
    await vi.waitFor(() => expect(acknowledgments).toHaveLength(2));
    expect(statuses.at(-1)).toBe('pending');
    expect(statuses).not.toContain('saved');
    expect(confirmedBase).toBe(stateSignature(first));
    expect(hasUnconfirmedWork(latest, confirmedBase, true)).toBe(true);
    sync.stop();
    // The server still contains our first write: reauthentication can safely offer
    // to save the working copy using its fresh CAS revision, with no false conflict.
    expect(chooseWorkspaceAction(latest, first, confirmedBase)).toBe('choose');
    expect(canReconnectLocal(first, confirmedBase)).toBe(true);
    acknowledgments[1](Response.json({ revision: 4, updatedAt: '2026-10-16T12:01:00Z' }));
    await Promise.resolve();
    expect(confirmedBase).toBe(stateSignature(first));
  });

  it('does not mark a newer edit saved when the preceding request is acknowledged before debounce', async () => {
    const base = createDemoState();
    const sent = structuredClone(base); sent.sessions[0].composer = 'First change sent';
    let acknowledge!: (response: Response) => void;
    const statuses: string[] = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { acknowledge = resolve; })));
    const sync = new WorkspaceSync({ apiURL: '', token: 'memory', revision: 2, updatedAt: '2026-10-16T11:00:00Z', confirmedState: base, onStatus: event => statuses.push(event.status) });
    sync.requestSave(sent);
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
    const unsent = structuredClone(sent); unsent.sessions[0].composer = 'New text before debounce';
    // This check is synchronous: navigation protection cannot wait for the save effect.
    expect(hasUnconfirmedWork(unsent, stateSignature(base), true)).toBe(true);
    acknowledge(Response.json({ revision: 3, updatedAt: '2026-10-16T12:00:00Z' }));
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('saved'));
    expect(hasUnconfirmedWork(unsent, stateSignature(sync.getConfirmedState()!), true)).toBe(true);
    expect(hasUnconfirmedWork(sent, stateSignature(sync.getConfirmedState()!), true)).toBe(false);
    sync.stop();
  });

  it.each(['session_expired', 'request_pending', 'provider_outcome_uncertain', 'invalid_question', 'unknown_error'])('does not claim durable persistence for model error %s', code => {
    expect(apiErrorMessage(code, 500)).toContain('מצב השמירה מופיע בראש המסך');
    expect(apiErrorMessage(code, 500)).not.toMatch(/הטקסט שלך נשמר|העבודה שכתבת נשמרה|הטקסט שלך שמור/);
  });

  it('keeps automatic browser persistence out of the application entry and workspace modules', () => {
    for (const path of ['App.tsx', 'workspace-state.ts', 'workspace-choice.ts', 'workflow-guards.ts', 'document-editing.ts']) {
      const source = readFileSync(new URL(`../apps/web/${path}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/indexedDB|localStorage|sessionStorage|preservePendingCopy|persistState|loadState|recovery-storage|domain\/storage/);
    }
  });
});

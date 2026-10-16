import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import type { PortalState } from '../packages/contracts';
import { readWorkspace, WorkspaceRequestError, WorkspaceSync, type WorkspaceSyncEvent } from '../apps/web/workspace-sync';
import { decodeWorkspacePayload, encodeWorkspacePayload, WORKSPACE_GZIP_TYPE, WORKSPACE_WIRE_MAX_BYTES } from '../packages/transport/workspace';

const at = '2026-10-16T13:00:00.000Z';
const apiURL = 'https://example.invalid/';
const token = 'test-only-token';
function state(text: string): PortalState {
  const value = createDemoState();
  value.sessions[0].composer = text;
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(confirmedState: PortalState | null = null, timeoutMs?: number) {
  const events: WorkspaceSyncEvent[] = [];
  const sync = new WorkspaceSync({ apiURL, token, revision: confirmedState ? 4 : 0,
    confirmedState, updatedAt: confirmedState ? at : null, onStatus: event => events.push(event), timeoutMs });
  return { sync, events };
}
function saved(revision: number) { return Response.json({ revision, updatedAt: at }); }
async function sent(fetcher: ReturnType<typeof vi.fn>, index = 0): Promise<any> {
  const init = fetcher.mock.calls[index][1] as RequestInit;
  const headers = new Headers(init.headers);
  return decodeWorkspacePayload(new Response(init.body).body, headers.get('Content-Type')!);
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('workspace reads', () => {
  it('loads an empty workspace and validates a saved archive before returning it', async () => {
    const value = state('fixture');
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ revision: 0, updatedAt: null, state: null }))
      .mockResolvedValueOnce(Response.json({ revision: 3, updatedAt: at, state: value }));
    vi.stubGlobal('fetch', fetcher);
    expect(await readWorkspace(apiURL, token)).toEqual({ revision: 0, updatedAt: null, state: null });
    expect(await readWorkspace(apiURL, token)).toEqual({ revision: 3, updatedAt: at, state: value });
    expect(fetcher.mock.calls[0][0]).toBe('https://example.invalid/api/workspace');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  });

  it('requests and decodes the compressed representation with complete content', async () => {
    const value = state('דוגמה בדיונית לבדיקה');
    const payload = await encodeWorkspacePayload(JSON.stringify({ revision: 3, updatedAt: at, state: value }));
    const fetcher = vi.fn().mockResolvedValue(new Response(payload.body, { headers: { 'Content-Type': payload.contentType } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await readWorkspace(apiURL, token)).toEqual({ revision: 3, updatedAt: at, state: value });
    expect(fetcher.mock.calls[0][1].headers.Accept).toBe(WORKSPACE_GZIP_TYPE);
  });

  it('rejects oversized and corrupt server responses before returning a workspace', async () => {
    const oversized = new Response(new Uint8Array([1]), { headers: { 'Content-Type': WORKSPACE_GZIP_TYPE, 'Content-Length': String(WORKSPACE_WIRE_MAX_BYTES + 1) } });
    const read = vi.spyOn(oversized.body!, 'getReader');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(oversized)
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': WORKSPACE_GZIP_TYPE } })));
    await expect(readWorkspace(apiURL, token)).rejects.toMatchObject({ code: 'workspace_too_large' });
    expect(read).not.toHaveBeenCalled();
    await expect(readWorkspace(apiURL, token)).rejects.toMatchObject({ code: 'invalid_workspace_response' });
  });

  it('rejects malformed metadata, mismatched empty state, and invalid archive contents', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ revision: 1, updatedAt: 'bad-date', state: state('a') }))
      .mockResolvedValueOnce(Response.json({ revision: 0, updatedAt: null, state: state('b') }))
      .mockResolvedValueOnce(Response.json({ revision: 1, updatedAt: at, state: { schemaVersion: 1 } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(readWorkspace(apiURL, token)).rejects.toMatchObject({ code: 'invalid_workspace_response' });
    await expect(readWorkspace(apiURL, token)).rejects.toMatchObject({ code: 'invalid_workspace_response' });
    await expect(readWorkspace(apiURL, token)).rejects.toMatchObject({ code: 'invalid_workspace_state' });
  });

  it('reports authentication failures without exposing upstream response text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream details', { status: 401 })));
    await expect(readWorkspace(apiURL, token)).rejects.toMatchObject({ code: 'workspace_auth_required', status: 401 });
  });

  it('honors cancellation before sending a request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const abort = new AbortController(); abort.abort();
    await expect(readWorkspace(apiURL, token, abort.signal)).rejects.toBeInstanceOf(WorkspaceRequestError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('workspace autosave controller', () => {
  it('serializes writes and coalesces queued changes to the latest immutable snapshot', async () => {
    const first = deferred<Response>(); const second = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal('fetch', fetcher);
    const { sync, events } = setup();
    sync.requestSave(state('first'));
    sync.requestSave(state('intermediate'));
    const latest = state('latest'); sync.requestSave(latest); latest.sessions[0].composer = 'mutated after request';
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(await sent(fetcher)).toMatchObject({ expectedRevision: 0 });
    first.resolve(saved(1));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const next = await sent(fetcher, 1);
    expect(next.expectedRevision).toBe(1);
    expect(next.state.sessions[0].composer).toBe('latest');
    expect(events.some(event => event.status === 'saved')).toBe(false);
    second.resolve(saved(2));
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ status: 'saved', revision: 2, updatedAt: at }));
    expect(sync.getConfirmedState()!.sessions[0].composer).toBe('latest');
    const copy = sync.getConfirmedState()!; copy.sessions[0].composer = 'outside mutation';
    expect(sync.getConfirmedState()!.sessions[0].composer).toBe('latest');
    expect(sync.revision).toBe(2); expect(sync.updatedAt).toBe(at);
    sync.stop();
  });

  it('does not send duplicate snapshots while a matching save is in flight', async () => {
    const first = deferred<Response>(); const fetcher = vi.fn().mockReturnValue(first.promise); vi.stubGlobal('fetch', fetcher);
    const { sync, events } = setup();
    const value = state('one'); sync.requestSave(value); sync.requestSave(structuredClone(value));
    first.resolve(saved(1));
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe('saved'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    sync.requestSave(structuredClone(value));
    expect(fetcher).toHaveBeenCalledTimes(1);
    sync.stop();
  });

  it('stops permanently on conflict and never overwrites newer server state', async () => {
    const first = deferred<Response>(); const fetcher = vi.fn().mockReturnValue(first.promise); vi.stubGlobal('fetch', fetcher);
    const original = state('confirmed'); const { sync, events } = setup(original);
    sync.requestSave(state('one')); sync.requestSave(state('two'));
    first.resolve(Response.json({ error: 'workspace_conflict' }, { status: 409 }));
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ status: 'conflict', revision: 4, error: 'workspace_conflict' }));
    sync.requestSave(state('three'));
    expect(sync.retry()).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sync.getConfirmedState()).toEqual(original);
    expect(events.some(event => event.status === 'saved')).toBe(false);
    sync.stop();
  });

  it('keeps the newest pending state after network failure and requires an explicit retry', async () => {
    const first = deferred<Response>(); const second = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); vi.stubGlobal('fetch', fetcher);
    const { sync, events } = setup();
    sync.requestSave(state('one')); sync.requestSave(state('two'));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    first.reject(new TypeError('sensitive network detail'));
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ status: 'error', error: 'workspace_network_error' }));
    sync.requestSave(state('three'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sync.revision).toBe(0); expect(sync.getConfirmedState()).toBeNull();
    expect(events.some(event => event.status === 'saved')).toBe(false);
    expect(sync.retry()).toBe(true);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect((await sent(fetcher, 1)).state.sessions[0].composer).toBe('three');
    second.resolve(saved(1));
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ status: 'saved', revision: 1 }));
    sync.stop();
  });

  it('does not mistake a local reversion for a confirmed save after an uncertain PUT', async () => {
    const original = state('original'); const first = deferred<Response>(); const second = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); vi.stubGlobal('fetch', fetcher);
    const { sync, events } = setup(original);
    sync.requestSave(state('possibly saved')); sync.requestSave(original);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    first.reject(new Error('connection lost'));
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe('error'));
    sync.retry();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(await sent(fetcher, 1)).toMatchObject({ expectedRevision: 4, state: original });
    second.resolve(Response.json({ error: 'workspace_conflict' }, { status: 409 }));
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe('conflict'));
    expect(events.some(event => event.status === 'saved')).toBe(false);
    sync.stop();
  });

  it('requires a fresh authenticated connection after a 401', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 401 })); vi.stubGlobal('fetch', fetcher);
    const { sync, events } = setup(); sync.requestSave(state('one'));
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ status: 'auth', error: 'workspace_auth_required' }));
    sync.requestSave(state('two'));
    expect(sync.retry()).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1); sync.stop();
  });

  it('does not confirm an invalid acknowledgement revision', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(saved(12)));
    const { sync, events } = setup(); sync.requestSave(state('one'));
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ status: 'error', error: 'invalid_workspace_response' }));
    expect(sync.revision).toBe(0); expect(sync.getConfirmedState()).toBeNull(); sync.stop();
  });

  it('aborts and suppresses all late callbacks after stop', async () => {
    const first = deferred<Response>(); const fetcher = vi.fn().mockReturnValue(first.promise); vi.stubGlobal('fetch', fetcher);
    const { sync, events } = setup(); sync.requestSave(state('one')); sync.requestSave(state('two'));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const count = events.length; sync.stop();
    expect((fetcher.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    first.resolve(saved(1));
    await new Promise(resolve => setTimeout(resolve, 0));
    sync.requestSave(state('three'));
    expect(events).toHaveLength(count); expect(sync.revision).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(sync.retry()).toBe(false);
  });

  it('times out a hanging fetch without showing saved or automatically retrying', async () => {
    const first = deferred<Response>(); const fetcher = vi.fn().mockReturnValue(first.promise); vi.stubGlobal('fetch', fetcher);
    const { sync, events } = setup(null, 100); sync.requestSave(state('one'));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe('error'));
    expect(events.at(-1)).toMatchObject({ status: 'error', error: 'workspace_timeout', revision: 0 });
    expect((fetcher.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    first.resolve(saved(1)); await new Promise(resolve => setTimeout(resolve, 0));
    expect(events.some(event => event.status === 'saved')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1); sync.stop();
  });
});

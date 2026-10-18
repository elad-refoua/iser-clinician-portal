import { afterEach, expect, it, vi } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { WorkspaceSync } from '../apps/web/workspace-sync';

const at = '2026-10-18T10:00:00.000Z';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function setup() { return new WorkspaceSync({ apiURL: '', token: 'fictional', revision: 0, confirmedState: null, updatedAt: null, onStatus: () => {} }); }
afterEach(() => vi.unstubAllGlobals());

it('flush waits for acknowledgement of the exact immutable snapshot', async () => {
  const reply = deferred<Response>(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(reply.promise));
  const sync = setup(); const state = createDemoState(); let resolved = false;
  const barrier = sync.flush(state).then(revision => { resolved = true; return revision; });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); expect(resolved).toBe(false);
  reply.resolve(Response.json({ revision: 1, updatedAt: at }));
  expect(await barrier).toBe(1); expect(sync.getConfirmedState()).toEqual(state);
  expect(await sync.flush(state)).toBe(1); expect(fetch).toHaveBeenCalledOnce(); sync.stop();
});

it('rejects the barrier when a write is uncertain instead of starting inference', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const sync = setup(); await expect(sync.flush(createDemoState())).rejects.toMatchObject({ code: 'workspace_network_error' }); sync.stop();
});

it('rejects a coalesced snapshot rather than claiming a newer snapshot is its acknowledgement', async () => {
  const a = deferred<Response>(); const b = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise));
  const sync = setup(); const first = createDemoState(); sync.requestSave(first);
  const intermediate = structuredClone(first); intermediate.sessions[0].composer = 'intermediate';
  const expectedFailure = expect(sync.flush(intermediate)).rejects.toMatchObject({ code: 'workspace_snapshot_superseded' });
  const latest = structuredClone(first); latest.sessions[0].composer = 'latest'; sync.requestSave(latest);
  a.resolve(Response.json({ revision: 1, updatedAt: at }));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  b.resolve(Response.json({ revision: 2, updatedAt: at })); await expectedFailure; sync.stop();
});

it('stopping the connection rejects pending barriers promptly', async () => {
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
  const sync = setup(); const check = expect(sync.flush(createDemoState())).rejects.toMatchObject({ code: 'workspace_cancelled' }); sync.stop(); await check;
});

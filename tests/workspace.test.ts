import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalState } from '../packages/contracts/index.js';
import { createDemoState } from '../fixtures/fictional/index.js';
import { addUserMessage, createPatient, editDocument } from '../packages/domain/index.js';
import { digest, issueToken } from '../apps/api/auth.js';
import { ApiError, type Environment } from '../apps/api/errors.js';
import { handleWorkspace, WORKSPACE_MAX_BYTES } from '../apps/api/workspace.js';
import { NeonWorkspaceStore, type WorkspaceSnapshot, type WorkspaceStore, type WorkspaceVersion } from '../apps/api/workspace-store.js';

const { neonMock } = vi.hoisted(() => ({ neonMock: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: neonMock }));

const now = Date.parse('2026-10-16T12:00:00.000Z');
const env = { DEMO_ACCESS_CODE_HASH: digest('fictional-workspace-test-access'), SESSION_SECRET: 'fictional-workspace-test-secret-more-than-32-characters', ALLOWED_ORIGINS: 'https://example.github.io' };
const timestamp = new Date(now).toISOString();

class TestWorkspaceStore implements WorkspaceStore {
  records = new Map<string, WorkspaceSnapshot>();
  loads: string[] = []; saves: string[] = [];
  async load(workspaceId: string): Promise<WorkspaceSnapshot> {
    this.loads.push(workspaceId);
    return structuredClone(this.records.get(workspaceId) ?? { revision: 0, updatedAt: null, state: null });
  }
  async save(workspaceId: string, expectedRevision: number, state: PortalState): Promise<WorkspaceVersion | null> {
    this.saves.push(workspaceId);
    const current = this.records.get(workspaceId);
    if ((current?.revision ?? 0) !== expectedRevision) return null;
    const version = { revision: expectedRevision + 1, updatedAt: timestamp };
    this.records.set(workspaceId, { ...version, state: structuredClone(state) });
    return version;
  }
}

function request(method: string, body?: unknown, options: { token?: string | null; origin?: string; url?: string; headers?: Record<string, string> } = {}) {
  const token = options.token === undefined ? issueToken(env, now).token : options.token;
  return new Request(options.url ?? 'https://demo.vercel.app/api/workspace', {
    method,
    headers: { 'Content-Type': 'application/json', Origin: options.origin ?? 'https://example.github.io', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const dependencies = (store = new TestWorkspaceStore(), configuration: Environment = env) => ({ env: configuration, store, now: () => now });

beforeEach(() => neonMock.mockReset());

describe('authenticated fictional workspace API', () => {
  it('loads an empty workspace without needing a model key or quota service', async () => {
    const deps = dependencies(); const response = await handleWorkspace(request('GET'), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 0, updatedAt: null, state: null });
    expect(deps.store.loads).toEqual(['owner-demo']);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('saves and reloads all fictional cases, notes and complete version history', async () => {
    const deps = dependencies();
    const created = createPatient(createDemoState(), { name: 'תיק בדיקה לענן', schedule: { dayOfWeek: 1, time: '15:00' } });
    let state = addUserMessage(created.state, created.session.id, 'תיאור בדיוני לבדיקת שמירה בלבד');
    state = editDocument(state, created.patient.id, created.branch.id, 'note', 'טיוטת בדיקה א', undefined, created.session.id);
    state = editDocument(state, created.patient.id, created.branch.id, 'note', 'טיוטת בדיקה ב', undefined, created.session.id);
    const saved = await handleWorkspace(request('PUT', { expectedRevision: 0, state }), deps);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ revision: 1, updatedAt: timestamp });
    const loaded = await handleWorkspace(request('GET'), deps);
    expect(await loaded.json()).toEqual({ revision: 1, updatedAt: timestamp, state });
    expect(deps.store.records.get('owner-demo')!.state!.versions.filter(v => v.patientId === created.patient.id)).toHaveLength(2);
    const next = await handleWorkspace(request('PUT', { expectedRevision: 1, state }), deps);
    expect(await next.json()).toEqual({ revision: 2, updatedAt: timestamp });
  });

  it('allows one competing first save and rejects stale overwrites without changing saved content', async () => {
    const deps = dependencies(); const first = createDemoState(); const other = createPatient(createDemoState(), { name: 'תיק מתחרה בדיוני' }).state;
    const responses = await Promise.all([
      handleWorkspace(request('PUT', { expectedRevision: 0, state: first }), deps),
      handleWorkspace(request('PUT', { expectedRevision: 0, state: other }), deps),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await responses.find(response => response.status === 409)!.json()).toEqual({ error: 'workspace_conflict' });
    const retained = structuredClone(deps.store.records.get('owner-demo'));
    const stale = await handleWorkspace(request('PUT', { expectedRevision: 0, state: other }), deps);
    expect(stale.status).toBe(409);
    expect(deps.store.records.get('owner-demo')).toEqual(retained);
  });

  it('does not create a missing workspace from a nonzero expected revision', async () => {
    const deps = dependencies();
    const response = await handleWorkspace(request('PUT', { expectedRevision: 9, state: createDemoState() }), deps);
    expect(response.status).toBe(409);
    expect(deps.store.records.size).toBe(0);
  });

  it('keeps a stable server-selected workspace across token renewal and access-code rotation', async () => {
    const store = new TestWorkspaceStore(); const configuration = { ...env, DEMO_WORKSPACE_ID: 'private-owner-workspace' };
    await handleWorkspace(request('PUT', { expectedRevision: 0, state: createDemoState() }), dependencies(store, configuration));
    const firstToken = issueToken(configuration, now).token;
    const secondToken = issueToken(configuration, now).token;
    expect(firstToken).not.toBe(secondToken);
    expect((await handleWorkspace(request('GET', undefined, { token: secondToken, url: 'https://demo.vercel.app/api/workspace?workspaceId=somebody-else' }), dependencies(store, configuration))).status).toBe(200);
    const rotated = { ...configuration, DEMO_ACCESS_CODE_HASH: digest('rotated-fictional-test-access') };
    expect((await handleWorkspace(request('GET', undefined, { token: firstToken }), dependencies(store, rotated))).status).toBe(401);
    const response = await handleWorkspace(request('GET', undefined, { token: issueToken(rotated, now).token }), dependencies(store, rotated));
    expect((await response.json()).revision).toBe(1);
    expect(store.loads).toEqual(['private-owner-workspace', 'private-owner-workspace']);
    expect([...store.records.keys()]).toEqual(['private-owner-workspace']);
  });

  it('authenticates before reading a PUT body or touching storage', async () => {
    const deps = dependencies(); const unsigned = request('PUT', { expectedRevision: 0, state: createDemoState() }, { token: null });
    const read = vi.spyOn(unsigned.body!, 'getReader');
    const response = await handleWorkspace(unsigned, deps);
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'access_required' });
    expect(read).not.toHaveBeenCalled(); expect(unsigned.bodyUsed).toBe(false);
    expect(deps.store.saves).toEqual([]); expect(deps.store.loads).toEqual([]);
    expect(neonMock).not.toHaveBeenCalled();
  });

  it('rejects expired or tampered tokens before loading a snapshot', async () => {
    const deps = dependencies();
    for (const token of [issueToken(env, now - 3_600_001).token, `${issueToken(env, now).token}x`]) {
      expect((await handleWorkspace(request('GET', undefined, { token }), deps)).status).toBe(401);
    }
    expect(deps.store.loads).toEqual([]);
  });

  it('enforces exact origins, safe headers and GET/PUT preflight without authentication', async () => {
    const deps = dependencies();
    for (const origin of ['https://evil.example', 'https://example.github.io.attacker.example', 'null']) {
      const response = await handleWorkspace(request('GET', undefined, { origin }), deps);
      expect(response.status).toBe(403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    const preflight = await handleWorkspace(request('OPTIONS', undefined, { token: null }), deps);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('GET, PUT, OPTIONS');
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type');
    expect(deps.store.loads).toEqual([]);
    expect((await handleWorkspace(request('GET', undefined, { origin: 'https://demo.vercel.app' }), deps)).status).toBe(200);
    expect((await handleWorkspace(request('POST', {}), deps)).status).toBe(405);
  });

  it('rejects header-declared oversize before reading and streamed oversize by UTF-8 bytes', async () => {
    const deps = dependencies(); const oversized = request('PUT', {}, { headers: { 'Content-Length': String(WORKSPACE_MAX_BYTES + 1) } });
    const read = vi.spyOn(oversized.body!, 'getReader');
    expect((await handleWorkspace(oversized, deps)).status).toBe(413);
    expect(read).not.toHaveBeenCalled();
    const payload = new TextEncoder().encode(`"${'א'.repeat(WORKSPACE_MAX_BYTES / 2)}"`);
    let offset = 0; const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { if (offset >= payload.byteLength) controller.close(); else { controller.enqueue(payload.slice(offset, offset + 65_536)); offset += 65_536; } },
      cancel,
    }, { highWaterMark: 0 });
    const streamed = new Request('https://demo.vercel.app/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${issueToken(env, now).token}` }, body: stream, duplex: 'half' } as RequestInit);
    const response = await handleWorkspace(streamed, deps);
    expect(response.status).toBe(413); expect(await response.json()).toEqual({ error: 'request_too_large' });
    expect(cancel).toHaveBeenCalled(); expect(deps.store.saves).toEqual([]);
  });

  it('rejects malformed JSON, non-JSON media types, unknown envelope keys and invalid revisions', async () => {
    const deps = dependencies(); const token = issueToken(env, now).token;
    const malformed = new Request('https://demo.vercel.app/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{' });
    expect(await (await handleWorkspace(malformed, deps)).json()).toEqual({ error: 'invalid_json' });
    expect((await handleWorkspace(request('PUT', {}, { headers: { 'Content-Type': 'text/plain' } }), deps)).status).toBe(415);
    for (const body of [
      { expectedRevision: 0, state: createDemoState(), workspaceId: 'other' },
      { expectedRevision: -1, state: createDemoState() },
      { expectedRevision: 1.5, state: createDemoState() },
      { expectedRevision: '0', state: createDemoState() },
      { expectedRevision: 2_147_483_647, state: createDemoState() },
    ]) expect(await (await handleWorkspace(request('PUT', body), deps)).json()).toEqual({ error: 'workspace_invalid_request' });
    expect(deps.store.saves).toEqual([]);
  });

  it('applies full fictional-state, provenance and shape validation before saving', async () => {
    const deps = dependencies(); const nonFictional = createDemoState() as any; nonFictional.patients[0].fictional = false;
    const crossed = createDemoState(); crossed.versions[0].sourceIds = ['fictional-eitan-source-1'];
    const malformed = createDemoState() as any; malformed.secret = 'must-not-be-accepted';
    for (const state of [null, {}, nonFictional, crossed, malformed]) {
      const response = await handleWorkspace(request('PUT', { expectedRevision: 0, state }), deps);
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'workspace_invalid_state' });
    }
    expect(deps.store.saves).toEqual([]);
  });

  it('fails closed for missing configuration and sanitizes storage errors and malformed stored snapshots', async () => {
    const missing = await handleWorkspace(request('GET'), { env, now: () => now });
    expect(missing.status).toBe(503); expect(await missing.json()).toEqual({ error: 'workspace_not_configured' });
    const unavailable: WorkspaceStore = { load: async () => { throw new Error('PRIVATE_DATABASE_URL_AND_CONTENT'); }, save: async () => { throw new Error('PRIVATE_DATABASE_URL_AND_CONTENT'); } };
    const failed = await handleWorkspace(request('GET'), { env, now: () => now, store: unavailable });
    expect(await failed.json()).toEqual({ error: 'workspace_request_failed' });
    const corrupt: WorkspaceStore = { load: async () => ({ revision: 1, updatedAt: timestamp, state: {} as PortalState }), save: async () => null };
    expect(await (await handleWorkspace(request('GET'), { env, now: () => now, store: corrupt })).json()).toEqual({ error: 'workspace_store_unavailable' });
  });
});

describe('Neon workspace persistence statements', () => {
  function database(rows: Record<string, unknown>[] = []) {
    const queries: { text: string; values: unknown[] }[] = [];
    const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$parameter'); queries.push({ text, values });
      return Promise.resolve(/SELECT revision|RETURNING revision/.test(text) ? rows : []);
    }, { transaction: vi.fn(async (items: Promise<unknown>[]) => Promise.all(items)) });
    neonMock.mockReturnValue(sql);
    return { sql, queries };
  }
  const url = 'postgresql://fictional:fake-password@test.neon.tech/neondb';

  it('uses the explicit demo database first, initializes once and loads without leaking SQL parameters', async () => {
    const db = database(); const store = new NeonWorkspaceStore({ DEMO_DATABASE_URL: url, DATABASE_URL: 'postgresql://different:fake@other.neon.tech/neondb' });
    expect(await store.load("owner' OR TRUE --")).toEqual({ revision: 0, updatedAt: null, state: null });
    await store.load('owner-demo');
    expect(db.sql.transaction).toHaveBeenCalledTimes(1);
    expect(neonMock).toHaveBeenCalledWith(url, expect.any(Object));
    const select = db.queries.find(query => /SELECT revision/.test(query.text))!;
    expect(select.values).toEqual(["owner' OR TRUE --"]);
    expect(select.text).not.toContain("owner'");
    expect(db.queries.some(query => query.text.includes('pg_advisory_xact_lock'))).toBe(true);
  });

  it('uses conflict-safe initial insertion and revision-conditional updates with bound state', async () => {
    const db = database([{ revision: 1, updated_at: new Date(timestamp) }]);
    const store = new NeonWorkspaceStore({ DATABASE_URL: url }); const state = createDemoState();
    expect(await store.save('owner-demo', 0, state)).toEqual({ revision: 1, updatedAt: timestamp });
    const insert = db.queries.find(query => /INSERT INTO/.test(query.text))!;
    expect(insert.text).toContain('ON CONFLICT (workspace_id) DO NOTHING');
    expect(insert.values).toEqual(['owner-demo', JSON.stringify(state)]);
    await store.save('owner-demo', 4, state);
    const update = db.queries.find(query => /UPDATE public/.test(query.text))!;
    expect(update.text).toContain('revision = revision + 1');
    expect(update.text).toContain('AND revision = $parameter');
    expect(update.values).toEqual([JSON.stringify(state), 'owner-demo', 4]);
    expect(update.text).not.toContain(state.patients[0].name);
    expect(db.sql.transaction).toHaveBeenCalledTimes(1);
  });

  it('returns conflict for zero affected rows and rejects invalid connection configuration', async () => {
    database(); const store = new NeonWorkspaceStore({ DEMO_DATABASE_URL: url });
    expect(await store.save('owner-demo', 20, createDemoState())).toBeNull();
    for (const value of ['', 'not-a-url', 'https://example.test/db', 'postgresql://name:password@host/']) {
      expect(() => new NeonWorkspaceStore({ DEMO_DATABASE_URL: value })).toThrow('workspace_not_configured');
    }
  });

  it('sanitizes connection failures and lets a later request retry initialization', async () => {
    const db = database(); db.sql.transaction.mockRejectedValueOnce(new Error('PRIVATE_CONNECTION_DETAILS'));
    const store = new NeonWorkspaceStore({ DEMO_DATABASE_URL: url });
    await expect(store.load('owner-demo')).rejects.toEqual(new ApiError(503, 'workspace_store_unavailable'));
    expect(await store.load('owner-demo')).toEqual({ revision: 0, updatedAt: null, state: null });
    expect(db.sql.transaction).toHaveBeenCalledTimes(2);
  });
});

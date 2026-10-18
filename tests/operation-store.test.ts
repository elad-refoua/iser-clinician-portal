import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPatient, buildContext } from '../packages/domain/index.js';
import type { OperationStartRequest } from '../packages/contracts/operations.js';
import { initialOperation, NeonOperationStore, type StoredOperation } from '../apps/api/operation-store.js';
import { transition } from '../apps/api/model-operation.js';

const { neonMock } = vi.hoisted(() => ({ neonMock: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: neonMock }));
const url = 'postgresql://fictional:fake-password@fake.neon.tech/neondb';
const scope = { workspaceId: "fictional' OR TRUE --", principalId: 'fictional-principal' };
const created = createPatient({ schemaVersion: 1, patients: [], branches: [], sessions: [], sources: [], versions: [], preferences: [] }, { name: 'Fictional SQL fixture' });
const input: OperationStartRequest = { requestId: 'fictional-operation', task: 'turn', model: 'anthropic/claude-sonnet-5.5', context: buildContext(created.state, created.session.id), workspaceRevision: 1 };
const original = initialOperation(input, 'fictional-hash', 0);
function database(value: StoredOperation | null = original) {
  const queries: { text: string; values: unknown[] }[] = [];
  const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$parameter'); queries.push({ text, values });
    return Promise.resolve(/SELECT version|RETURNING version/.test(text) && value ? [{ version: value.version, record: value }] : []);
  }, { transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)) });
  neonMock.mockReturnValue(sql); return { queries, sql };
}
beforeEach(() => neonMock.mockReset());

describe('Neon operation journal boundaries', () => {
  it('binds all scope parameters and initializes one journal with an atomic scoped primary key', async () => {
    const db = database(); const store = new NeonOperationStore({ DEMO_DATABASE_URL: url });
    expect(await store.get(scope, original.id)).toEqual(original); await store.list(scope, 1000);
    expect(db.sql.transaction).toHaveBeenCalledTimes(1);
    const select = db.queries.find(query => query.text.includes('WHERE workspace_id'))!;
    expect(select.values).toEqual([scope.workspaceId, scope.principalId, original.id]); expect(select.text).not.toContain(scope.workspaceId);
    expect(db.queries.some(query => query.text.includes('PRIMARY KEY (workspace_id, principal_id, request_id)'))).toBe(true);
    const list = db.queries.find(query => query.text.includes('ORDER BY'))!;
    expect(list.values.at(-1)).toBe(50); expect(list.text).toContain("record->'settlement' IS NOT NULL");
  });

  it('inserts conflict-safely and claims only the expected version and payload hash', async () => {
    const db = database(); const store = new NeonOperationStore({ DATABASE_URL: url });
    await store.create(scope, input, original.payloadHash, 0);
    const insert = db.queries.find(query => query.text.includes('INSERT INTO'))!;
    expect(insert.text).toContain('ON CONFLICT (workspace_id, principal_id, request_id) DO NOTHING');
    expect(insert.values.slice(0, 4)).toEqual([scope.workspaceId, scope.principalId, original.id, original.payloadHash]);
    await store.replace(scope, original, transition(original, 1, { status: 'running', workerId: 'worker' }));
    const update = db.queries.find(query => query.text.includes('UPDATE public'))!;
    expect(update.text).toContain('AND payload_hash = $parameter AND version = $parameter');
    expect(update.values.slice(2)).toEqual([scope.workspaceId, scope.principalId, original.id, original.payloadHash, 1]);
  });

  it('refuses mutable replacements that alter immutable input, scope, task, or identity', async () => {
    database(); const store = new NeonOperationStore({ DATABASE_URL: url });
    for (const patch of [{ task: 'draft' as const }, { context: { ...original.context, patientName: 'Changed' } }, { workspaceRevision: 2 }, { id: 'changed' }]) {
      await expect(store.replace(scope, original, transition(original, 1, patch))).rejects.toMatchObject({ code: 'invalid_operation_transition' });
    }
    expect(neonMock).not.toHaveBeenCalled();
  });

  it('returns null for a lost CAS and sanitizes database failures', async () => {
    database(null); const store = new NeonOperationStore({ DATABASE_URL: url });
    expect(await store.replace(scope, original, transition(original, 1, { status: 'running' }))).toBeNull();
    neonMock.mockReturnValue(() => Promise.reject(new Error('PRIVATE_CONNECTION')));
    let failure: unknown;
    try { await store.get(scope, original.id); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'operation_store_unavailable', message: 'operation_store_unavailable' });
    expect(() => new NeonOperationStore({ DATABASE_URL: 'https://fake.example' })).toThrow('operations_not_configured');
  });
});

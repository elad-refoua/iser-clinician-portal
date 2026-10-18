import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortalState, TurnResult } from '../packages/contracts/index.js';
import { canonicalOperationValue, comparableOperationContext, type OperationStartRequest } from '../packages/contracts/operations.js';
import { addUserMessage, applyTurn, buildContext, compactModelContext, createPatient, importState } from '../packages/domain/index.js';
import { digest, issueToken } from '../apps/api/auth.js';
import { ApiError } from '../apps/api/errors.js';
import { handleOperations, operationPayloadHash, type OperationDependencies } from '../apps/api/operations.js';
import { OPERATION_LIFETIME_MS, expireOperation, providerBudget, reservationReceipt, runOperation, transition, verifyOperationWorkspace } from '../apps/api/model-operation.js';
import { initialOperation, type OperationScope, type OperationStore, type StoredOperation } from '../apps/api/operation-store.js';
import type { QuotaStore, Reservation, ReservationInput } from '../apps/api/quota.js';
import type { WorkspaceSnapshot, WorkspaceStore } from '../apps/api/workspace-store.js';

const startTime = Date.parse('2026-10-18T08:00:00Z');
const env = { DEMO_ACCESS_CODE_HASH: digest('fictional-operation-password'), SESSION_SECRET: 'fictional-operation-secret-longer-than-32-characters', OPENROUTER_API_KEY: 'fictional-key' };
const scope: OperationScope = { workspaceId: 'owner-demo', principalId: digest(env.DEMO_ACCESS_CODE_HASH).slice(0, 32) };
const model = 'anthropic/claude-sonnet-5.5';
const result: TurnResult = { action: 'question', utterance: 'מה תרצה לשמור ממה שכתבת?', topic: 'תיעוד הפגישה', rationale: 'בדיקה בדיונית.', fieldUpdates: [], preferenceUpdates: [], evidenceMap: [] };
const key = (scope: OperationScope, id: string) => JSON.stringify([scope.workspaceId, scope.principalId, id]);

class MemoryOperations implements OperationStore {
  records = new Map<string, StoredOperation>();
  events: string[] = [];
  beforeReplace?: (value: StoredOperation) => void;
  afterReplace?: (value: StoredOperation) => void;
  async create(scope: OperationScope, input: OperationStartRequest, payloadHash: string, now: number) {
    const identity = key(scope, input.requestId); const old = this.records.get(identity);
    if (old && old.payloadHash !== payloadHash) throw new ApiError(409, 'request_id_conflict');
    if (old) return structuredClone(old);
    const operation = initialOperation(input, payloadHash, now); this.records.set(identity, operation); this.events.push('created');
    return structuredClone(operation);
  }
  async get(scope: OperationScope, id: string) { return structuredClone(this.records.get(key(scope, id)) ?? null); }
  async list(scope: OperationScope, limit: number) {
    return structuredClone([...this.records.entries()].filter(([identity, item]) => identity.startsWith(JSON.stringify([scope.workspaceId, scope.principalId]).slice(0, -1) + ',')
      && ((!item.acknowledgedAt && !item.dismissedAt) || (item.settlement && !item.settledAt))).map(([, item]) => item).slice(0, limit));
  }
  async replace(scope: OperationScope, previous: StoredOperation, next: StoredOperation) {
    if (this.records.get(key(scope, previous.id))?.version !== previous.version) return null;
    this.beforeReplace?.(next);
    this.records.set(key(scope, previous.id), structuredClone(next)); this.events.push(next.status);
    this.afterReplace?.(next);
    return structuredClone(next);
  }
}
class MemoryWorkspace implements WorkspaceStore {
  records = new Map<string, WorkspaceSnapshot>();
  async load(id: string) { return structuredClone(this.records.get(id) ?? { revision: 0, updatedAt: null, state: null }); }
  async save(id: string, expectedRevision: number, state: PortalState) {
    const current = this.records.get(id); if ((current?.revision ?? 0) !== expectedRevision) return null;
    const snapshot = { revision: expectedRevision + 1, updatedAt: new Date(startTime).toISOString(), state: structuredClone(state) };
    this.records.set(id, snapshot); return { revision: snapshot.revision, updatedAt: snapshot.updatedAt };
  }
}
class MemoryQuota implements QuotaStore {
  reservations: ReservationInput[] = []; finalizations: { reservation: Reservation; result: Parameters<QuotaStore['finalize']>[1] }[] = [];
  failFinalize = false; lostReserveReply = false; beforeFinalize?: () => void;
  async ping() {} async accessAttempt() {}
  async reserve(input: ReservationInput) {
    if (this.reservations.some(item => item.requestId === input.requestId && item.codeId === input.codeId)) throw new ApiError(409, 'request_pending');
    this.reservations.push(structuredClone(input));
    if (this.lostReserveReply) throw new ApiError(503, 'quota_store_unavailable');
    return reservationReceipt(input);
  }
  async finalize(reservation: Reservation, result: Parameters<QuotaStore['finalize']>[1]) {
    this.beforeFinalize?.();
    if (this.failFinalize) throw new ApiError(503, 'quota_store_unavailable');
    if (!this.finalizations.some(item => item.reservation.requestKey === reservation.requestKey)) this.finalizations.push({ reservation, result });
  }
}
function fixture() {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(startTime);
  const created = createPatient({ schemaVersion: 1, patients: [], branches: [], sessions: [], sources: [], versions: [], preferences: [] }, { name: 'Fictional journal QA' });
  const state = addUserMessage(created.state, created.session.id, 'This text is invented only for operation recovery checks.');
  const input: OperationStartRequest = { requestId: 'fictional-operation-1', task: 'turn', model, workspaceRevision: 1,
    context: compactModelContext(buildContext(state, created.session.id)) };
  result.questionAnchor = { sourceIds: [input.context.sources.at(-1)!.id], fieldIds: [] };
  const store = new MemoryOperations(); const workspace = new MemoryWorkspace(); const quota = new MemoryQuota();
  workspace.records.set(scope.workspaceId, { revision: 1, updatedAt: new Date(startTime).toISOString(), state });
  const background: Promise<unknown>[] = [];
  let clock = startTime; let providerCalls = 0; let rejectProvider = false;
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: model, context_length: 1_000_000,
      pricing: { prompt: 0.000002, completion: 0.00001 }, supported_parameters: ['response_format', 'structured_outputs', 'max_tokens'] }] });
    providerCalls++;
    if (rejectProvider) throw new Error('private upstream content must stay private');
    return Response.json({ id: 'fictional-response', model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
      usage: { prompt_tokens: 200, completion_tokens: 80, cost: 0.003 } });
  }) as unknown as typeof fetch;
  const dependencies = { env, store, workspace, quota, fetcher, now: () => clock,
    waitUntil: (work: Promise<unknown>) => { expect(store.events).toContain('created'); background.push(work); } };
  const request = (method: string, body?: unknown, query = '', configuration = env, token = issueToken(configuration, clock).token) => new Request(`https://fictional.test/api/operations${query}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const dispatch = (body: unknown = input, overrides: Partial<OperationDependencies> = {}) => handleOperations(request('POST', body), { ...dependencies, ...overrides });
  const detail = () => store.get(scope, input.requestId);
  const drain = async () => { while (background.length) await Promise.all(background.splice(0)); };
  return { input, state, store, workspace, quota, dependencies, request, dispatch, detail, drain, providerCalls: () => providerCalls,
    advance: (ms: number) => { clock += ms; vi.setSystemTime(clock); }, rejectProvider: () => { rejectProvider = true; } };
}
afterEach(() => vi.useRealTimers());

describe('durable AI operation lifecycle', () => {
  it('persists before waitUntil, atomically claims concurrent starts, and replays one durable result', async () => {
    const f = fixture();
    const starts = await Promise.all([f.dispatch(), f.dispatch()]);
    expect(starts.every(response => response.status === 202)).toBe(true);
    await f.drain();
    expect(f.providerCalls()).toBe(1); expect(f.quota.reservations).toHaveLength(1);
    expect((await f.detail())?.status).toBe('succeeded');
    const replay = await f.dispatch(); await f.drain();
    expect(replay.status).toBe(200); expect((await replay.json()).operation.response.result).toEqual(result);
    expect(f.providerCalls()).toBe(1);
  });

  it('rejects a reused request ID with changed task/model/context or source revision', async () => {
    const f = fixture(); await f.dispatch(); await f.drain();
    for (const changed of [
      { ...f.input, model: 'google/gemini-3.8-flash' }, { ...f.input, workspaceRevision: 2 },
      { ...f.input, task: 'draft', context: { ...f.input.context, stage: 'draft' } },
      { ...f.input, context: { ...f.input.context, patientName: 'Changed fictional label' } },
    ]) {
      const response = await f.dispatch(changed); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'request_id_conflict' });
    }
    expect(f.providerCalls()).toBe(1);
  });

  it('compares canonical context without treating a fresh asOf as a new request', async () => {
    const f = fixture(); await f.dispatch(); await f.drain();
    const changed = { ...f.input, context: { ...f.input.context, asOf: new Date(startTime + 1000).toISOString() } };
    expect(comparableOperationContext(changed.context)).toBe(comparableOperationContext(f.input.context));
    expect((await f.dispatch(changed)).status).toBe(200);
    expect((await f.detail())?.context.asOf).toBe(f.input.context.asOf);
  });

  it('accepts the next draft after a recovered trace crosses JSONB storage and workspace import', async () => {
    const f = fixture(); const source = f.input.context.sources.at(-1)!;
    const response: TurnResult = { ...result, evidenceMap: [{ sourceId: source.id, quote: source.text, attribution: 'clinician_report',
      kind: 'event', temporalReference: '', fieldIds: [6], destinations: ['intake'], uncertainty: 'unspecified' }] };
    const applied = applyTurn(f.state, f.input.context.sessionId, f.input.context.baseRevision, response);
    applied.sessions[0].traces.push({ id: 'fictional-recovered-trace', at: new Date(startTime).toISOString(), mode: 'live',
      model, promptVersion: 'fixture', prompt: 'Artificial fixture', contextOrigin: 'server', context: f.input.context, response, elapsedMs: 1 });
    const reordered = JSON.parse(canonicalOperationValue(applied)) as PortalState;
    const clientState = importState(JSON.stringify(reordered));
    const context = compactModelContext(buildContext(clientState, f.input.context.sessionId, 'draft'));
    f.workspace.records.set(scope.workspaceId, { revision: 2, updatedAt: new Date(startTime).toISOString(), state: reordered });
    expect(context.evidenceMap).toHaveLength(1);
    await expect(verifyOperationWorkspace(f.workspace, scope, context, 2, true)).resolves.toBeUndefined();
    expect(f.providerCalls()).toBe(0);
  });

  it('rejects unsaved or forged scoped context before any provider call', async () => {
    const f = fixture();
    for (const changed of [{ ...f.input, workspaceRevision: 2 }, { ...f.input, context: { ...f.input.context, patientName: 'Forged fictional context' } }]) {
      expect((await f.dispatch(changed)).status).toBe(409);
    }
    expect(f.providerCalls()).toBe(0); expect(f.store.records.size).toBe(0);
  });

  it('rechecks persisted scope after queueing before inference', async () => {
    const f = fixture();
    const queued = await f.store.create(scope, f.input, operationPayloadHash(f.input), startTime);
    f.workspace.records.get(scope.workspaceId)!.state = addUserMessage(f.state, f.input.context.sessionId, 'Newer invented source.');
    await runOperation(scope, queued, f.dependencies, startTime);
    expect((await f.detail())?.errorCode).toBe('workspace_context_mismatch'); expect(f.providerCalls()).toBe(0);
  });

  it('scopes GET/detail/list to both workspace and authentication subject', async () => {
    const f = fixture(); await f.dispatch(); await f.drain();
    for (const configuration of [{ ...env, DEMO_WORKSPACE_ID: 'another-workspace' }, { ...env, DEMO_ACCESS_CODE_HASH: digest('another-fictional-password') }]) {
      const deps = { ...f.dependencies, env: configuration };
      expect((await handleOperations(f.request('GET', undefined, '?requestId=' + f.input.requestId, configuration), deps)).status).toBe(404);
      expect(await (await handleOperations(f.request('GET', undefined, '', configuration), deps)).json()).toEqual({ operations: [] });
    }
    const unauthorized = await handleOperations(f.request('GET', undefined, '', env, 'invalid'), f.dependencies);
    expect(unauthorized.status).toBe(401);
    const summary = await (await handleOperations(f.request('GET'), f.dependencies)).json();
    expect(summary.operations).toHaveLength(1); expect(summary.operations[0]).not.toHaveProperty('context');
    expect(summary.operations[0]).not.toHaveProperty('payloadHash');
  });

  it('records an unknown provider outcome and never redispatches it on reconnect', async () => {
    const f = fixture(); f.rejectProvider(); await f.dispatch(); await f.drain();
    expect((await f.detail())?.status).toBe('uncertain');
    expect(f.quota.finalizations[0].result).toMatchObject({ status: 'uncertain' });
    expect(f.quota.finalizations[0].result.costMicros).toBeUndefined();
    await f.dispatch(); await handleOperations(f.request('GET', undefined, '?requestId=' + f.input.requestId), f.dependencies); await f.drain();
    expect(f.providerCalls()).toBe(1);
    expect(JSON.stringify(await f.detail())).not.toContain('private upstream');
  });

  it('recovers expired provider-marked work as uncertain without making another paid attempt', async () => {
    const f = fixture(); const queued = await f.store.create(scope, f.input, operationPayloadHash(f.input), startTime);
    const intent: ReservationInput = { codeId: scope.principalId, sessionKey: `${f.input.context.patientId}:${f.input.context.branchId}:${f.input.context.sessionId}`,
      requestId: f.input.requestId, payloadHash: queued.payloadHash, micros: 1000, now: startTime, revision: f.input.context.baseRevision, questionCount: 0, intakeCount: 0, intakeRound: 0 };
    await f.store.replace(scope, queued, transition(queued, startTime, { status: 'running', deadlineAt: startTime + OPERATION_LIFETIME_MS,
      providerStartedAt: new Date(startTime).toISOString(), reservationIntent: intent, reservation: reservationReceipt(intent) }));
    f.advance(OPERATION_LIFETIME_MS + 1);
    const response = await handleOperations(f.request('GET', undefined, '?requestId=' + f.input.requestId), f.dependencies); await f.drain();
    expect((await response.json()).operation.status).toBe('uncertain'); expect(f.providerCalls()).toBe(0);
    expect(f.quota.finalizations[0].result.costMicros).toBeUndefined();
    await f.dispatch(); await f.drain(); expect(f.providerCalls()).toBe(0);
  });

  it('retains the result before quota finalization and recovers settlement without inference', async () => {
    const f = fixture(); f.quota.failFinalize = true;
    f.quota.beforeFinalize = () => { expect(f.store.records.get(key(scope, f.input.requestId))?.response?.result).toEqual(result); };
    await f.dispatch(); await f.drain();
    expect((await f.detail())?.status).toBe('succeeded'); expect((await f.detail())?.settledAt).toBeUndefined();
    f.quota.failFinalize = false;
    const response = await handleOperations(f.request('GET', undefined, '?requestId=' + f.input.requestId), f.dependencies); await f.drain();
    expect((await response.json()).operation.response.result).toEqual(result);
    expect((await f.detail())?.settledAt).toBeDefined(); expect(f.quota.finalizations).toHaveLength(1); expect(f.providerCalls()).toBe(1);
  });

  it('keeps a successfully committed result if the DB acknowledgement is lost', async () => {
    const f = fixture(); let failed = false;
    f.store.afterReplace = operation => { if (operation.status === 'succeeded' && !failed) { failed = true; throw new Error('Lost database acknowledgement'); } };
    await f.dispatch(); await f.drain();
    expect((await f.detail())?.status).toBe('succeeded'); expect((await f.detail())?.response?.result).toEqual(result);
    expect(f.quota.finalizations[0].result.status).toBe('done'); expect(f.providerCalls()).toBe(1);
  });

  it('retries a transient precommit result write without discarding the validated response', async () => {
    const f = fixture(); let attempts = 0;
    f.store.beforeReplace = operation => { if (operation.status === 'succeeded' && attempts++ === 0) throw new Error('Transient precommit failure'); };
    await f.dispatch(); await f.drain();
    expect((await f.detail())?.status).toBe('succeeded'); expect((await f.detail())?.response?.result).toEqual(result);
    expect(f.quota.finalizations[0].result.status).toBe('done'); expect(f.providerCalls()).toBe(1); expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it('never settles a known result as failed when every result-persistence attempt fails', async () => {
    const f = fixture(); let attempts = 0;
    f.store.beforeReplace = operation => { if (operation.status === 'succeeded') { attempts++; throw new Error('Result storage unavailable'); } };
    await f.dispatch(); await f.drain();
    expect(attempts).toBe(3); expect((await f.detail())?.status).toBe('running'); expect(f.quota.finalizations).toHaveLength(0);
    f.advance(OPERATION_LIFETIME_MS + 1);
    const recovered = await handleOperations(f.request('GET', undefined, '?requestId=' + f.input.requestId), f.dependencies); await f.drain();
    expect((await recovered.json()).operation.status).toBe('uncertain');
    expect(f.quota.finalizations[0].result.costMicros).toBeUndefined(); expect(f.providerCalls()).toBe(1);
  });

  it('safely releases a reservation whose reply was lost before any provider dispatch', async () => {
    const f = fixture(); f.quota.lostReserveReply = true; await f.dispatch(); await f.drain();
    expect((await f.detail())?.status).toBe('failed'); expect(f.providerCalls()).toBe(0);
    expect(f.quota.finalizations[0].reservation).toEqual(reservationReceipt(f.quota.reservations[0]));
    expect(f.quota.finalizations[0].result).toMatchObject({ costMicros: 0, status: 'failed' });
  });

  it('bounds the provider budget by the original invocation deadline', async () => {
    expect(providerBudget(startTime + OPERATION_LIFETIME_MS, startTime)).toBe(180000);
    expect(providerBudget(startTime + OPERATION_LIFETIME_MS, startTime + 50000)).toBe(140000);
    expect(() => providerBudget(startTime + OPERATION_LIFETIME_MS, startTime + 190000)).toThrow('operation_deadline');
    const f = fixture(); f.store.afterReplace = operation => { if (operation.providerStartedAt) f.advance(190000); };
    await f.dispatch(); await f.drain();
    expect(f.providerCalls()).toBe(0); expect((await f.detail())?.status).toBe('failed');
    expect(f.quota.finalizations[0].result.costMicros).toBe(0);
  });

  it('requires the exact durable server trace before acknowledgement and then hides it from the list', async () => {
    const f = fixture(); await f.dispatch(); await f.drain();
    const ack = { action: 'ack', requestId: f.input.requestId, workspaceRevision: 2 };
    expect((await f.dispatch(ack)).status).toBe(409);
    const operation = (await f.detail())!; const response = operation.response!;
    const saved = structuredClone(f.state); saved.sessions[0].traces.push({ id: operation.id, at: new Date(startTime).toISOString(), mode: 'live', contextOrigin: 'server',
      model: response.model, promptVersion: response.promptVersion, prompt: response.prompt, context: response.effectiveContext!, response: response.result,
      elapsedMs: response.elapsedMs, usage: response.usage });
    f.workspace.records.set(scope.workspaceId, { revision: 2, updatedAt: new Date(startTime).toISOString(), state: saved });
    expect((await f.dispatch(ack)).status).toBe(200); await f.drain();
    expect((await f.detail())?.acknowledgedAt).toBeDefined();
    expect(await (await handleOperations(f.request('GET'), f.dependencies)).json()).toEqual({ operations: [] });
    expect((await f.dispatch(ack)).status).toBe(200); expect(f.providerCalls()).toBe(1);
  });

  it('separates explicit stale-result dismissal from successful application', async () => {
    const f = fixture(); await f.dispatch(); await f.drain();
    const dismiss = { action: 'dismiss', requestId: f.input.requestId };
    expect((await f.dispatch(dismiss)).status).toBe(409);
    f.workspace.records.get(scope.workspaceId)!.state = addUserMessage(f.state, f.input.context.sessionId, 'Another invented source changes the context.');
    expect((await f.dispatch(dismiss)).status).toBe(200);
    expect((await f.detail())?.dismissedAt).toBeDefined(); expect((await f.detail())?.acknowledgedAt).toBeUndefined();
    expect(await (await handleOperations(f.request('GET'), f.dependencies)).json()).toEqual({ operations: [] });
  });

  it('retains pending settlement recovery even after an explicit dismissal', async () => {
    const f = fixture(); f.rejectProvider(); f.quota.failFinalize = true; await f.dispatch(); await f.drain();
    expect((await f.dispatch({ action: 'dismiss', requestId: f.input.requestId })).status).toBe(200); await f.drain();
    f.quota.failFinalize = false;
    expect(await (await handleOperations(f.request('GET'), f.dependencies)).json()).toEqual({ operations: [] }); await f.drain();
    expect((await f.detail())?.settledAt).toBeDefined(); expect(f.providerCalls()).toBe(1);
  });
});

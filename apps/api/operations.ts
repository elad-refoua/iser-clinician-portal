import { waitUntil as vercelWaitUntil } from '@vercel/functions';
import { z } from 'zod';
import { MAX_MODEL_REQUEST_BYTES } from '../../packages/contracts/index.js';
import { canonicalOperationValue, comparableOperationContext, type OperationDetail, type OperationStartRequest, type OperationSummary } from '../../packages/contracts/operations.js';
import { buildContext, compactModelContext } from '../../packages/domain/index.js';
import { authenticate, digest } from './auth.js';
import { ApiError, type Environment } from './errors.js';
import { cors, readBody } from './handler.js';
import { expireOperation, operationTerminal, runOperation, settleOperation, transition, verifyOperationWorkspace, type OperationExecution } from './model-operation.js';
import { operationStore, type OperationScope, type OperationStore, type StoredOperation } from './operation-store.js';
import { RedisQuotaStore, type QuotaStore } from './quota.js';
import { validateRequest, ValidationError } from './validation.js';
import { workspaceStore, type WorkspaceStore } from './workspace-store.js';

export interface OperationDependencies {
  env?: Environment; store?: OperationStore; workspace?: WorkspaceStore; quota?: QuotaStore;
  fetcher?: typeof fetch; now?: () => number; waitUntil?: (promise: Promise<unknown>) => void;
}
const id = z.string().min(1).max(160).regex(/^[\p{L}\p{N}_.:-]+$/u);
const revision = z.number().int().min(1).max(2_147_483_647);
const startSchema = z.object({ requestId: id, task: z.enum(['turn', 'draft']), model: z.string(), context: z.unknown(), workspaceRevision: revision }).strict();
const ackSchema = z.object({ action: z.literal('ack'), requestId: id, workspaceRevision: revision }).strict();
const dismissSchema = z.object({ action: z.literal('dismiss'), requestId: id }).strict();
export const OPERATION_LIST_LIMIT = 40;

export function operationSummary(operation: StoredOperation): OperationSummary {
  const { id, task, model, patientId, branchId, sessionId, baseRevision, status, createdAt, updatedAt, errorCode, acknowledgedAt } = operation;
  return { id, task, model, patientId, branchId, sessionId, baseRevision, status, createdAt, updatedAt,
    ...(errorCode ? { errorCode } : {}), ...(acknowledgedAt ? { acknowledgedAt } : {}) };
}
export function operationDetail(operation: StoredOperation): OperationDetail {
  return { ...operationSummary(operation), context: operation.context,
    ...(operation.response ? { response: operation.response } : {}), ...(operation.minimumRevision ? { minimumRevision: operation.minimumRevision } : {}) };
}
export function operationPayloadHash(input: OperationStartRequest) {
  return digest(canonicalOperationValue({ task: input.task, model: input.model, workspaceRevision: input.workspaceRevision,
    context: JSON.parse(comparableOperationContext(input.context)) }));
}
function background(work: Promise<unknown>, schedule: (promise: Promise<unknown>) => void) {
  schedule(work.catch(() => { console.warn('operation_background_incomplete'); }));
}

type ReviewExecution = Pick<OperationExecution, 'store' | 'workspace' | 'now'>;
async function markReviewed(scope: OperationScope, original: StoredOperation, field: 'acknowledgedAt' | 'dismissedAt', execution: ReviewExecution) {
  let current = original;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (current[field]) return current;
    const changed = await execution.store.replace(scope, current, transition(current, execution.now(), { [field]: new Date(execution.now()).toISOString() }));
    if (changed) return changed;
    const latest = await execution.store.get(scope, current.id);
    if (!latest || latest.status !== original.status) throw new ApiError(409, 'operation_changed');
    current = latest;
  }
  throw new ApiError(409, 'operation_changed');
}
async function acknowledge(scope: OperationScope, operation: StoredOperation, workspaceRevision: number, execution: ReviewExecution) {
  if (operation.acknowledgedAt) return operation;
  if (operation.status !== 'succeeded' || !operation.response) throw new ApiError(409, 'operation_not_succeeded');
  const snapshot = await execution.workspace.load(scope.workspaceId);
  if (!snapshot.state || snapshot.revision < workspaceRevision || workspaceRevision < operation.workspaceRevision)
    throw new ApiError(409, 'operation_result_not_saved');
  const session = snapshot.state.sessions.find(item => item.id === operation.sessionId && item.patientId === operation.patientId && item.branchId === operation.branchId);
  const trace = session?.traces.find(item => item.id === operation.id);
  const expectedContext = operation.response.effectiveContext ?? operation.context;
  if (!trace || trace.contextOrigin !== 'server' || trace.mode !== 'live'
    || canonicalOperationValue(trace.response) !== canonicalOperationValue(operation.response.result)
    || canonicalOperationValue(trace.context) !== canonicalOperationValue(expectedContext)
    || trace.model !== operation.response.model || trace.prompt !== operation.response.prompt || trace.promptVersion !== operation.response.promptVersion)
    throw new ApiError(409, 'operation_result_not_saved');
  return markReviewed(scope, operation, 'acknowledgedAt', execution);
}
async function dismiss(scope: OperationScope, operation: StoredOperation, execution: ReviewExecution) {
  if (operation.dismissedAt || operation.acknowledgedAt) return operation;
  if (!operationTerminal(operation)) throw new ApiError(409, 'operation_in_progress');
  if (operation.status === 'succeeded') {
    const snapshot = await execution.workspace.load(scope.workspaceId);
    const session = snapshot.state?.sessions.find(item => item.id === operation.sessionId && item.patientId === operation.patientId && item.branchId === operation.branchId);
    if (session && snapshot.state && !snapshot.state.sessions.some(item => item.branchId === session.branchId && item.number > session.number)
      && comparableOperationContext(compactModelContext(buildContext(snapshot.state, session.id, operation.context.stage))) === comparableOperationContext(operation.context))
      throw new ApiError(409, 'operation_result_still_current');
  }
  return markReviewed(scope, operation, 'dismissedAt', execution);
}

export async function handleOperations(request: Request, dependencies: OperationDependencies = {}): Promise<Response> {
  const env = dependencies.env ?? process.env; const now = dependencies.now ?? Date.now; const invocationStartedAt = now();
  const fetcher = dependencies.fetcher ?? fetch; const schedule = dependencies.waitUntil ?? vercelWaitUntil;
  let headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  try {
    headers = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'POST'].includes(request.method)) throw new ApiError(405, 'method_not_allowed');
    const claims = authenticate(request, env, now());
    const workspaceId = env.DEMO_WORKSPACE_ID || 'owner-demo';
    if (!workspaceId.trim() || workspaceId.length > 160) throw new ApiError(503, 'workspace_not_configured');
    const scope: OperationScope = { workspaceId, principalId: claims.sub };
    const store = dependencies.store ?? operationStore(env);
    const workspace = dependencies.workspace ?? workspaceStore(env);
    // Reading a durable result remains available when quota configuration is temporarily absent.
    const execution = () => ({ env, store, workspace, quota: dependencies.quota ?? new RedisQuotaStore(env, fetcher), fetcher, now });
    const recover = (operation: StoredOperation) => {
      if (operation.status !== 'queued' && (!operation.settlement || operation.settledAt)) return;
      background((async () => {
        const deps = execution();
        if (operation.status === 'queued') await runOperation(scope, operation, deps, invocationStartedAt);
        else await settleOperation(scope, operation, deps);
      })(), schedule);
    };
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams;
      if ([...query.keys()].some(key => key !== 'requestId') || query.getAll('requestId').length > 1) throw new ApiError(400, 'invalid_operation_request');
      if (query.has('requestId')) {
        const requestId = id.safeParse(query.get('requestId'));
        if (!requestId.success) throw new ApiError(400, 'invalid_operation_request');
        const stored = await store.get(scope, requestId.data);
        if (!stored) throw new ApiError(404, 'operation_not_found');
        const operation = await expireOperation(scope, stored, { store, now }); recover(operation);
        return Response.json({ operation: operationDetail(operation) }, { headers });
      }
      const stored = await store.list(scope, OPERATION_LIST_LIMIT);
      const operations: OperationSummary[] = [];
      for (const row of stored) {
        const operation = await expireOperation(scope, row, { store, now }); recover(operation);
        if (!operation.acknowledgedAt && !operation.dismissedAt) operations.push(operationSummary(operation));
      }
      return Response.json({ operations }, { headers });
    }
    const raw = await readBody(request, MAX_MODEL_REQUEST_BYTES + 1024);
    if (raw && typeof raw === 'object' && 'action' in raw) {
      const parsed = z.union([ackSchema, dismissSchema]).safeParse(raw);
      if (!parsed.success) throw new ApiError(400, 'invalid_operation_request');
      const stored = await store.get(scope, parsed.data.requestId);
      if (!stored) throw new ApiError(404, 'operation_not_found');
      const operation = await expireOperation(scope, stored, { store, now });
      const deps = { store, workspace, now };
      // Ack/dismiss need storage, not a live quota connection.
      const changed = parsed.data.action === 'ack'
        ? await acknowledge(scope, operation, parsed.data.workspaceRevision, deps)
        : await dismiss(scope, operation, deps);
      recover(changed);
      return Response.json({ operation: operationDetail(changed) }, { headers });
    }
    const parsed = startSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'invalid_operation_request');
    const { task, workspaceRevision, ...modelRequest } = parsed.data;
    const input: OperationStartRequest = { ...validateRequest(modelRequest, task), task, workspaceRevision };
    const payloadHash = operationPayloadHash(input);
    let operation = await store.get(scope, input.requestId);
    if (operation && operation.payloadHash !== payloadHash) throw new ApiError(409, 'request_id_conflict');
    if (!operation) {
      if (!env.OPENROUTER_API_KEY) throw new ApiError(503, 'provider_not_configured');
      execution();
      await verifyOperationWorkspace(workspace, scope, input.context, workspaceRevision, true);
      operation = await store.create(scope, input, payloadHash, now());
    }
    operation = await expireOperation(scope, operation, { store, now }); recover(operation);
    return Response.json({ operation: operationDetail(operation) }, { status: operationTerminal(operation) ? 200 : 202, headers });
  } catch (error) {
    if (error instanceof ValidationError) console.warn('validation_failed', { route: 'operations', code: error.code, ...error.diagnostics });
    return Response.json({ error: error instanceof ApiError ? error.code : 'operation_request_failed',
      ...(error instanceof ApiError && error.minimumRevision ? { minimumRevision: error.minimumRevision } : {}),
    }, { status: error instanceof ApiError ? error.status : 500, headers });
  }
}

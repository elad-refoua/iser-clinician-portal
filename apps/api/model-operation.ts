import { randomUUID } from 'node:crypto';
import { PROMPT_VERSION, buildSystemPrompt } from '../../packages/prompts/index.js';
import { buildContext, compactModelContext } from '../../packages/domain/index.js';
import type { ContextPacket, DraftResult, ModelResponse, TurnResult } from '../../packages/contracts/index.js';
import { comparableOperationContext } from '../../packages/contracts/operations.js';
import { digest } from './auth.js';
import { ApiError, type Environment } from './errors.js';
import { type OperationScope, type OperationStore, type SettlementIntent, type StoredOperation } from './operation-store.js';
import { callProvider, getModels, prepareProviderRequest, PROVIDER_TIMEOUT_MS, ProviderError } from './provider.js';
import type { QuotaStore, Reservation, ReservationInput } from './quota.js';
import { normalizeWireResult, responseSchema, shouldFinish, validateResult } from './validation.js';
import type { WorkspaceStore } from './workspace-store.js';

// Vercel's 240s lifetime includes the foreground request and waitUntil work.
export const OPERATION_LIFETIME_MS = 230_000;
export const OPERATION_COMPLETION_MARGIN_MS = 40_000;
export interface OperationExecution {
  env: Environment; store: OperationStore; workspace: WorkspaceStore; quota: QuotaStore;
  fetcher: typeof fetch; now: () => number;
}
const terminal = (operation: StoredOperation) => !['queued', 'running'].includes(operation.status);
export const operationTerminal = terminal;
export function transition(operation: StoredOperation, now: number, patch: Partial<StoredOperation>): StoredOperation {
  return { ...operation, ...patch, version: operation.version + 1, updatedAt: new Date(now).toISOString() };
}
/** Matches the existing Redis v1 receipt; needed if the reservation reply is lost. */
export function reservationReceipt(input: ReservationInput): Reservation {
  return { requestKey: `iser:v1:request:${digest(`${input.codeId}:${input.requestId}`)}`,
    day: new Date(input.now).toISOString().slice(0, 10), sessionKey: digest(`${input.codeId}:${input.sessionKey}`),
    questionCount: input.questionCount, intakeCount: input.intakeCount, intakeRound: input.intakeRound };
}
export async function verifyOperationWorkspace(workspace: WorkspaceStore, scope: OperationScope,
  context: ContextPacket, workspaceRevision: number, exactRevision: boolean) {
  const snapshot = await workspace.load(scope.workspaceId);
  if (!snapshot.state || snapshot.revision < workspaceRevision || (exactRevision && snapshot.revision !== workspaceRevision))
    throw new ApiError(409, 'workspace_revision_mismatch');
  const session = snapshot.state.sessions.find(item => item.id === context.sessionId);
  if (!session || session.patientId !== context.patientId || session.branchId !== context.branchId)
    throw new ApiError(409, 'workspace_context_mismatch');
  if (snapshot.state.sessions.some(item => item.branchId === session.branchId && item.number > session.number))
    throw new ApiError(409, 'workspace_context_mismatch');
  const canonical = compactModelContext(buildContext(snapshot.state, context.sessionId, context.stage === 'draft' ? 'draft' : undefined));
  if (comparableOperationContext(canonical) !== comparableOperationContext(context)) throw new ApiError(409, 'workspace_context_mismatch');
}
export function providerBudget(deadlineAt: number, now: number): number {
  const remaining = Math.floor(deadlineAt - now - OPERATION_COMPLETION_MARGIN_MS);
  if (remaining < 1000) throw new ApiError(503, 'operation_deadline');
  return Math.min(PROVIDER_TIMEOUT_MS, remaining);
}
function failureSettlement(operation: StoredOperation): SettlementIntent | undefined {
  const reservation = operation.reservation ?? (operation.reservationIntent && reservationReceipt(operation.reservationIntent));
  return reservation ? { reservation, result: { ...(operation.providerStartedAt ? {} : { costMicros: 0 }),
    status: operation.providerStartedAt ? 'uncertain' : 'failed', asked: null, revision: operation.baseRevision } } : undefined;
}

/** Recovery is limited to idempotent quota settlement. It never calls the model. */
export async function settleOperation(scope: OperationScope, operation: StoredOperation, execution: Pick<OperationExecution, 'store' | 'quota' | 'now'>) {
  if (!terminal(operation) || !operation.settlement || operation.settledAt) return;
  try {
    await execution.quota.finalize(operation.settlement.reservation, operation.settlement.result);
    // Ack/dismiss may have advanced the row while Redis completed.
    let current = operation;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (current.settledAt || !current.settlement || !terminal(current)) return;
      if (await execution.store.replace(scope, current, transition(current, execution.now(), { settledAt: new Date(execution.now()).toISOString() }))) return;
      const latest = await execution.store.get(scope, operation.id);
      if (!latest) return;
      current = latest;
    }
  } catch { /* The persisted settlement remains available to authenticated recovery. */ }
}

/** An expired claimed operation cannot be claimed again, even before inference. */
export async function expireOperation(scope: OperationScope, operation: StoredOperation, execution: Pick<OperationExecution, 'store' | 'now'>) {
  if (operation.status !== 'running' || !operation.deadlineAt || execution.now() < operation.deadlineAt) return operation;
  const changed = await execution.store.replace(scope, operation, transition(operation, execution.now(), {
    status: operation.providerStartedAt ? 'uncertain' : 'failed', errorCode: operation.providerStartedAt ? 'provider_outcome_uncertain' : 'operation_interrupted',
    ...(failureSettlement(operation) ? { settlement: failureSettlement(operation) } : {}),
  }));
  return changed ?? await execution.store.get(scope, operation.id) ?? operation;
}

async function persistSuccess(scope: OperationScope, original: StoredOperation,
  response: ModelResponse<TurnResult | DraftResult>, settlement: SettlementIntent,
  execution: Pick<OperationExecution, 'store' | 'now'>): Promise<StoredOperation | null> {
  let current = original;
  for (let attempt = 0; attempt < 3 && execution.now() < original.deadlineAt!; attempt++) {
    try {
      const saved = await execution.store.replace(scope, current, transition(current, execution.now(), { status: 'succeeded', response, settlement }));
      if (saved) return saved;
    } catch { /* Both a failed write and a lost acknowledgement require readback. */ }
    try {
      const latest = await execution.store.get(scope, original.id);
      if (!latest) return null;
      if (latest.status === 'succeeded') return latest;
      if (terminal(latest) || latest.workerId !== original.workerId) return null;
      current = latest;
    } catch { /* Keep the validated output in memory for the remaining bounded attempts. */ }
  }
  // No billing settlement without durable output. Expiry exposes uncertainty and
  // retains the paid reservation; reconnect never dispatches the provider again.
  return null;
}

export async function runOperation(scope: OperationScope, queued: StoredOperation, execution: OperationExecution, invocationStartedAt: number) {
  const { store, workspace, quota, env, fetcher, now } = execution;
  if (queued.status !== 'queued') return;
  let operation = await store.replace(scope, queued, transition(queued, now(), {
    status: 'running', workerId: randomUUID(), deadlineAt: invocationStartedAt + OPERATION_LIFETIME_MS,
  }));
  if (!operation) return;
  let actualCost: number | undefined;
  let providerDispatched = false;
  try {
    if (!env.OPENROUTER_API_KEY) throw new ApiError(503, 'provider_not_configured');
    providerBudget(operation.deadlineAt!, now());
    await verifyOperationWorkspace(workspace, scope, operation.context, operation.workspaceRevision, false);
    const models = await getModels(fetcher, now());
    const approved = models.find(model => model.id === operation!.model);
    if (!approved?.available || !approved.catalog) throw new ApiError(503, 'model_unavailable');
    const task = operation.task; const c = structuredClone(operation.context); const schema = responseSchema(task);
    const prepared = prepareProviderRequest(approved.catalog, task, buildSystemPrompt({ ...c, questionCount: 3, intakeCount: 2 }, task), c, schema);
    const intent: ReservationInput = { codeId: scope.principalId, sessionKey: `${c.patientId}:${c.branchId}:${c.sessionId}`,
      requestId: operation.id, payloadHash: operation.payloadHash, micros: prepared.micros, now: now(), revision: c.baseRevision,
      questionCount: c.questionCount, intakeCount: c.intakeCount, intakeRound: c.intakeRound ?? 0 };
    const intended = await store.replace(scope, operation, transition(operation, now(), { reservationIntent: intent }));
    if (!intended) return;
    operation = intended;
    providerBudget(operation.deadlineAt!, now());
    let reservation: Reservation;
    try { reservation = await quota.reserve(intent); }
    catch (error) {
      // A known Redis rejection did not reserve anything. An unreadable reply might have.
      if (error instanceof ApiError && error.code !== 'quota_store_unavailable') {
        const failed = await store.replace(scope, operation, transition(operation, now(), {
          status: 'failed', errorCode: error.code, ...(error.minimumRevision ? { minimumRevision: error.minimumRevision } : {}),
        }));
        if (failed) operation = failed;
        return;
      }
      throw error;
    }
    c.questionCount = reservation.questionCount; c.intakeCount = reservation.intakeCount;
    const prompt = buildSystemPrompt(c, task); const started = now();
    const policyFinish = task === 'turn' && (shouldFinish(c) || (c.stage === 'main' ? c.questionCount >= 3 : c.intakeCount >= 2));
    // The marker is durable before any paid request. Its presence forbids re-dispatch.
    const marked = await store.replace(scope, operation, transition(operation, now(), {
      reservation, ...(!policyFinish ? { providerStartedAt: new Date(now()).toISOString() } : {}),
    }));
    if (!marked) return;
    operation = marked;
    let response: ModelResponse<TurnResult | DraftResult>;
    if (policyFinish) {
      actualCost = 0;
      response = { result: { action: 'draft', utterance: 'נעבור לטיוטה עם מה שכבר נמסר.', topic: '', rationale: 'התשאול הסתיים לפי בקשת המטפל או מכסת השאלות.', fieldUpdates: [], preferenceUpdates: [] },
        prompt, promptVersion: PROMPT_VERSION, model: 'server-policy', elapsedMs: 0, usage: { input: 0, output: 0, cost: 0 }, effectiveContext: c };
    } else {
      const finalRequest = prepareProviderRequest(approved.catalog, task, prompt, c, schema, prepared.outputTokens);
      if (finalRequest.micros > prepared.micros) throw new ApiError(400, 'reservation_insufficient');
      const timeout = AbortSignal.timeout(providerBudget(operation.deadlineAt!, now()));
      const boundedFetcher: typeof fetch = (url, init) => fetcher(url, { ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
      providerDispatched = true;
      const reply = await callProvider(env.OPENROUTER_API_KEY, finalRequest.body, approved.catalog, boundedFetcher);
      actualCost = reply.costMicros;
      const result = validateResult(normalizeWireResult(reply.raw), task, c, { requireEvidence: true });
      response = { result, model: reply.model, prompt, promptVersion: PROMPT_VERSION,
        elapsedMs: Math.max(0, now() - started), usage: reply.usage, effectiveContext: c };
    }
    const asked = 'action' in response.result && response.result.action === 'question' ? c.stage === 'intake' ? 'intake' : 'main' : null;
    const succeeded = await persistSuccess(scope, operation, response,
      { reservation, result: { costMicros: actualCost, status: 'done', asked, revision: c.baseRevision } }, execution);
    if (succeeded) await settleOperation(scope, succeeded, execution);
  } catch (error) {
    if (error instanceof ProviderError && error.costMicros !== undefined) actualCost = error.costMicros;
    if (!providerDispatched) actualCost = 0;
    // Read back before writing failure: a successful write can have an ambiguous acknowledgement.
    const current = await store.get(scope, operation.id);
    if (!current) return;
    if (terminal(current)) { await settleOperation(scope, current, execution); return; }
    if (current.workerId !== operation.workerId) return;
    const uncertain = !!current.providerStartedAt && actualCost === undefined;
    const intent = failureSettlement(current);
    if (intent && current.providerStartedAt) intent.result = { costMicros: actualCost, status: uncertain ? 'uncertain' : 'failed', asked: null, revision: current.baseRevision };
    const failed = await store.replace(scope, current, transition(current, now(), {
      status: uncertain ? 'uncertain' : 'failed', errorCode: error instanceof ApiError ? error.code : 'operation_failed',
      ...(error instanceof ApiError && error.minimumRevision ? { minimumRevision: error.minimumRevision } : {}), ...(intent ? { settlement: intent } : {}),
    }));
    if (failed) await settleOperation(scope, failed, execution);
  }
}

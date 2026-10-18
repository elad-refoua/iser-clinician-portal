import type { PortalState, Trace, TurnResult, DraftResult } from '../../packages/contracts';
import type { OperationDetail, OperationSummary, OperationStartRequest } from '../../packages/contracts/operations';
import { comparableOperationContext } from '../../packages/contracts/operations';
import { applyTurn, buildContext, compactModelContext, saveDraft } from '../../packages/domain';
import { apiErrorMessage } from './api-errors';

export class OperationError extends Error {
  beforeCreation = false;
  constructor(public readonly code: string, public readonly status = 0, public readonly minimumRevision?: number) {
    super(apiErrorMessage(code, status || undefined)); this.name = 'OperationError';
  }
}

/** Only explicit pre-insertion rejections prove that there is no job to recover. */
export function rejectedBeforeOperation(error: unknown): boolean {
  return error instanceof OperationError && error.beforeCreation;
}

export function terminalOperationError(operation: OperationDetail): OperationError {
  return new OperationError(operation.errorCode || (operation.status === 'uncertain' ? 'provider_outcome_uncertain' : 'operation_request_failed'), operation.errorCode === 'stale_revision' ? 409 : 0, operation.minimumRevision);
}

/** App-generated turn IDs are UUIDs; deterministic children survive a lost transition. */
export function draftChildId(turnId: string): string { return `draft-${turnId}`; }

export async function findDraftChild(apiURL: string, token: string, turnId: string, signal?: AbortSignal): Promise<OperationDetail | null> {
  try { return await readOperation(apiURL, token, draftChildId(turnId), signal); }
  catch (failure) { if (failure instanceof OperationError && failure.status === 404 && failure.code === 'operation_not_found') return null; throw failure; }
}

async function request(apiURL: string, token: string, path = '', body?: unknown, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${apiURL.replace(/\/$/, '')}/api/operations${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new OperationError(payload.error || 'operation_request_failed', response.status, payload.minimumRevision);
    return payload;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Waiting stopped', 'AbortError');
    if (error instanceof OperationError) throw error;
    throw new OperationError('operation_connection_lost');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function listOperations(apiURL: string, token: string, signal?: AbortSignal): Promise<OperationSummary[]> {
  const data = await request(apiURL, token, '', undefined, signal);
  if (!Array.isArray(data.operations)) throw new OperationError('invalid_operation_response');
  return data.operations;
}

export async function readOperation(apiURL: string, token: string, id: string, signal?: AbortSignal): Promise<OperationDetail> {
  const data = await request(apiURL, token, `?requestId=${encodeURIComponent(id)}`, undefined, signal);
  if (!data.operation || data.operation.id !== id) throw new OperationError('invalid_operation_response');
  return data.operation;
}

export async function startOperation(apiURL: string, token: string, input: OperationStartRequest, signal?: AbortSignal): Promise<OperationDetail> {
  try {
    const data = await request(apiURL, token, '', input, signal);
    if (!data.operation || data.operation.id !== input.requestId) throw new OperationError('invalid_operation_response');
    return data.operation;
  } catch (error) {
    // A lost POST reply does not authorize another generation. Discover the same ID.
    if (!(error instanceof OperationError) || error.status || signal?.aborted) {
      if (error instanceof OperationError) error.beforeCreation = error.status === 401 || ['workspace_revision_mismatch', 'workspace_context_mismatch', 'invalid_operation_request', 'invalid_request', 'operations_not_configured', 'provider_not_configured', 'quota_store_not_configured'].includes(error.code);
      throw error;
    }
    // A lookup rejection cannot establish whether the preceding POST was accepted.
    return readOperation(apiURL, token, input.requestId, signal);
  }
}

export async function waitForOperation(apiURL: string, token: string, initial: OperationDetail, signal: AbortSignal, onStatus?: (operation: OperationDetail) => void): Promise<OperationDetail> {
  let operation = initial;
  while (operation.status === 'queued' || operation.status === 'running') {
    onStatus?.(operation);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Waiting stopped', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2000);
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
    operation = await readOperation(apiURL, token, operation.id, signal);
  }
  return operation;
}

export async function acknowledgeOperation(apiURL: string, token: string, id: string, workspaceRevision: number): Promise<void> {
  await request(apiURL, token, '', { action: 'ack', requestId: id, workspaceRevision });
}

export async function dismissOperation(apiURL: string, token: string, id: string): Promise<void> {
  await request(apiURL, token, '', { action: 'dismiss', requestId: id });
}

export function operationDisposition(state: PortalState, operation: OperationDetail): 'applied' | 'current' | 'stale' {
  const session = state.sessions.find(item => item.id === operation.sessionId && item.patientId === operation.patientId && item.branchId === operation.branchId);
  if (!session) return 'stale';
  if (session.traces.some(trace => trace.id === operation.id)) return 'applied';
  if (state.sessions.some(item => item.branchId === session.branchId && item.number > session.number)) return 'stale';
  try {
    const current = compactModelContext(buildContext(state, session.id, operation.context.stage));
    return comparableOperationContext(current) === comparableOperationContext(operation.context) ? 'current' : 'stale';
  } catch { return 'stale'; }
}

/** Recovered results follow the same proposal/approval path as an uninterrupted response. */
export function applyOperation(state: PortalState, operation: OperationDetail): PortalState {
  const disposition = operationDisposition(state, operation);
  if (disposition === 'applied') return state;
  if (disposition !== 'current') throw new OperationError('operation_stale');
  if (operation.status !== 'succeeded' || !operation.response) throw new OperationError(operation.errorCode || 'operation_not_ready');
  const response = operation.response;
  const next = operation.task === 'draft'
    ? saveDraft(state, operation.sessionId, operation.baseRevision, response.result as DraftResult)
    : applyTurn(state, operation.sessionId, operation.baseRevision, response.result as TurnResult);
  const trace: Trace = { id: operation.id, at: operation.updatedAt, mode: 'live', model: response.model, promptVersion: response.promptVersion,
    prompt: response.prompt, contextOrigin: response.effectiveContext ? 'server' : 'client', context: response.effectiveContext ?? operation.context,
    response: response.result, elapsedMs: response.elapsedMs, usage: response.usage };
  return { ...next, sessions: next.sessions.map(session => session.id === operation.sessionId ? { ...session, traces: [...session.traces, trace] } : session) };
}

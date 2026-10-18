import { neon } from '@neondatabase/serverless';
import { canonicalOperationValue, type OperationDetail, type OperationStartRequest } from '../../packages/contracts/operations.js';
import { ApiError, type Environment } from './errors.js';
import type { QuotaStore, Reservation, ReservationInput } from './quota.js';

export interface OperationScope { workspaceId: string; principalId: string }
export interface SettlementIntent { reservation: Reservation; result: Parameters<QuotaStore['finalize']>[1] }
export interface StoredOperation extends OperationDetail {
  version: number; payloadHash: string; workspaceRevision: number;
  deadlineAt?: number; workerId?: string; providerStartedAt?: string;
  reservationIntent?: ReservationInput; reservation?: Reservation;
  settlement?: SettlementIntent; settledAt?: string; dismissedAt?: string;
}
export interface OperationStore {
  create(scope: OperationScope, input: OperationStartRequest, payloadHash: string, now: number): Promise<StoredOperation>;
  get(scope: OperationScope, requestId: string): Promise<StoredOperation | null>;
  list(scope: OperationScope, limit: number): Promise<StoredOperation[]>;
  /** Compare-and-swap is the claim and every subsequent transition's atomic boundary. */
  replace(scope: OperationScope, previous: StoredOperation, next: StoredOperation): Promise<StoredOperation | null>;
}

export function initialOperation(input: OperationStartRequest, payloadHash: string, now: number): StoredOperation {
  return { id: input.requestId, task: input.task, model: input.model,
    patientId: input.context.patientId, branchId: input.context.branchId, sessionId: input.context.sessionId,
    baseRevision: input.context.baseRevision, context: input.context, workspaceRevision: input.workspaceRevision,
    payloadHash, status: 'queued', version: 1, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
}
function record(row: Record<string, unknown>): StoredOperation {
  const value = row.record as StoredOperation;
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(row.version) || value.version !== row.version
    || typeof value.id !== 'string' || typeof value.payloadHash !== 'string') throw new ApiError(503, 'operation_store_unavailable');
  return value;
}
export class NeonOperationStore implements OperationStore {
  private initialization?: Promise<void>;
  private readonly connectionString: string;
  constructor(env: Environment) {
    const connection = (env.DEMO_DATABASE_URL || env.DATABASE_URL || '').trim();
    try {
      const url = new URL(connection);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname === '/') throw new Error();
    } catch { throw new ApiError(503, 'operations_not_configured'); }
    this.connectionString = connection;
  }
  private query() { return neon(this.connectionString, { fetchOptions: { signal: AbortSignal.timeout(15_000) } }); }
  private async initialize() {
    if (!this.initialization) this.initialization = (async () => {
      const sql = this.query();
      await sql.transaction([
        sql`SELECT pg_advisory_xact_lock(716724, 2)`,
        sql`CREATE TABLE IF NOT EXISTS public.merhav_demo_operations (
          workspace_id text NOT NULL, principal_id text NOT NULL, request_id text NOT NULL,
          payload_hash text NOT NULL, version integer NOT NULL, record jsonb NOT NULL,
          PRIMARY KEY (workspace_id, principal_id, request_id),
          CHECK (version > 0 AND jsonb_typeof(record) = 'object')
        )`,
        sql`CREATE INDEX IF NOT EXISTS merhav_demo_operations_open
          ON public.merhav_demo_operations (workspace_id, principal_id, ((record->>'createdAt')))
          WHERE (record->>'acknowledgedAt' IS NULL AND record->>'dismissedAt' IS NULL)
             OR (record->'settlement' IS NOT NULL AND record->>'settledAt' IS NULL)`,
      ]);
    })().catch(() => { this.initialization = undefined; throw new ApiError(503, 'operation_store_unavailable'); });
    await this.initialization;
  }
  async create(scope: OperationScope, input: OperationStartRequest, payloadHash: string, now: number) {
    try {
      await this.initialize(); const sql = this.query();
      const value = initialOperation(input, payloadHash, now);
      const rows = await sql`INSERT INTO public.merhav_demo_operations (workspace_id, principal_id, request_id, payload_hash, version, record)
        VALUES (${scope.workspaceId}, ${scope.principalId}, ${input.requestId}, ${payloadHash}, 1, ${JSON.stringify(value)}::jsonb)
        ON CONFLICT (workspace_id, principal_id, request_id) DO NOTHING RETURNING version, record`;
      const existing = rows.length ? record(rows[0]) : await this.get(scope, input.requestId);
      if (!existing) throw new ApiError(503, 'operation_store_unavailable');
      if (existing.payloadHash !== payloadHash) throw new ApiError(409, 'request_id_conflict');
      return existing;
    } catch (error) { throw error instanceof ApiError ? error : new ApiError(503, 'operation_store_unavailable'); }
  }
  async get(scope: OperationScope, requestId: string) {
    try {
      await this.initialize(); const sql = this.query();
      const rows = await sql`SELECT version, record FROM public.merhav_demo_operations
        WHERE workspace_id = ${scope.workspaceId} AND principal_id = ${scope.principalId} AND request_id = ${requestId}`;
      return rows.length ? record(rows[0]) : null;
    } catch (error) { throw error instanceof ApiError ? error : new ApiError(503, 'operation_store_unavailable'); }
  }
  async list(scope: OperationScope, limit: number) {
    try {
      await this.initialize(); const sql = this.query();
      const rows = await sql`SELECT version, record FROM public.merhav_demo_operations
        WHERE workspace_id = ${scope.workspaceId} AND principal_id = ${scope.principalId}
          AND ((record->>'acknowledgedAt' IS NULL AND record->>'dismissedAt' IS NULL)
            OR (record->'settlement' IS NOT NULL AND record->>'settledAt' IS NULL))
        ORDER BY record->>'createdAt' ASC, request_id ASC LIMIT ${Math.max(1, Math.min(limit, 50))}`;
      return rows.map(record);
    } catch (error) { throw error instanceof ApiError ? error : new ApiError(503, 'operation_store_unavailable'); }
  }
  async replace(scope: OperationScope, previous: StoredOperation, next: StoredOperation) {
    if (next.id !== previous.id || next.payloadHash !== previous.payloadHash || next.version !== previous.version + 1)
      throw new ApiError(500, 'invalid_operation_transition');
    const immutable = (value: StoredOperation) => canonicalOperationValue({ id: value.id, task: value.task, model: value.model,
      context: value.context, workspaceRevision: value.workspaceRevision, payloadHash: value.payloadHash,
      patientId: value.patientId, branchId: value.branchId, sessionId: value.sessionId, baseRevision: value.baseRevision, createdAt: value.createdAt });
    if (immutable(previous) !== immutable(next)) throw new ApiError(500, 'invalid_operation_transition');
    try {
      await this.initialize(); const sql = this.query();
      const rows = await sql`UPDATE public.merhav_demo_operations SET version = ${next.version}, record = ${JSON.stringify(next)}::jsonb
        WHERE workspace_id = ${scope.workspaceId} AND principal_id = ${scope.principalId} AND request_id = ${previous.id}
          AND payload_hash = ${previous.payloadHash} AND version = ${previous.version}
        RETURNING version, record`;
      return rows.length ? record(rows[0]) : null;
    } catch (error) { throw error instanceof ApiError ? error : new ApiError(503, 'operation_store_unavailable'); }
  }
}
let configured: { connection: string; store: OperationStore } | undefined;
export function operationStore(env: Environment): OperationStore {
  const connection = env.DEMO_DATABASE_URL || env.DATABASE_URL || '';
  if (!configured || configured.connection !== connection) configured = { connection, store: new NeonOperationStore(env) };
  return configured.store;
}

import { z } from 'zod';
import type { PortalState } from '../../packages/contracts';
import { exportState, importState } from '../../packages/domain';
import { decodeWorkspacePayload, encodeWorkspacePayload, WORKSPACE_GZIP_TYPE, WorkspaceTransportError } from '../../packages/transport/workspace';

export interface WorkspaceRecord { revision: number; updatedAt: string | null; state: PortalState | null }
export type WorkspaceSyncStatus = 'pending' | 'saved' | 'error' | 'conflict' | 'auth';
export interface WorkspaceSyncEvent {
  status: WorkspaceSyncStatus;
  revision: number;
  updatedAt: string | null;
  error?: string;
}
export interface WorkspaceSyncOptions {
  apiURL: string;
  token: string;
  revision: number;
  confirmedState: PortalState | null;
  updatedAt: string | null;
  onStatus: (event: WorkspaceSyncEvent) => void;
  timeoutMs?: number;
}

export class WorkspaceRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 0) { super(code); this.name = 'WorkspaceRequestError'; }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestampSchema = z.string().datetime({ offset: true });
const readSchema = z.object({ revision: revisionSchema, updatedAt: timestampSchema.nullable(), state: z.unknown() }).strict();
const saveSchema = z.object({ revision: revisionSchema, updatedAt: timestampSchema }).strict();

function httpError(status: number) {
  if (status === 401) return new WorkspaceRequestError('workspace_auth_required', status);
  if (status === 409) return new WorkspaceRequestError('workspace_conflict', status);
  if (status === 413) return new WorkspaceRequestError('workspace_too_large', status);
  if (status === 429) return new WorkspaceRequestError('workspace_rate_limited', status);
  return new WorkspaceRequestError('workspace_request_failed', status);
}

/** Bounds the whole operation, including JSON parsing, even if fetch ignores cancellation. */
async function workspaceRequest(apiURL: string, token: string, method: 'GET' | 'PUT', body?: string, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort!: (error: WorkspaceRequestError) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = (code: string) => { rejectAbort(new WorkspaceRequestError(code)); controller.abort(); };
  const onAbort = () => abort('workspace_cancelled');
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  else timer = setTimeout(() => abort('workspace_timeout'), timeoutMs);
  try {
    const request = (async () => {
      if (signal?.aborted) throw new WorkspaceRequestError('workspace_cancelled');
      const payload = body === undefined ? undefined : await encodeWorkspacePayload(body);
      if (controller.signal.aborted) throw new WorkspaceRequestError('workspace_cancelled');
      const response = await fetch(`${apiURL.replace(/\/$/, '')}/api/workspace`, {
        method, headers: { Authorization: `Bearer ${token}`, Accept: WORKSPACE_GZIP_TYPE, ...(payload ? { 'Content-Type': payload.contentType } : {}) },
        ...(payload ? { body: payload.body } : {}), signal: controller.signal, cache: 'no-store',
      });
      if (!response.ok) throw httpError(response.status);
      try { return await decodeWorkspacePayload(response.body, response.headers.get('content-type') ?? '', response.headers.get('content-length')); }
      catch (error) {
        if (error instanceof WorkspaceTransportError && ['too_large', 'compression_unavailable'].includes(error.code)) throw error;
        throw new WorkspaceRequestError('invalid_workspace_response');
      }
    })();
    return await Promise.race([request, aborted]);
  } catch (error) {
    if (error instanceof WorkspaceRequestError) throw error;
    if (error instanceof WorkspaceTransportError) throw new WorkspaceRequestError(error.code === 'too_large' ? 'workspace_too_large' : 'workspace_transport_unavailable');
    throw new WorkspaceRequestError('workspace_network_error');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function readWorkspace(apiURL: string, token: string, signal?: AbortSignal): Promise<WorkspaceRecord> {
  const parsed = readSchema.safeParse(await workspaceRequest(apiURL, token, 'GET', undefined, signal));
  if (!parsed.success) throw new WorkspaceRequestError('invalid_workspace_response');
  const { revision, updatedAt, state } = parsed.data;
  if (revision === 0) {
    if (updatedAt !== null || state !== null) throw new WorkspaceRequestError('invalid_workspace_response');
    return { revision, updatedAt, state };
  }
  if (updatedAt === null || state === null || state === undefined) throw new WorkspaceRequestError('invalid_workspace_response');
  try { return { revision, updatedAt, state: importState(JSON.stringify(state)) }; }
  catch { throw new WorkspaceRequestError('invalid_workspace_state'); }
}

/** One writer per explicit connection. Conflicts and expired authentication require reconnecting. */
export class WorkspaceSync {
  private currentRevision: number;
  private confirmedSnapshot: string | null;
  private confirmedAt: string | null;
  private pendingSnapshot: string | null = null;
  private running = false;
  private stopped = false;
  private paused: 'error' | 'conflict' | 'auth' | null = null;
  private uncertainWrite = false;
  private active: AbortController | null = null;
  private readonly timeoutMs: number;
  private barriers: { snapshot: string; resolve: (revision: number) => void; reject: (error: WorkspaceRequestError) => void }[] = [];

  constructor(private readonly options: WorkspaceSyncOptions) {
    if (!revisionSchema.safeParse(options.revision).success) throw new WorkspaceRequestError('invalid_workspace_revision');
    if (options.updatedAt !== null && !timestampSchema.safeParse(options.updatedAt).success) throw new WorkspaceRequestError('invalid_workspace_timestamp');
    if ((options.revision === 0) !== (options.confirmedState === null && options.updatedAt === null)
      || (options.revision > 0 && (options.confirmedState === null || options.updatedAt === null))) throw new WorkspaceRequestError('invalid_workspace_initial_state');
    this.currentRevision = options.revision;
    this.confirmedSnapshot = options.confirmedState === null ? null : exportState(options.confirmedState);
    this.confirmedAt = options.updatedAt;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 120_000) throw new WorkspaceRequestError('invalid_workspace_timeout');
  }

  get revision() { return this.currentRevision; }
  get updatedAt() { return this.confirmedAt; }
  getConfirmedState(): PortalState | null { return this.confirmedSnapshot === null ? null : JSON.parse(this.confirmedSnapshot) as PortalState; }

  /** Inference must not start until its exact source snapshot has been acknowledged. */
  flush(state: PortalState): Promise<number> {
    if (this.stopped || this.paused) return Promise.reject(new WorkspaceRequestError(this.stopped ? 'workspace_cancelled' : `workspace_${this.paused}`));
    const snapshot = exportState(state);
    if (!this.running && !this.uncertainWrite && snapshot === this.confirmedSnapshot) return Promise.resolve(this.currentRevision);
    const promise = new Promise<number>((resolve, reject) => { this.barriers.push({ snapshot, resolve, reject }); });
    this.requestSave(state);
    return promise;
  }

  private settleBarriers(error?: string) {
    this.barriers = this.barriers.filter(barrier => {
      if (error) { barrier.reject(new WorkspaceRequestError(error)); return false; }
      if (!this.uncertainWrite && barrier.snapshot === this.confirmedSnapshot) { barrier.resolve(this.currentRevision); return false; }
      if (!this.running && this.pendingSnapshot === null) { barrier.reject(new WorkspaceRequestError('workspace_snapshot_superseded')); return false; }
      return true;
    });
  }

  requestSave(state: PortalState): void {
    if (this.stopped) return;
    this.pendingSnapshot = exportState(state);
    if (this.paused) return;
    if (!this.running && !this.uncertainWrite && this.pendingSnapshot === this.confirmedSnapshot) {
      this.pendingSnapshot = null;
      this.emit('saved');
      return;
    }
    this.emit('pending');
    this.start();
  }

  retry(): boolean {
    if (this.stopped || this.paused !== 'error' || this.pendingSnapshot === null) return false;
    this.paused = null;
    this.emit('pending');
    this.start();
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.pendingSnapshot = null;
    this.active?.abort();
    this.settleBarriers('workspace_cancelled');
  }

  private emit(status: WorkspaceSyncStatus, error?: string) {
    if (this.stopped) return;
    this.options.onStatus({ status, revision: this.currentRevision, updatedAt: this.confirmedAt, ...(error ? { error } : {}) });
  }

  private start() {
    if (this.running || this.stopped || this.paused || this.pendingSnapshot === null) return;
    this.running = true;
    void this.drain();
  }

  private async drain() {
    try {
      while (!this.stopped && !this.paused && this.pendingSnapshot !== null) {
        const snapshot = this.pendingSnapshot;
        this.pendingSnapshot = null;
        if (!this.uncertainWrite && snapshot === this.confirmedSnapshot) { this.emit('saved'); continue; }
        const expectedRevision = this.currentRevision;
        this.active = new AbortController();
        try {
          const response = await workspaceRequest(this.options.apiURL, this.options.token, 'PUT',
            JSON.stringify({ expectedRevision, state: JSON.parse(snapshot) }), this.active.signal, this.timeoutMs);
          if (this.stopped) return;
          const parsed = saveSchema.safeParse(response);
          if (!parsed.success || parsed.data.revision !== expectedRevision + 1) throw new WorkspaceRequestError('invalid_workspace_response');
          this.currentRevision = parsed.data.revision;
          this.confirmedAt = parsed.data.updatedAt;
          this.confirmedSnapshot = snapshot;
          this.uncertainWrite = false;
          this.settleBarriers();
          if (this.pendingSnapshot === snapshot) this.pendingSnapshot = null;
          // Expose every acknowledged baseline, including while a newer write is queued.
          // Reconnecting must compare with our latest successful write, not the old load.
          this.emit(this.pendingSnapshot === null ? 'saved' : 'pending');
        } catch (error) {
          if (this.stopped) return;
          // A lost response may have followed a successful write. Retrying retains the
          // expected revision, so the server can reject it rather than overwrite changes.
          this.uncertainWrite = true;
          this.pendingSnapshot ??= snapshot;
          const failure = error instanceof WorkspaceRequestError ? error : new WorkspaceRequestError('workspace_network_error');
          this.paused = failure.status === 409 ? 'conflict' : failure.status === 401 ? 'auth' : 'error';
          this.settleBarriers(failure.code);
          this.emit(this.paused, failure.code);
        } finally { this.active = null; }
      }
    } finally {
      this.running = false;
      this.settleBarriers();
      this.start();
    }
  }
}

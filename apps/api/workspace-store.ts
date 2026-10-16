import { neon } from '@neondatabase/serverless';
import type { PortalState } from '../../packages/contracts/index.js';
import { ApiError, type Environment } from './errors.js';

export interface WorkspaceVersion { revision: number; updatedAt: string }
export interface WorkspaceSnapshot { revision: number; updatedAt: string | null; state: PortalState | null }
export interface WorkspaceStore {
  load(workspaceId: string): Promise<WorkspaceSnapshot>;
  save(workspaceId: string, expectedRevision: number, state: PortalState): Promise<WorkspaceVersion | null>;
}

function version(row: Record<string, unknown>): WorkspaceVersion {
  const timestamp = row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at));
  if (!Number.isInteger(row.revision) || Number(row.revision) < 1 || Number.isNaN(timestamp.getTime())) throw new ApiError(503, 'workspace_store_unavailable');
  return { revision: Number(row.revision), updatedAt: timestamp.toISOString() };
}

export class NeonWorkspaceStore implements WorkspaceStore {
  private initialization?: Promise<void>;
  private readonly connectionString: string;

  constructor(env: Environment) {
    const connectionString = (env.DEMO_DATABASE_URL || env.DATABASE_URL || '').trim();
    if (!connectionString) throw new ApiError(503, 'workspace_not_configured');
    try {
      const url = new URL(connectionString);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname === '/') throw new Error('configuration');
    } catch { throw new ApiError(503, 'workspace_not_configured'); }
    this.connectionString = connectionString;
  }

  private query() {
    return neon(this.connectionString, { fetchOptions: { signal: AbortSignal.timeout(15_000) } });
  }

  private async initialize() {
    if (!this.initialization) {
      this.initialization = (async () => {
        const sql = this.query();
        // Serialize first-time DDL across concurrent cold starts in this database.
        await sql.transaction([
          sql`SELECT pg_advisory_xact_lock(716724, 1)`,
          sql`CREATE TABLE IF NOT EXISTS public.merhav_demo_workspaces (
            workspace_id text PRIMARY KEY,
            revision integer NOT NULL CHECK (revision > 0),
            updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object')
          )`,
        ]);
      })().catch(() => { this.initialization = undefined; throw new ApiError(503, 'workspace_store_unavailable'); });
    }
    await this.initialization;
  }

  async load(workspaceId: string): Promise<WorkspaceSnapshot> {
    try {
      await this.initialize();
      const sql = this.query();
      const rows = await sql`SELECT revision, updated_at, state FROM public.merhav_demo_workspaces WHERE workspace_id = ${workspaceId}`;
      if (!rows.length) return { revision: 0, updatedAt: null, state: null };
      return { ...version(rows[0]), state: rows[0].state as PortalState };
    } catch (error) {
      throw error instanceof ApiError ? error : new ApiError(503, 'workspace_store_unavailable');
    }
  }

  async save(workspaceId: string, expectedRevision: number, state: PortalState): Promise<WorkspaceVersion | null> {
    try {
      await this.initialize();
      const sql = this.query(); const serialized = JSON.stringify(state);
      // Each branch is one atomic statement. A missing row can only start at revision 0.
      const rows = expectedRevision === 0
        ? await sql`INSERT INTO public.merhav_demo_workspaces (workspace_id, revision, updated_at, state)
          VALUES (${workspaceId}, 1, clock_timestamp(), ${serialized}::jsonb)
          ON CONFLICT (workspace_id) DO NOTHING
          RETURNING revision, updated_at`
        : await sql`UPDATE public.merhav_demo_workspaces
          SET revision = revision + 1, updated_at = clock_timestamp(), state = ${serialized}::jsonb
          WHERE workspace_id = ${workspaceId} AND revision = ${expectedRevision}
          RETURNING revision, updated_at`;
      return rows.length ? version(rows[0]) : null;
    } catch (error) {
      throw error instanceof ApiError ? error : new ApiError(503, 'workspace_store_unavailable');
    }
  }
}

let configuredStore: { connectionString: string; store: NeonWorkspaceStore } | undefined;
export function workspaceStore(env: Environment): WorkspaceStore {
  const connectionString = env.DEMO_DATABASE_URL || env.DATABASE_URL || '';
  if (!configuredStore || configuredStore.connectionString !== connectionString) configuredStore = { connectionString, store: new NeonWorkspaceStore(env) };
  return configuredStore.store;
}

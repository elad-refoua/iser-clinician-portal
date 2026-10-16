import { z } from 'zod';
import { importState } from '../../packages/domain/index.js';
import { authenticate } from './auth.js';
import { ApiError, type Environment } from './errors.js';
import { workspaceStore, type WorkspaceStore, type WorkspaceSnapshot } from './workspace-store.js';
import { decodeWorkspacePayload, encodeWorkspacePayload, WORKSPACE_DECODED_MAX_BYTES, WORKSPACE_GZIP_TYPE, WORKSPACE_WIRE_MAX_BYTES, WorkspaceTransportError } from '../../packages/transport/workspace.js';

export const WORKSPACE_MAX_BYTES = WORKSPACE_WIRE_MAX_BYTES;
export interface WorkspaceDependencies { env?: Environment; store?: WorkspaceStore; now?: () => number }
const revisionSchema = z.number().int().min(0).max(2_147_483_646);
const saveSchema = z.object({ expectedRevision: revisionSchema, state: z.unknown() }).strict();
const snapshotSchema = z.object({ revision: z.number().int().min(0).max(2_147_483_647), updatedAt: z.string().datetime({ offset: true }).nullable(), state: z.unknown() }).strict();

async function readBody(request: Request): Promise<unknown> {
  try {
    return await decodeWorkspacePayload(request.body, request.headers.get('content-type') ?? '', request.headers.get('content-length'));
  } catch (error) {
    if (error instanceof WorkspaceTransportError && error.code === 'too_large') throw new ApiError(413, 'request_too_large');
    if (error instanceof WorkspaceTransportError && error.code === 'unsupported_type') throw new ApiError(415, 'json_required');
    throw new ApiError(400, 'invalid_json');
  }
}

function cors(request: Request, env: Environment): Headers {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  const origin = request.headers.get('origin');
  const allowed = new Set((env.ALLOWED_ORIGINS ?? '').split(',').map(item => item.trim()).filter(Boolean));
  allowed.add(new URL(request.url).origin);
  if (origin) {
    if (!allowed.has(origin)) throw new ApiError(403, 'origin_not_allowed');
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '600');
  }
  return headers;
}

function checkedSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new ApiError(503, 'workspace_store_unavailable');
  const { revision, updatedAt, state } = parsed.data;
  if (revision === 0 && updatedAt === null && state === null) return { revision, updatedAt, state };
  if (revision === 0 || updatedAt === null || state === null) throw new ApiError(503, 'workspace_store_unavailable');
  try { return { revision, updatedAt, state: importState(JSON.stringify(state)) }; }
  catch { throw new ApiError(503, 'workspace_store_unavailable'); }
}

export async function handleWorkspace(request: Request, dependencies: WorkspaceDependencies = {}): Promise<Response> {
  const env = dependencies.env ?? process.env; const now = dependencies.now ?? Date.now;
  let headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  try {
    headers = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'PUT'].includes(request.method)) throw new ApiError(405, 'method_not_allowed');
    authenticate(request, env, now());
    const workspaceId = env.DEMO_WORKSPACE_ID || 'owner-demo';
    if (!workspaceId.trim() || workspaceId.length > 160) throw new ApiError(503, 'workspace_not_configured');
    if (request.method === 'GET') {
      const store = dependencies.store ?? workspaceStore(env);
      const snapshot = checkedSnapshot(await store.load(workspaceId));
      const compressed = (request.headers.get('accept') ?? '').split(',').some(type => type.split(';')[0].trim() === WORKSPACE_GZIP_TYPE);
      const payload = await encodeWorkspacePayload(JSON.stringify(snapshot), compressed);
      headers.set('Content-Type', payload.contentType);
      return new Response(payload.body, { headers });
    }
    const input = saveSchema.safeParse(await readBody(request));
    if (!input.success) throw new ApiError(400, 'workspace_invalid_request');
    let state;
    try { state = importState(JSON.stringify(input.data.state)); }
    catch { throw new ApiError(400, 'workspace_invalid_state'); }
    // Reject a write that this protocol could not subsequently read back. The small
    // margin covers the store timestamp and envelope metadata without dropping history.
    const readable = await encodeWorkspacePayload(JSON.stringify({ revision: input.data.expectedRevision + 1, updatedAt: new Date(now()).toISOString(), state }));
    if (readable.body.byteLength > WORKSPACE_MAX_BYTES - 1024 || readable.decodedBytes > WORKSPACE_DECODED_MAX_BYTES - 1024) throw new ApiError(413, 'request_too_large');
    const store = dependencies.store ?? workspaceStore(env);
    const version = await store.save(workspaceId, input.data.expectedRevision, state);
    if (!version) throw new ApiError(409, 'workspace_conflict');
    return Response.json({ revision: version.revision, updatedAt: version.updatedAt }, { headers });
  } catch (error) {
    if (error instanceof WorkspaceTransportError) return Response.json({ error: error.code === 'too_large' ? 'request_too_large' : 'workspace_request_failed' }, { status: error.code === 'too_large' ? 413 : 500, headers });
    return Response.json({ error: error instanceof ApiError ? error.code : 'workspace_request_failed' }, { status: error instanceof ApiError ? error.status : 500, headers });
  }
}

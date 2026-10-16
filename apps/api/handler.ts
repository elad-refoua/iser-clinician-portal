import { z } from 'zod';
import { PROMPT_VERSION, buildSystemPrompt } from '../../packages/prompts/index.js';
import { DEFAULT_MODEL, type ModelResponse, type DraftResult, type TurnResult } from '../../packages/contracts/index.js';
import { authConfigured, authenticate, digest, issueToken, verifyCode } from './auth.js';
import { ApiError, type Environment } from './errors.js';
import { RedisQuotaStore, redisConfigured, type QuotaStore, type Reservation } from './quota.js';
import { callProvider, getModels, prepareProviderRequest, ProviderError } from './provider.js';
import { normalizeWireResult, responseSchema, shouldFinish, validateRequest, validateResult } from './validation.js';

export type Route = 'access' | 'models' | 'turn' | 'draft';
export interface Dependencies { env?: Environment; fetcher?: typeof fetch; quota?: QuotaStore; now?: () => number }
const accessSchema = z.object({ code: z.string().min(8).max(256) }).strict();

async function readBody(request: Request) {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new ApiError(415, 'json_required');
  if (Number(request.headers.get('content-length') ?? 0) > 100_000) throw new ApiError(413, 'request_too_large');
  if (!request.body) throw new ApiError(400, 'invalid_json');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 100_000) throw new ApiError(413, 'request_too_large'); chunks.push(value); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'invalid_json'); }
  } finally { await reader.cancel().catch(() => undefined); }
}
function cors(request: Request, env: Environment) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  const origin = request.headers.get('origin');
  const allowed = new Set((env.ALLOWED_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean));
  allowed.add(new URL(request.url).origin);
  if (origin) {
    if (!allowed.has(origin)) throw new ApiError(403, 'origin_not_allowed');
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '600');
  }
  return headers;
}
export async function handle(request: Request, route: Route, dependencies: Dependencies = {}): Promise<Response> {
  const env = dependencies.env ?? process.env; const now = dependencies.now ?? Date.now; const fetcher = dependencies.fetcher ?? fetch;
  let headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  try {
    headers = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== (route === 'models' ? 'GET' : 'POST')) throw new ApiError(405, 'method_not_allowed');
    if (route === 'models') {
      const models = await getModels(fetcher, now());
      let quotaAvailable = false;
      if (dependencies.quota || redisConfigured(env)) {
        try { await (dependencies.quota ?? new RedisQuotaStore(env, fetcher)).ping(); quotaAvailable = true; } catch { /* readiness is explicit */ }
      }
      return Response.json({ models: models.map(({ catalog: _catalog, ...model }) => model), defaultModel: DEFAULT_MODEL, promptVersion: PROMPT_VERSION, liveReady: !!env.OPENROUTER_API_KEY && authConfigured(env) && quotaAvailable && models.some(m => m.available), readiness: { providerKey: !!env.OPENROUTER_API_KEY, access: authConfigured(env), quota: quotaAvailable } }, { headers });
    }
    const quota = dependencies.quota ?? new RedisQuotaStore(env, fetcher);
    if (route === 'access') {
      // Vercel supplies the trusted client IP in this header; never store/log the address.
      const ip = request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'local';
      await quota.accessAttempt(digest(`${env.SESSION_SECRET ?? ''}:${ip}`), now());
      const input = accessSchema.safeParse(await readBody(request));
      if (!input.success || !verifyCode(input.data.code, env)) throw new ApiError(401, 'invalid_access_code');
      return Response.json(issueToken(env, now()), { headers });
    }
    const claims = authenticate(request, env, now());
    if (!env.OPENROUTER_API_KEY) throw new ApiError(503, 'provider_not_configured');
    const input = validateRequest(await readBody(request), route);
    const models = await getModels(fetcher, now());
    const approved = models.find(m => m.id === input.model);
    if (!approved?.available || !approved.catalog) throw new ApiError(503, 'model_unavailable');
    const c = { ...input.context };
    const schema = responseSchema(route);
    // Budget before reserving; the small counters in the final prompt cannot materially grow it.
    const initialPrompt = buildSystemPrompt({ ...c, questionCount: 3, intakeCount: 2 }, route);
    const prepared = prepareProviderRequest(approved.catalog, route, initialPrompt, c, schema);
    const reservation = await quota.reserve({ codeId: claims.sub, sessionKey: `${c.patientId}:${c.branchId}:${c.sessionId}`, requestId: input.requestId, payloadHash: digest(JSON.stringify({ route, input })), micros: prepared.micros, now: now(), revision: c.baseRevision, questionCount: c.questionCount, intakeCount: c.intakeCount, intakeRound: c.intakeRound ?? 0 });
    c.questionCount = reservation.questionCount; c.intakeCount = reservation.intakeCount;
    const prompt = buildSystemPrompt(c, route); const started = now();
    let actualCost: number | undefined;
    let providerSent = false;
    try {
      let response: ModelResponse<TurnResult | DraftResult>;
      if (route === 'turn' && (shouldFinish(c) || (c.stage === 'main' ? c.questionCount >= 3 : c.intakeCount >= 2))) {
        actualCost = 0;
        response = { result: { action: 'draft', utterance: 'נעבור לטיוטה עם מה שכבר נמסר.', topic: '', rationale: 'התשאול הסתיים לפי בקשת המטפל או מכסת השאלות.', fieldUpdates: [], preferenceUpdates: [] }, prompt, promptVersion: PROMPT_VERSION, model: 'server-policy', elapsedMs: 0, usage: { input: 0, output: 0, cost: 0 } };
      } else {
        const finalRequest = prepareProviderRequest(approved.catalog, route, prompt, c, schema);
        if (finalRequest.micros > prepared.micros) throw new ApiError(400, 'reservation_insufficient');
        providerSent = true;
        const reply = await callProvider(env.OPENROUTER_API_KEY, finalRequest.body, approved.catalog, fetcher);
        actualCost = reply.costMicros;
        const result = validateResult(normalizeWireResult(reply.raw), route, c);
        response = { result, model: reply.model, prompt, promptVersion: PROMPT_VERSION, elapsedMs: Math.max(0, now() - started), usage: reply.usage };
      }
      const asked = 'action' in response.result && response.result.action === 'question' ? c.stage === 'intake' ? 'intake' : 'main' : null;
      await quota.finalize(reservation, { costMicros: actualCost, status: 'done', asked, revision: c.baseRevision });
      return Response.json(response, { headers });
    } catch (error) {
      if (error instanceof ProviderError && error.costMicros !== undefined) actualCost = error.costMicros;
      await finalizeFailure(quota, reservation, providerSent, actualCost, c.baseRevision);
      throw error;
    }
  } catch (error) {
    return Response.json({ error: error instanceof ApiError ? error.code : 'request_failed' }, { status: error instanceof ApiError ? error.status : 500, headers });
  }
}
async function finalizeFailure(quota: QuotaStore, reservation: Reservation, sent: boolean, cost: number | undefined, revision: number) {
  try { await quota.finalize(reservation, { costMicros: sent ? cost : 0, status: sent && cost === undefined ? 'uncertain' : 'failed', asked: null, revision }); }
  catch { /* Durable pending reservation is deliberately retained. */ }
}

import { describe, expect, it, vi } from 'vitest';
import type { ContextPacket, DraftResult, TurnResult } from '../packages/contracts/index.js';
import { handle } from '../apps/api/handler.js';
import { authenticate, digest, issueToken } from '../apps/api/auth.js';
import { ApiError } from '../apps/api/errors.js';
import { getModels, prepareProviderRequest, type CatalogModel } from '../apps/api/provider.js';
import { LIMITS, RedisQuotaStore, redisConfigured, type QuotaStore, type Reservation, type ReservationInput } from '../apps/api/quota.js';
import { responseSchema, shouldFinish, validateRequest, validateResult } from '../apps/api/validation.js';

const now = Date.parse('2026-10-16T12:00:00Z');
it('distinguishes finishing a round from fresh optional intake and quoted narrative', () => {
  const c = context(); c.messages[0].text = 'סיימתי';
  expect(shouldFinish(c)).toBe(true);
  c.stage = 'intake'; c.intakeCount = 0; c.intakeRound = 1;
  expect(shouldFinish(c)).toBe(false);
  c.stage = 'main'; c.messages[0].text = 'We discussed waiting at the bus stop.';
  expect(shouldFinish(c)).toBe(false);
});
it('sends a portable structural schema while retaining strict post-generation limits', () => {
  const schema = JSON.stringify(responseSchema('turn'));
  expect(schema).not.toMatch(/maxLength|minLength|pattern|\$schema/);
  expect(schema).toContain('additionalProperties');
  expect(schema).toContain('required');
  expect(() => validateResult({ ...turn(), utterance: 'א'.repeat(1501) + '?' }, 'turn', context())).toThrow('invalid_model_output');
});
const env = { DEMO_ACCESS_CODE_HASH: digest('fictional-test-access'), SESSION_SECRET: 'unit-test-secret-with-more-than-32-characters', OPENROUTER_API_KEY: 'not-a-real-provider-key', ALLOWED_ORIGINS: 'https://example.github.io' };
const catalog: CatalogModel = { id: 'anthropic/claude-sonnet-5.5', canonical_slug: 'anthropic/claude-sonnet-5.5-test', context_length: 1_000_000, pricing: { prompt: 0.000002, completion: 0.00001 }, supported_parameters: ['response_format', 'structured_outputs', 'max_tokens', 'reasoning'], reasoning: { mandatory: true, supported_efforts: ['low'] } };
const context = (): ContextPacket => ({ patientId: 'fictional-patient', patientName: 'דמות בדיונית', branchId: 'main', sessionId: 'session-1', sessionNumber: 1, baseRevision: 2, asOf: '2026-10-16T11:05:01Z', stage: 'main', questionCount: 0, intakeCount: 0, branchScope: [{ branchId: 'main', throughSession: 1 }], preferences: [], skippedTopics: [], sources: [{ id: 's1', patientId: 'fictional-patient', branchId: 'main', sessionId: 'session-1', sessionNumber: 1, text: 'דוגמה מומצאת לבדיקת תיעוד בלבד.', recordedAt: '2026-10-16T11:05:00Z', kind: 'clinician' }], documents: [], messages: [{ id: 'm1', role: 'user', sourceId: 's1', text: 'דוגמה מומצאת לבדיקת תיעוד בלבד.', at: '2026-10-16T11:05:00Z' }] });
const turn = (): TurnResult => ({ action: 'question', utterance: 'מה חשוב לך לשמור מההמשך?', topic: 'המשך הפגישה', rationale: 'בירור קצר.', fieldUpdates: [], preferenceUpdates: [] });
const requestBody = (c = context(), requestId = 'request-1') => ({ requestId, model: catalog.id, context: c });
function request(route: string, body?: unknown, token = issueToken(env, now).token, origin = 'https://example.github.io') {
  return new Request(`https://demo.vercel.app/api/${route}`, { method: route === 'models' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

// Injection is deliberately test-only. Production has no memory quota implementation or fallback.
class TestQuota implements QuotaStore {
  records = new Map<string, { hash: string; status: string; amount: number }>();
  total = 0; daily = 0; calls = 0; active = new Set<string>(); questions = 0; intakes = 0; committed = -1; attempts = 0;
  async ping() {}
  async accessAttempt() { if (++this.attempts > 10) throw new ApiError(429, 'access_rate_limit'); }
  async reserve(i: ReservationInput) {
    const old = this.records.get(i.requestId);
    if (old) throw new ApiError(409, old.hash === i.payloadHash ? `request_${old.status}` : 'request_id_conflict');
    if (this.active.has(i.sessionKey) || this.active.size >= LIMITS.globalConcurrency) throw new ApiError(429, 'concurrency_limit');
    if (i.revision <= this.committed) throw new ApiError(409, 'stale_revision');
    if (this.calls >= LIMITS.dailyCalls) throw new ApiError(429, 'daily_call_limit');
    if (this.total + i.micros > LIMITS.totalMicros) throw new ApiError(429, 'total_budget_exceeded');
    if (this.daily + i.micros > LIMITS.dailyMicros) throw new ApiError(429, 'daily_budget_exceeded');
    this.total += i.micros; this.daily += i.micros; this.calls++; this.active.add(i.sessionKey);
    this.records.set(i.requestId, { hash: i.payloadHash, status: 'pending', amount: i.micros });
    return { requestKey: i.requestId, day: '2026-10-16', sessionKey: i.sessionKey, questionCount: Math.max(i.questionCount, this.questions), intakeCount: Math.max(i.intakeCount, this.intakes), intakeRound: i.intakeRound };
  }
  async finalize(r: Reservation, result: { costMicros?: number; status: 'done' | 'failed' | 'uncertain'; asked: 'main' | 'intake' | null; revision: number }) {
    const record = this.records.get(r.requestKey)!;
    if (record.status !== 'pending') return;
    const cost = result.costMicros ?? record.amount;
    this.total += cost - record.amount; this.daily += cost - record.amount; record.status = result.status;
    this.active.delete(r.sessionKey);
    if (result.asked === 'main') this.questions++;
    if (result.asked === 'intake') this.intakes++;
    if (result.status === 'done') this.committed = result.revision;
  }
}
function provider(result: unknown = turn(), options: { cost?: boolean; error?: boolean; finish?: string; model?: string } = {}) {
  let completions = 0; const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [catalog] });
    completions++;
    bodies.push(JSON.parse(String(init?.body)));
    if (options.error) throw new Error('PRIVATE_UPSTREAM_DETAIL must not leak');
    return Response.json({ id: 'test-generation', model: options.model ?? catalog.id, choices: [{ finish_reason: options.finish ?? 'stop', message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 500, completion_tokens: 100, ...(options.cost === false ? {} : { cost: 0.002 }) } });
  }) as unknown as typeof fetch;
  return { fetcher, bodies, count: () => completions };
}
async function json(response: Response) { return await response.json() as Record<string, any>; }

describe('API boundaries', () => {
  it('issues a short-lived signed token, rejects tampering and expires it', async () => {
    const quota = new TestQuota();
    const response = await handle(request('access', { username: 'elad', password: 'fictional-test-access' }), 'access', { env, quota, now: () => now });
    expect(response.status).toBe(200);
    const data = await json(response); expect(data.token).not.toContain('fictional-test-access');
    expect(authenticate(request('turn', {}, data.token), env, now).exp).toBe(now / 1000 + 3600);
    expect(() => authenticate(request('turn', {}, `${data.token}x`), env, now)).toThrow('invalid_session');
    expect(() => authenticate(request('turn', {}, data.token), env, now + 3600001)).toThrow('session_expired');
  });
  it('normalizes usernames and supports an explicitly configured login name', async () => {
    const defaultLogin = await handle(request('access', { username: '  ELAD  ', password: 'fictional-test-access' }), 'access', { env, quota: new TestQuota(), now: () => now });
    expect(defaultLogin.status).toBe(200);
    const customEnv = { ...env, DEMO_USERNAME: '  DemoOwner  ' };
    const configuredLogin = await handle(request('access', { username: ' demoOWNER ', password: 'fictional-test-access' }), 'access', { env: customEnv, quota: new TestQuota(), now: () => now });
    expect(configuredLogin.status).toBe(200);
    const oldName = await handle(request('access', { username: 'elad', password: 'fictional-test-access' }), 'access', { env: customEnv, quota: new TestQuota(), now: () => now });
    expect(oldName.status).toBe(401);
  });
  it('returns the same generic failure for wrong username, password, missing credentials and old code payload', async () => {
    const quota = new TestQuota();
    for (const body of [
      { username: 'unknown', password: 'fictional-test-access' },
      { username: 'elad', password: 'incorrect-password' },
      { username: 'elad', password: ' fictional-test-access ' },
      { username: 'elad' },
      { password: 'fictional-test-access' },
      { code: 'fictional-test-access' },
      { username: 'elad', password: 'fictional-test-access', code: 'extra' },
    ]) {
      const response = await handle(request('access', body), 'access', { env, quota, now: () => now });
      expect(response.status).toBe(401);
      expect(await json(response)).toEqual({ error: 'invalid_credentials' });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(quota.attempts).toBe(7);
  });
  it('verifies the password exactly without trimming or changing its case', async () => {
    const password = ' Fictional-PassPhrase ';
    const exactEnv = { ...env, DEMO_ACCESS_CODE_HASH: digest(password) };
    const accepted = await handle(request('access', { username: 'elad', password }), 'access', { env: exactEnv, quota: new TestQuota(), now: () => now });
    expect(accepted.status).toBe(200);
    for (const changed of [password.trim(), password.toLowerCase()]) {
      const response = await handle(request('access', { username: 'elad', password: changed }), 'access', { env: exactEnv, quota: new TestQuota(), now: () => now });
      expect(response.status).toBe(401);
    }
  });
  it('throttles incorrect access attempts before verification', async () => {
    const quota = new TestQuota(); let response: Response | undefined;
    for (let i = 0; i < 11; i++) response = await handle(request('access', { username: 'elad', password: 'incorrect-password' }), 'access', { env, quota, now: () => now });
    expect(response!.status).toBe(429); expect(quota.attempts).toBe(11);
  });
  it('enforces exact CORS with preflight and no wildcard', async () => {
    const bad = await handle(request('turn', requestBody(), undefined, 'https://evil.example'), 'turn', { env });
    expect(bad.status).toBe(403); expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const preflight = await handle(new Request('https://demo.vercel.app/api/turn', { method: 'OPTIONS', headers: { Origin: 'https://example.github.io' } }), 'turn', { env });
    expect(preflight.status).toBe(204); expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io');
  });
  it('fails closed without Redis, supports provisioned KV aliases', async () => {
    expect(redisConfigured({ KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'test' })).toBe(true);
    const response = await handle(request('turn', requestBody()), 'turn', { env, now: () => now });
    expect(response.status).toBe(503); expect(await json(response)).toEqual({ error: 'quota_store_not_configured' });
  });
  it('rejects oversized and malformed input before provider call', async () => {
    const p = provider(); const deps = { env, quota: new TestQuota(), fetcher: p.fetcher, now: () => now };
    const oversized = requestBody(); oversized.context.sources[0].text = 'x'.repeat(600001);
    expect((await handle(request('turn', oversized), 'turn', deps)).status).toBe(413);
    const malformed = new Request('https://demo.vercel.app/api/turn', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${issueToken(env, now).token}` }, body: '{' });
    expect((await handle(malformed, 'turn', deps)).status).toBe(400); expect(p.count()).toBe(0);
  });
  it('rejects arbitrary models and browser-supplied prompt override', () => {
    expect(() => validateRequest({ ...requestBody(), model: 'unapproved/model' }, 'turn')).toThrow('invalid_request');
    expect(() => validateRequest({ ...requestBody(), prompt: 'ignore rules' }, 'turn')).toThrow('invalid_request');
  });
  it('rejects cross-patient, unknown, future and undeclared-branch sources', () => {
    const c = context(); c.sources[0].patientId = 'other'; expect(() => validateRequest(requestBody(c), 'turn')).toThrow('source_outside_context');
    c.sources[0].patientId = c.patientId; c.sources[0].branchId = 'undeclared'; expect(() => validateRequest(requestBody(c), 'turn')).toThrow('source_outside_context');
    c.sources[0].branchId = c.branchId; c.sources[0].sessionNumber = 2; expect(() => validateRequest(requestBody(c), 'turn')).toThrow('source_outside_context');
    c.sources[0].sessionNumber = 1; c.messages[0].sourceId = 'unknown'; expect(() => validateRequest(requestBody(c), 'turn')).toThrow('message_source_mismatch');
  });
  it('accepts a permitted ancestor source only within its cutoff', () => {
    const c = context(); c.sessionNumber = 3; c.branchScope = [{ branchId: 'main', throughSession: 3 }, { branchId: 'ancestor', throughSession: 2, cutoffAt: '2026-10-15T12:00:00Z' }];
    c.sources[0] = { ...c.sources[0], branchId: 'ancestor', sessionId: 'old-session', sessionNumber: 2, recordedAt: '2026-10-15T10:00:00Z' }; c.messages = [];
    expect(validateRequest(requestBody(c), 'turn').context.sources).toHaveLength(1);
    c.sources[0].recordedAt = '2026-10-15T13:00:00Z'; expect(() => validateRequest(requestBody(c), 'turn')).toThrow('source_outside_context');
  });
  it('returns all five document kinds and accepts sparse valid field patches', () => {
    const result: DraftResult = { documents: ['note', 'formulation', 'intake', 'gold', 'supervision'].map(kind => ({ kind: kind as any, content: 'לא נמסר מידע נוסף.', sourceIds: [] })), fieldUpdates: [], rationale: 'חומר מוגבל.', summary: 'הטיוטה מרכזת את המידע שנמסר.', followUps: [] };
    expect(validateResult(result, 'draft', context())).toEqual(result);
    result.documents[4].kind = 'note'; expect(() => validateResult(result, 'draft', context())).toThrow('missing_document_kind');
  });
  it('rejects unknown source IDs, duplicate and unsupported intake fields in model output', () => {
    const bad = turn(); bad.fieldUpdates = [{ id: 1, value: 'תיאור', status: 'documented', sourceIds: ['missing'], remaining: '' }];
    expect(() => validateResult(bad, 'turn', context())).toThrow('unknown_model_source');
    bad.fieldUpdates[0].sourceIds = ['s1']; bad.fieldUpdates.push({ ...bad.fieldUpdates[0] }); expect(() => validateResult(bad, 'turn', context())).toThrow('duplicate_field_update');
    bad.fieldUpdates = [{ ...bad.fieldUpdates[0], id: 33 }]; expect(() => validateResult(bad, 'turn', context())).toThrow('invalid_model_output');
  });
  it('enforces question limits, skipped topics, and report exclusions', () => {
    const c = context(); c.questionCount = 3; expect(() => validateResult(turn(), 'turn', c)).toThrow('question_limit');
    c.questionCount = 0; c.skippedTopics = ['המשך הפגישה']; expect(() => validateResult(turn(), 'turn', c)).toThrow('blocked_question_topic');
    c.skippedTopics = []; c.preferences = [{ id: 'p1', action: 'exclude', scope: 'session', topic: 'סוד', goal: 'intake' }];
    const output = turn(); output.fieldUpdates = [{ id: 1, value: 'סוד', status: 'documented', sourceIds: ['s1'], remaining: '' }];
    expect(() => validateResult(output, 'turn', c)).toThrow('excluded_topic_in_output');
  });
  it('requires every provider JSON-schema property and omits unsupported temperature', () => {
    const schema = responseSchema('turn') as any;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.preferenceUpdates.items.required).toContain('goal');
    const prepared = prepareProviderRequest(catalog, 'turn', 'server instructions', {}, schema);
    expect(prepared.body.temperature).toBeUndefined();
    expect(prepared.body.provider).toMatchObject({ require_parameters: true, allow_fallbacks: false, max_price: { prompt: 2, completion: 10, request: 0 } });
    expect(prepared.body.reasoning).toEqual({ effort: 'low', exclude: true });
    expect(prepared.micros).toBeGreaterThan(50000);
    expect(() => prepareProviderRequest(catalog, 'draft', 'x'.repeat(100000), {}, schema)).toThrow('request_budget_exceeded');
  });
  it('sends once, finalizes actual usage, refuses completed and conflicting IDs', async () => {
    const quota = new TestQuota(); const p = provider(); const deps = { env, quota, fetcher: p.fetcher, now: () => now };
    const response = await handle(request('turn', requestBody()), 'turn', deps);
    expect(response.status).toBe(200); const data = await json(response); expect(data.usage.cost).toBe(0.002); expect(data.promptVersion).toBeTruthy(); expect(quota.total).toBe(2000);
    expect(await json(await handle(request('turn', requestBody()), 'turn', deps))).toEqual({ error: 'request_done' });
    const changed = requestBody(); changed.context.patientName = 'דמות אחרת';
    expect(await json(await handle(request('turn', changed), 'turn', deps))).toEqual({ error: 'request_id_conflict' });
    expect(p.count()).toBe(1); expect(p.bodies[0].messages).toHaveLength(2);
  });
  it('retains an uncertain billed reservation and never retries the provider', async () => {
    const quota = new TestQuota(); const p = provider(turn(), { error: true }); const deps = { env, quota, fetcher: p.fetcher, now: () => now };
    const response = await handle(request('turn', requestBody()), 'turn', deps);
    expect(response.status).toBe(502); expect(await json(response)).toEqual({ error: 'provider_outcome_uncertain' });
    const reserved = quota.total; expect(reserved).toBeGreaterThan(0);
    expect(await json(await handle(request('turn', requestBody()), 'turn', deps))).toEqual({ error: 'request_uncertain' });
    expect(quota.total).toBe(reserved); expect(p.count()).toBe(1);
  });
  it('charges known usage even when model output is rejected without applying it', async () => {
    const quota = new TestQuota(); const result = turn(); result.fieldUpdates = [{ id: 1, value: 'invented', status: 'documented', sourceIds: ['unknown'], remaining: '' }];
    const p = provider(result); const response = await handle(request('turn', requestBody()), 'turn', { env, quota, fetcher: p.fetcher, now: () => now });
    expect(response.status).toBe(502); expect(await json(response)).toEqual({ error: 'unknown_model_source' }); expect(quota.total).toBe(2000);
  });
  it('fails closed for a provider model mismatch and incomplete output', async () => {
    for (const options of [{ model: 'different/model' }, { finish: 'length' }]) {
      const p = provider(turn(), options); const response = await handle(request('turn', requestBody()), 'turn', { env, quota: new TestQuota(), fetcher: p.fetcher, now: () => now });
      expect(response.status).toBe(502); expect(p.count()).toBe(1);
    }
  });
  it('honors durable counters even when a client sends zero', async () => {
    const quota = new TestQuota(); quota.questions = 3; const p = provider();
    const response = await handle(request('turn', requestBody()), 'turn', { env, quota, fetcher: p.fetcher, now: () => now });
    const data = await json(response);
    expect(data.result.action).toBe('draft'); expect(p.count()).toBe(0); expect(quota.total).toBe(0);
    expect(data.effectiveContext).toEqual({ ...context(), questionCount: 3 });
  });
  it('returns the exact context sent to the provider after durable counters replace the client counters', async () => {
    const quota = new TestQuota(); quota.questions = 1; const p = provider();
    const response = await handle(request('turn', requestBody()), 'turn', { env, quota, fetcher: p.fetcher, now: () => now });
    expect(response.status).toBe(200);
    const data = await json(response);
    const messages = p.bodies[0].messages as Array<{ role: string; content: string }>;
    const providerContext = JSON.parse(messages.find(message => message.role === 'user')!.content);
    expect(providerContext.questionCount).toBe(1);
    expect(data.effectiveContext).toEqual(providerContext);
    expect(data.effectiveContext).toEqual({ ...context(), questionCount: 1 });
    expect(p.count()).toBe(1);
  });
  it('enforces quota boundaries before paid work and exposes readiness', async () => {
    for (const field of ['total', 'daily', 'calls'] as const) {
      const quota = new TestQuota(); quota[field] = field === 'total' ? LIMITS.totalMicros : field === 'daily' ? LIMITS.dailyMicros : LIMITS.dailyCalls;
      const p = provider(); const response = await handle(request('turn', requestBody()), 'turn', { env, quota, fetcher: p.fetcher, now: () => now });
      expect(response.status).toBe(429); expect(p.count()).toBe(0);
    }
    const p = provider(); const response = await handle(request('models'), 'models', { env, fetcher: p.fetcher, now: () => now });
    const data = await json(response); expect(data.liveReady).toBe(false); expect(data.readiness.quota).toBe(false); expect(JSON.stringify(data)).not.toContain(env.OPENROUTER_API_KEY);
  });
  it('checks catalog capabilities and refuses untrusted Redis response details', async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ ...catalog, supported_parameters: ['temperature'] }] })) as unknown as typeof fetch;
    expect((await getModels(fetcher, now))[0].available).toBe(false);
    const store = new RedisQuotaStore({ KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'private-test-token' }, vi.fn(async () => Response.json({ error: 'private database error' })) as unknown as typeof fetch);
    await expect(store.ping()).rejects.toThrow('quota_store_unavailable');
  });
});

it('rejects compound interrogatives but permits one question with coordinated nouns', () => {
  for (const utterance of ['מה נאמר בפגישה, ואיך סוכם להמשיך?', 'מה תיאר המטופל ומה עשית?', 'מה השתנה; כיצד הגבת?']) {
    expect(() => validateResult({ ...turn(), utterance }, 'turn', context())).toThrow('invalid_question');
  }
  expect(validateResult({ ...turn(), utterance: 'מה חשוב לך לשמור לגבי מטרות והעדפות?' }, 'turn', context())).toBeTruthy();
});

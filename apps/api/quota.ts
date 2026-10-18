import { digest } from './auth.js';
import { ApiError, boundedJson, type Environment } from './errors.js';

export const LIMITS = { totalMicros: 20_000_000, dailyMicros: 10_000_000, requestMicros: 2_000_000, dailyCalls: 100, globalConcurrency: 2, leaseMs: 300_000 } as const;
export interface ReservationInput { codeId: string; sessionKey: string; requestId: string; payloadHash: string; micros: number; now: number; revision: number; questionCount: number; intakeCount: number; intakeRound: number }
export interface Reservation { requestKey: string; day: string; sessionKey: string; questionCount: number; intakeCount: number; intakeRound: number }
export interface QuotaStore {
  ping(): Promise<void>;
  accessAttempt(ipHash: string, now: number): Promise<void>;
  reserve(input: ReservationInput): Promise<Reservation>;
  finalize(reservation: Reservation, result: { costMicros?: number; status: 'done' | 'failed' | 'uncertain'; asked: 'main' | 'intake' | null; revision: number }): Promise<void>;
}

// KEYS: request, total budget, daily budget, code/day calls, global leases, session lease, session counters.
export const RESERVE_LUA = `
local old = redis.call('HGET', KEYS[1], 'hash')
if old then
  if old ~= ARGV[1] then return {'error', 'request_id_conflict'} end
  return {'error', 'request_' .. redis.call('HGET', KEYS[1], 'status')}
end
local now = tonumber(ARGV[2]); local amount = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now)
if redis.call('EXISTS', KEYS[6]) == 1 or redis.call('ZCARD', KEYS[5]) >= tonumber(ARGV[9]) then return {'error', 'concurrency_limit'} end
local prior = tonumber(redis.call('HGET', KEYS[7], 'committedRevision') or '-1')
if tonumber(ARGV[11]) <= prior then return {'error', 'stale_revision', tostring(prior + 1)} end
local total = tonumber(redis.call('GET', KEYS[2]) or '0')
local day = tonumber(redis.call('GET', KEYS[3]) or '0')
local calls = tonumber(redis.call('GET', KEYS[4]) or '0')
if amount > tonumber(ARGV[6]) then return {'error', 'request_budget_exceeded'} end
if total + amount > tonumber(ARGV[4]) then return {'error', 'total_budget_exceeded'} end
if day + amount > tonumber(ARGV[5]) then return {'error', 'daily_budget_exceeded'} end
if calls >= tonumber(ARGV[7]) then return {'error', 'daily_call_limit'} end
local q = math.max(tonumber(redis.call('HGET', KEYS[7], 'questions') or '0'), tonumber(ARGV[12]))
local field = 'intake:' .. ARGV[14]
local iq = math.max(tonumber(redis.call('HGET', KEYS[7], field) or '0'), tonumber(ARGV[13]))
redis.call('HSET', KEYS[7], 'questions', q, field, iq)
redis.call('INCRBY', KEYS[2], amount); redis.call('INCRBY', KEYS[3], amount)
redis.call('INCR', KEYS[4]); redis.call('EXPIRE', KEYS[3], 7776000); redis.call('EXPIRE', KEYS[4], 7776000)
redis.call('HSET', KEYS[1], 'hash', ARGV[1], 'status', 'pending', 'reserved', amount, 'at', now)
redis.call('ZADD', KEYS[5], now + tonumber(ARGV[8]), KEYS[1])
redis.call('SET', KEYS[6], KEYS[1], 'PX', ARGV[8])
return {'ok', tostring(q), tostring(iq)}
`;

// Completion is idempotent. Uncertain billing retains the entire reservation permanently.
export const FINALIZE_LUA = `
if redis.call('HGET', KEYS[1], 'status') ~= 'pending' then return 'already_finalized' end
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
local cost = reserved
if ARGV[1] ~= '' then cost = tonumber(ARGV[1]) end
redis.call('INCRBY', KEYS[2], cost - reserved); redis.call('INCRBY', KEYS[3], cost - reserved)
redis.call('HSET', KEYS[1], 'status', ARGV[2], 'charged', cost, 'billing', ARGV[1] == '' and 'reserved' or 'actual')
redis.call('ZREM', KEYS[4], KEYS[1])
if redis.call('GET', KEYS[5]) == KEYS[1] then redis.call('DEL', KEYS[5]) end
if ARGV[3] == 'main' then redis.call('HINCRBY', KEYS[6], 'questions', 1) end
if ARGV[3] == 'intake' then redis.call('HINCRBY', KEYS[6], 'intake:' .. ARGV[5], 1) end
if ARGV[2] == 'done' then redis.call('HSET', KEYS[6], 'committedRevision', ARGV[4]) end
return 'ok'
`;
export const ACCESS_LUA = `
local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], 900) end
local global = redis.call('INCR', KEYS[2]); if global == 1 then redis.call('EXPIRE', KEYS[2], 60) end
if count > 10 or global > 100 then return 0 end
return 1
`;

export function redisConfigured(env: Environment): boolean {
  try { return new URL(env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL ?? '').protocol === 'https:' && !!(env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN); } catch { return false; }
}
export class RedisQuotaStore implements QuotaStore {
  private readonly prefix = 'iser:v1:';
  constructor(private env: Environment, private fetcher: typeof fetch = fetch) {
    if (!redisConfigured(env)) throw new ApiError(503, 'quota_store_not_configured');
  }
  private async command(command: (string | number)[]) {
    try {
      const response = await this.fetcher((this.env.UPSTASH_REDIS_REST_URL ?? this.env.KV_REST_API_URL)!, { method: 'POST', headers: { Authorization: `Bearer ${this.env.UPSTASH_REDIS_REST_TOKEN ?? this.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(6000), redirect: 'error' });
      if (!response.ok) throw new Error();
      const data = await boundedJson(response, 16384) as { result?: unknown; error?: unknown };
      if (data.error || !('result' in data)) throw new Error();
      return data.result;
    } catch { throw new ApiError(503, 'quota_store_unavailable'); }
  }
  async ping() { if (await this.command(['PING']) !== 'PONG') throw new ApiError(503, 'quota_store_unavailable'); }
  async accessAttempt(ipHash: string, now: number) {
    const result = await this.command(['EVAL', ACCESS_LUA, 2, `${this.prefix}access:${ipHash}:${Math.floor(now / 900000)}`, `${this.prefix}access-global:${Math.floor(now / 60000)}`]);
    if (result !== 1) throw new ApiError(429, 'access_rate_limit');
  }
  async reserve(input: ReservationInput): Promise<Reservation> {
    const day = new Date(input.now).toISOString().slice(0, 10);
    const sessionKey = digest(`${input.codeId}:${input.sessionKey}`);
    const requestKey = `${this.prefix}request:${digest(`${input.codeId}:${input.requestId}`)}`;
    const keys = [requestKey, `${this.prefix}total`, `${this.prefix}day:${day}`, `${this.prefix}calls:${input.codeId}:${day}`, `${this.prefix}leases`, `${this.prefix}lease:${sessionKey}`, `${this.prefix}session:${sessionKey}`];
    const result = await this.command(['EVAL', RESERVE_LUA, keys.length, ...keys, input.payloadHash, input.now, input.micros, LIMITS.totalMicros, LIMITS.dailyMicros, LIMITS.requestMicros, LIMITS.dailyCalls, LIMITS.leaseMs, LIMITS.globalConcurrency, input.codeId, input.revision, input.questionCount, input.intakeCount, input.intakeRound]) as string[];
    if (!Array.isArray(result) || !['ok', 'error'].includes(result[0])) throw new ApiError(503, 'quota_store_unavailable');
    if (result[0] === 'error') {
      const minimumRevision = result[1] === 'stale_revision' ? Number(result[2]) : undefined;
      if (result[1] === 'stale_revision' && (!Number.isSafeInteger(minimumRevision) || minimumRevision! <= input.revision)) throw new ApiError(503, 'quota_store_unavailable');
      throw new ApiError(result[1].startsWith('request_') || result[1] === 'stale_revision' ? 409 : 429, result[1], minimumRevision);
    }
    return { requestKey, day, sessionKey, questionCount: Number(result[1]), intakeCount: Number(result[2]), intakeRound: input.intakeRound };
  }
  async finalize(r: Reservation, result: { costMicros?: number; status: 'done' | 'failed' | 'uncertain'; asked: 'main' | 'intake' | null; revision: number }) {
    const keys = [r.requestKey, `${this.prefix}total`, `${this.prefix}day:${r.day}`, `${this.prefix}leases`, `${this.prefix}lease:${r.sessionKey}`, `${this.prefix}session:${r.sessionKey}`];
    await this.command(['EVAL', FINALIZE_LUA, keys.length, ...keys, result.costMicros ?? '', result.status, result.asked ?? '', result.revision, r.intakeRound]);
  }
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError, type Environment } from './errors.js';

export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const safeEqual = (a: string, b: string) => {
  const first = Buffer.from(a); const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
};
export function authConfigured(env: Environment) {
  return /^[a-f0-9]{64}$/i.test(env.DEMO_ACCESS_CODE_HASH ?? '') && (env.SESSION_SECRET?.length ?? 0) >= 32;
}
function secret(env: Environment): string {
  if (!authConfigured(env)) throw new ApiError(503, 'access_not_configured');
  return env.SESSION_SECRET!;
}
export function verifyCode(code: string, env: Environment) {
  secret(env);
  return safeEqual(digest(code), env.DEMO_ACCESS_CODE_HASH!.toLowerCase());
}
export interface SessionClaims { sub: string; sid: string; iat: number; exp: number }
export function issueToken(env: Environment, now: number) {
  const claims: SessionClaims = { sub: digest(env.DEMO_ACCESS_CODE_HASH!).slice(0, 32), sid: randomBytes(16).toString('hex'), iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600 };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret(env)).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt: new Date(claims.exp * 1000).toISOString() };
}
export function authenticate(request: Request, env: Environment, now: number): SessionClaims {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.length > 2048 || !auth.startsWith('Bearer ')) throw new ApiError(401, 'access_required');
  const parts = auth.slice(7).split('.');
  if (parts.length !== 2) throw new ApiError(401, 'invalid_session');
  const signature = createHmac('sha256', secret(env)).update(parts[0]).digest('base64url');
  if (!safeEqual(signature, parts[1])) throw new ApiError(401, 'invalid_session');
  let claims: SessionClaims;
  try { claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); }
  catch { throw new ApiError(401, 'invalid_session'); }
  if (typeof claims.sid !== 'string' || !/^[a-f0-9]{32}$/.test(claims.sid) || claims.sub !== digest(env.DEMO_ACCESS_CODE_HASH!).slice(0, 32) || !Number.isInteger(claims.exp) || !Number.isInteger(claims.iat) || claims.iat > now / 1000 + 30 || claims.exp <= now / 1000 || claims.exp - claims.iat !== 3600) throw new ApiError(401, 'session_expired');
  return claims;
}

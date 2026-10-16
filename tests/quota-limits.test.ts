import { describe, expect, it, vi } from 'vitest';
import { dailyLimitMicros, FINALIZE_LUA, LIMITS, RedisQuotaStore, RESERVE_LUA, type ReservationInput } from '../apps/api/quota.js';

const env = { KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'fictional-test-token' };
const reservationInput = (now: number): ReservationInput => ({
  codeId: 'fictional-code', sessionKey: 'fictional-session', requestId: 'fictional-request',
  payloadHash: 'fictional-hash', micros: 100_000, now, revision: 2,
  questionCount: 1, intakeCount: 0, intakeRound: 0,
});

describe('temporary daily spending cap', () => {
  it.each([
    ['2026-10-15T23:59:59.999Z', 2_000_000],
    ['2026-10-16T00:00:00.000Z', 5_000_000],
    ['2026-10-16T23:59:59.999Z', 5_000_000],
    ['2026-10-17T00:00:00.000Z', 2_000_000],
    ['2026-10-18T12:00:00.000Z', 2_000_000],
    ['2026-10-17T02:59:59.999+03:00', 5_000_000],
    ['2026-10-17T03:00:00.000+03:00', 2_000_000],
  ])('uses the UTC date at %s', (timestamp, expected) => {
    expect(dailyLimitMicros(Date.parse(timestamp))).toBe(expected);
  });

  it.each([
    ['2026-10-16T23:59:59.999Z', '2026-10-16', 5_000_000],
    ['2026-10-17T00:00:00.000Z', '2026-10-17', 2_000_000],
  ])('passes the server-time cap to the existing Redis reservation at %s', async (timestamp, day, expectedLimit) => {
    const commands: (string | number)[][] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      commands.push(JSON.parse(String(init?.body)));
      return Response.json({ result: ['ok', '1', '0'] });
    }) as unknown as typeof fetch;
    const input = reservationInput(Date.parse(timestamp));
    const reservation = await new RedisQuotaStore(env, fetcher).reserve(input);
    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command.slice(0, 3)).toEqual(['EVAL', RESERVE_LUA, 7]);
    const keys = command.slice(3, 10);
    expect(keys.slice(1, 5)).toEqual(['iser:v1:total', `iser:v1:day:${day}`, `iser:v1:calls:fictional-code:${day}`, 'iser:v1:leases']);
    const args = command.slice(10);
    expect(args).toEqual([
      input.payloadHash, input.now, input.micros,
      10_000_000, expectedLimit, 250_000, 40, 120_000, 2,
      input.codeId, input.revision, input.questionCount, input.intakeCount, input.intakeRound,
    ]);
    expect(reservation.day).toBe(day);
    expect(LIMITS.dailyMicros).toBe(2_000_000);
  });

  it('finalizes against the original reservation day without resetting receipts or counters', async () => {
    const commands: (string | number)[][] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as (string | number)[];
      commands.push(command);
      return Response.json({ result: command[1] === RESERVE_LUA ? ['ok', '1', '0'] : 'ok' });
    }) as unknown as typeof fetch;
    const store = new RedisQuotaStore(env, fetcher);
    const reservation = await store.reserve(reservationInput(Date.parse('2026-10-16T23:59:59.999Z')));
    await store.finalize(reservation, { costMicros: 80_000, status: 'done', asked: null, revision: 2 });
    expect(commands).toHaveLength(2);
    expect(commands[1].slice(0, 6)).toEqual(['EVAL', FINALIZE_LUA, 6, reservation.requestKey, 'iser:v1:total', 'iser:v1:day:2026-10-16']);
    expect(commands[1].slice(9)).toEqual([80_000, 'done', '', 2, 0]);
  });
});

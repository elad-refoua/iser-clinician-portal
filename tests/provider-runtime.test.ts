import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { callProvider, PROVIDER_TIMEOUT_MS, type CatalogModel } from '../apps/api/provider';
import { LIMITS } from '../apps/api/quota';

describe('long-case provider runtime', () => {
  it('keeps the provider deadline inside the function lifetime and the session lease outside it', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const functionMs = config.functions['api/*.ts'].maxDuration * 1000;
    // Catalogue, reservation and finalization may each consume their full timeout.
    expect(PROVIDER_TIMEOUT_MS).toBe(180_000);
    expect(PROVIDER_TIMEOUT_MS + 8_000 + 6_000 + 6_000 + 10_000).toBeLessThan(functionMs);
    expect(LIMITS.leaseMs).toBeGreaterThan(functionMs);
    expect(LIMITS.dailyMicros).toBe(10_000_000);
    expect(LIMITS.totalMicros).toBe(20_000_000);
  });

  it('passes the longer deadline to the actual fetch and reports uncertainty without another paid attempt', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const model: CatalogModel = { id: 'anthropic/claude-sonnet-5.5', context_length: 1_000_000, pricing: { prompt: 0.000002, completion: 0.00001 }, supported_parameters: [] };
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      expect(init?.signal).toBe(controller.signal);
      init!.signal!.addEventListener('abort', () => reject(new DOMException('Deadline reached', 'TimeoutError')), { once: true });
    })) as unknown as typeof fetch;
    try {
      const result = callProvider('fictional-key', { model: model.id }, model, fetcher);
      const rejected = expect(result).rejects.toMatchObject({ code: 'provider_outcome_uncertain', costMicros: undefined });
      expect(timeout).toHaveBeenCalledExactlyOnceWith(180_000);
      controller.abort();
      await rejected;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { timeout.mockRestore(); }
  });
});

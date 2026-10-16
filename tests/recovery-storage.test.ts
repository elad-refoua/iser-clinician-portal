import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { importState } from '../packages/domain';

const database = vi.hoisted(() => ({ values: new Map<string, unknown>(), failNextWrite: false }));
vi.mock('idb', () => ({
  openDB: vi.fn(async () => ({
    put: async (_store: string, value: unknown, key: string) => {
      if (database.failNextWrite) { database.failNextWrite = false; throw new Error('mock storage unavailable'); }
      database.values.set(key, structuredClone(value));
    },
    get: async (_store: string, key: string) => structuredClone(database.values.get(key)),
    getAllKeys: async () => [...database.values.keys()],
    close: () => undefined,
  })),
}));

beforeEach(() => { database.values.clear(); database.failNextWrite = false; vi.resetModules(); });
afterEach(() => { vi.useRealTimers(); });

describe('independent local recovery copies', () => {
  it('updates one page writer while retaining another page writer and the shared current snapshot', async () => {
    database.values.set('current', 'shared snapshot');
    const firstPage = await import('../packages/domain/recovery-storage');
    const first = createDemoState(); first.sessions[0].composer = 'page one first';
    await firstPage.preservePendingCopy(first);
    vi.resetModules();
    const secondPage = await import('../packages/domain/recovery-storage');
    const second = createDemoState(); second.sessions[0].composer = 'page two';
    await secondPage.preservePendingCopy(second);
    first.sessions[0].composer = 'page one latest';
    await firstPage.preservePendingCopy(first);
    const copies = await firstPage.listPendingCopies();
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map(copy => copy.id)).size).toBe(2);
    expect(copies.map(copy => importState(copy.snapshot!).sessions[0].composer).sort()).toEqual(['page one latest', 'page two']);
    expect(database.values.get('current')).toBe('shared snapshot');
    expect(copies.every(copy => copy.patientCount === 3 && copy.sessionCount === 12)).toBe(true);
  });

  it('captures a snapshot when requested and serializes writes to the same writer key', async () => {
    const storage = await import('../packages/domain/recovery-storage');
    const value = createDemoState(); value.sessions[0].composer = 'first';
    const first = storage.preservePendingCopy(value);
    value.sessions[0].composer = 'second'; const second = storage.preservePendingCopy(value);
    value.sessions[0].composer = 'unsaved mutation';
    await Promise.all([first, second]);
    const copies = await storage.listPendingCopies();
    expect(copies).toHaveLength(1);
    expect(importState(copies[0].snapshot!).sessions[0].composer).toBe('second');
  });

  it('retains unreadable recovery records without preventing valid copies from being downloaded', async () => {
    const storage = await import('../packages/domain/recovery-storage');
    database.values.set('unsynced:damaged', { id: 'damaged', savedAt: '2026-10-16T12:00:00Z', snapshot: '{broken' });
    database.values.set('before-cloud-load', 'not a recovery entry');
    await storage.preservePendingCopy(createDemoState());
    const copies = await storage.listPendingCopies();
    expect(copies).toHaveLength(2);
    expect(copies.find(copy => copy.id === 'damaged')).toMatchObject({ snapshot: null, patientCount: null, sessionCount: null });
    expect(copies.filter(copy => copy.snapshot !== null)).toHaveLength(1);
    expect(database.values.has('unsynced:damaged')).toBe(true);
  });

  it('reports a failed write and allows a later explicit preservation request to succeed', async () => {
    const storage = await import('../packages/domain/recovery-storage');
    database.failNextWrite = true;
    await expect(storage.preservePendingCopy(createDemoState())).rejects.toThrow('mock storage unavailable');
    expect(database.values.size).toBe(0);
    await storage.preservePendingCopy(createDemoState());
    expect(await storage.listPendingCopies()).toHaveLength(1);
  });
});

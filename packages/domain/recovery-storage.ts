import { openDB } from 'idb';
import type { PortalState } from '../contracts';
import { exportState, importState } from './index';

export interface PendingCopy {
  id: string;
  savedAt: string | null;
  snapshot: string | null;
  patientCount: number | null;
  sessionCount: number | null;
}

interface StoredCopy { id: string; savedAt: string; snapshot: string }
const prefix = 'unsynced:';
const database = () => openDB('mervach-fictional-portal', 1, { upgrade(db) { db.createObjectStore('snapshots'); } });
let writerId: string | undefined;
let queue: Promise<void> = Promise.resolve();

/** Each loaded page owns its key; another tab cannot replace this recovery copy. */
export function preservePendingCopy(state: PortalState): Promise<void> {
  writerId ??= crypto.randomUUID();
  const copy: StoredCopy = { id: writerId, savedAt: new Date().toISOString(), snapshot: exportState(state) };
  const operation = queue.catch(() => undefined).then(async () => {
    const db = await database();
    try { await db.put('snapshots', copy, `${prefix}${copy.id}`); }
    finally { db.close(); }
  });
  queue = operation;
  return operation;
}

function readableCopy(id: string, value: unknown): PendingCopy {
  const unavailable: PendingCopy = { id, savedAt: null, snapshot: null, patientCount: null, sessionCount: null };
  if (!value || typeof value !== 'object') return unavailable;
  const copy = value as Partial<StoredCopy>;
  const savedAt = typeof copy.savedAt === 'string' && Number.isFinite(Date.parse(copy.savedAt)) ? copy.savedAt : null;
  if (copy.id !== id || !savedAt || typeof copy.snapshot !== 'string') return { ...unavailable, savedAt };
  try {
    const state = importState(copy.snapshot);
    return { id, savedAt, snapshot: exportState(state), patientCount: state.patients.length, sessionCount: state.sessions.length };
  } catch {
    // Keep an unreadable entry visible and retain its stored bytes for later recovery.
    return { ...unavailable, savedAt };
  }
}

export async function listPendingCopies(): Promise<PendingCopy[]> {
  await queue.catch(() => undefined);
  const db = await database();
  try {
    const keys = (await db.getAllKeys('snapshots')).filter((key): key is string => typeof key === 'string' && key.startsWith(prefix));
    const copies = await Promise.all(keys.map(async key => readableCopy(key.slice(prefix.length), await db.get('snapshots', key))));
    return copies.sort((a, b) => (b.savedAt ? Date.parse(b.savedAt) : 0) - (a.savedAt ? Date.parse(a.savedAt) : 0));
  } finally { db.close(); }
}

import { openDB } from 'idb';
import type { PortalState } from '../contracts';
import { exportState, importState } from './index';

const database = () => openDB('mervach-fictional-portal', 1, { upgrade(db) { db.createObjectStore('snapshots'); } });
let queue: Promise<void> = Promise.resolve();

export async function loadState(fallback: PortalState): Promise<PortalState> {
  const db = await database();
  try { const snapshot = await db.get('snapshots', 'current'); return snapshot ? importState(snapshot) : fallback; }
  finally { db.close(); }
}
export function persistState(state: PortalState): Promise<void> {
  const snapshot = exportState(state);
  const operation = queue.catch(() => undefined).then(async () => {
    const db = await database();
    try { await db.put('snapshots', snapshot, 'current'); } finally { db.close(); }
  });
  queue = operation;
  return operation;
}

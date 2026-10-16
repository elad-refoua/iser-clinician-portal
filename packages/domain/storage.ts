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

export interface CloudBase { revision: number; snapshot: string }
export const stateSignature = (state: PortalState) => JSON.stringify(state, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
export async function loadCloudBase(apiURL: string): Promise<CloudBase | null> {
  const value = sessionStorage.getItem(`mervach-cloud-base:${apiURL}`);
  if (!value) return null;
  const parsed = JSON.parse(value) as CloudBase;
  return Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 && typeof parsed.snapshot === 'string' ? parsed : null;
}
export async function persistCloudBase(apiURL: string, revision: number, state: PortalState) {
  // The base belongs to this tab; another tab must never advance its expected revision.
  sessionStorage.setItem(`mervach-cloud-base:${apiURL}`, JSON.stringify({ revision, snapshot: stateSignature(state) }));
}
export async function preserveLocalCopy(state: PortalState) {
  const db = await database();
  try { await db.put('snapshots', exportState(state), 'before-cloud-load'); }
  finally { db.close(); }
}
export async function readPreviousLocalCopy(): Promise<string | null> {
  const db = await database();
  try { return (await db.get('snapshots', 'before-cloud-load')) ?? null; }
  finally { db.close(); }
}

import type { PortalState } from '../../packages/contracts';

/** Stable comparison only. Workspace state and the confirmed baseline stay in memory. */
export const stateSignature = (state: PortalState) => JSON.stringify(state, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);

export function requiresLogin(failure: unknown): boolean {
  return Boolean(failure && typeof failure === 'object' && 'status' in failure && failure.status === 401);
}

export function hasUnconfirmedWork(state: PortalState, confirmedSnapshot: string | null, loaded: boolean): boolean {
  return loaded && stateSignature(state) !== confirmedSnapshot;
}

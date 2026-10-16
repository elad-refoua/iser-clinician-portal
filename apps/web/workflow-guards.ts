import type { PortalState, Session } from '../../packages/contracts';
import { stateSignature } from './workspace-state';

/** A saved retrospective manual edit is not an unfinished conversation. */
export function unfinishedSession(state: PortalState, patientId: string, branchId: string): Session | undefined {
  const sessions = state.sessions.filter(session => session.patientId === patientId && session.branchId === branchId)
    .sort((a, b) => b.number - a.number);
  return sessions.find((session, index) => Boolean(session.pendingDraft || session.pendingFields?.length || session.composer.trim())
    || (index === 0 && session.status !== 'approved'));
}

/** This only enables an explicit choice; it does not authorize automatic adoption. */
export function canReconnectLocal(remote: PortalState | null, baseSnapshot: string | null): boolean {
  return remote !== null && baseSnapshot !== null && stateSignature(remote) === baseSnapshot;
}

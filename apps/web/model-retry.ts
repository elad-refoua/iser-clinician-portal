import type { DraftFollowUp, Goal, PortalState } from '../../packages/contracts';
import { stateSignature } from './workspace-state';

type Selection = { patientId: string; branchId: string; sessionId: string };
export interface FailedExpansionRetry {
  selection: Selection;
  goal: Goal;
  focusSelection?: DraftFollowUp;
  expectedState: string;
}

/** Capture the state after rollback, so a retry starts a fresh voluntary round. */
export function rememberExpansionRetry(state: PortalState, selection: Selection, goal: Goal, focusSelection?: DraftFollowUp): FailedExpansionRetry {
  return { selection: { ...selection }, goal, ...(focusSelection ? { focusSelection: structuredClone(focusSelection) } : {}), expectedState: stateSignature(state) };
}

export function canRetryExpansion(state: PortalState, selection: Selection, retry: FailedExpansionRetry): boolean {
  return selection.patientId === retry.selection.patientId && selection.branchId === retry.selection.branchId
    && selection.sessionId === retry.selection.sessionId && stateSignature(state) === retry.expectedState;
}

/** A stale-revision rejection happened before quota reservation or provider work.
 * The current explicit action may rebase once; a second rejection never loops. */
export async function retryAfterStaleRevision<T>(attempt: () => Promise<T>, rebaseIfCurrent: (minimumRevision: number) => boolean): Promise<T> {
  try { return await attempt(); }
  catch (error) {
    if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 409
      || !('code' in error) || error.code !== 'stale_revision'
      || !('minimumRevision' in error) || typeof error.minimumRevision !== 'number'
      || !Number.isSafeInteger(error.minimumRevision) || error.minimumRevision <= 0
      || !rebaseIfCurrent(error.minimumRevision)) throw error;
    return attempt();
  }
}

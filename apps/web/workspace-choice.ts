import type { PortalState } from '../../packages/contracts';
import { stateSignature } from '../../packages/domain/storage';

export function chooseWorkspaceAction(local: PortalState, remote: PortalState | null, baseSnapshot: string | null): 'connect' | 'load' | 'choose' {
  if (remote === null) return 'connect';
  const localSnapshot = stateSignature(local);
  if (localSnapshot === stateSignature(remote)) return 'connect';
  return localSnapshot === baseSnapshot ? 'load' : 'choose';
}

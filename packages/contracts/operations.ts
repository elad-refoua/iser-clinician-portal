import type { ContextPacket, DraftResult, ModelRequest, ModelResponse, TurnResult } from './index.js';

export type OperationTask = 'turn' | 'draft';
export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'uncertain';
export interface OperationSummary {
  id: string; task: OperationTask; model: string; patientId: string; branchId: string; sessionId: string;
  baseRevision: number; status: OperationStatus; createdAt: string; updatedAt: string;
  errorCode?: string; acknowledgedAt?: string;
}
export interface OperationDetail extends OperationSummary {
  context: ContextPacket; response?: ModelResponse<TurnResult | DraftResult>; minimumRevision?: number;
}
export interface OperationStartRequest extends ModelRequest { task: OperationTask; workspaceRevision: number }
export interface OperationAckRequest { action: 'ack'; requestId: string; workspaceRevision: number }
export interface OperationDismissRequest { action: 'dismiss'; requestId: string }
export interface OperationListResponse { operations: OperationSummary[] }
export interface OperationResponse { operation: OperationDetail }

/** Stable JSON comparison preserves array order and all authored content. */
export function canonicalOperationValue(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item)
      .filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, ordered(child)])) : item;
  return JSON.stringify(ordered(value));
}
export function comparableOperationContext(context: ContextPacket): string {
  const { asOf: _asOf, ...scoped } = context;
  return canonicalOperationValue(scoped);
}

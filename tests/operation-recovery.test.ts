import { afterEach, expect, it, vi } from 'vitest';
import { addUserMessage, buildContext, compactModelContext, createPatient, editDocument, exportState, importState } from '../packages/domain';
import type { PortalState, TurnResult } from '../packages/contracts';
import type { OperationDetail } from '../packages/contracts/operations';
import { applyOperation, draftChildId, findDraftChild, OperationError, operationDisposition, rejectedBeforeOperation, startOperation, terminalOperationError, waitForOperation } from '../apps/web/model-operations';
import { retryAfterStaleRevision } from '../apps/web/model-retry';

function fixture() {
  const empty: PortalState = { schemaVersion: 1, patients: [], branches: [], sessions: [], sources: [], versions: [], preferences: [] };
  const created = createPatient(empty, { name: 'בדיקת המשכיות בדיונית' });
  const state = addUserMessage(created.state, created.session.id, 'דיבר על הלחץ בזמן המעבר לדירה חדשה.');
  const context = compactModelContext(buildContext(state, created.session.id));
  const result: TurnResult = { action: 'question', utterance: 'איך תיאר את הלחץ סביב המעבר?', topic: 'מעבר דירה', rationale: 'בירור דבריו על המעבר.', fieldUpdates: [], preferenceUpdates: [], evidenceMap: [], questionAnchor: { sourceIds: [context.sources.at(-1)!.id], fieldIds: [] } };
  const operation: OperationDetail = { id: crypto.randomUUID(), task: 'turn', model: 'fictional-test', patientId: created.patient.id, branchId: created.branch.id, sessionId: created.session.id, baseRevision: context.baseRevision, status: 'succeeded', createdAt: context.asOf, updatedAt: context.asOf, context,
    response: { result, model: 'server-policy', prompt: 'fictional test', promptVersion: 'test', elapsedMs: 1, effectiveContext: context } };
  return { state, operation };
}
afterEach(() => vi.unstubAllGlobals());

it('looks up a deterministic child directly, independent of bounded operation listings', async () => {
  const { operation } = fixture(); operation.id = draftChildId('parent-turn'); operation.task = 'draft';
  const fetcher = vi.fn().mockResolvedValue(Response.json({ operation })); vi.stubGlobal('fetch', fetcher);
  expect((await findDraftChild('', 'fictional', 'parent-turn'))?.id).toBe('draft-parent-turn');
  expect(fetcher.mock.calls[0][0]).toBe('/api/operations?requestId=draft-parent-turn');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'operation_not_found' }, { status: 404 })));
  expect(await findDraftChild('', 'fictional', 'parent-turn')).toBeNull();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  await expect(findDraftChild('', 'fictional', 'parent-turn')).rejects.toMatchObject({ code: 'operation_connection_lost' });
});

it('distinguishes definite POST rejections from a potentially saved job after lost reply and expired login', async () => {
  const { operation } = fixture();
  const input = { requestId: operation.id, task: operation.task, model: operation.model, context: operation.context, workspaceRevision: 2 };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'session_expired' }, { status: 401 })));
  const direct = await startOperation('', 'fictional', input).catch(error => error);
  expect(rejectedBeforeOperation(direct)).toBe(true);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('lost reply')).mockResolvedValueOnce(Response.json({ error: 'session_expired' }, { status: 401 })));
  const lookup = await startOperation('', 'fictional', input).catch(error => error);
  expect(rejectedBeforeOperation(lookup)).toBe(false);
  expect(rejectedBeforeOperation(new OperationError('operation_store_unavailable', 503))).toBe(false);
  expect(rejectedBeforeOperation(new OperationError('operation_connection_lost'))).toBe(false);
});

it('a journaled stale-revision rejection keeps the single bounded rebase path usable', async () => {
  const { operation } = fixture(); operation.status = 'failed'; operation.errorCode = 'stale_revision'; operation.minimumRevision = 4;
  let attempts = 0; const rebase = vi.fn(() => true);
  expect(await retryAfterStaleRevision(async () => { if (++attempts === 1) throw terminalOperationError(operation); return 'ready'; }, rebase)).toBe('ready');
  expect(attempts).toBe(2); expect(rebase).toHaveBeenCalledWith(4);
});

it('applies a recovered reply once, using its operation ID as the persistent trace identity', () => {
  const { state, operation } = fixture();
  expect(operationDisposition(state, operation)).toBe('current');
  const next = applyOperation(state, operation);
  expect(next.sessions[0].messages).toHaveLength(state.sessions[0].messages.length + 1);
  expect(next.sessions[0].traces.at(-1)?.id).toBe(operation.id);
  expect(operationDisposition(next, operation)).toBe('applied');
  expect(applyOperation(next, operation)).toBe(next);
});

it('does not apply a result over a new source, manual document edit or changed preference', () => {
  const { state, operation } = fixture();
  const newer = addUserMessage(state, operation.sessionId, 'הבהרה בדיונית נוספת.');
  expect(operationDisposition(newer, operation)).toBe('stale');
  expect(() => applyOperation(newer, operation)).toThrow();
  const manual = editDocument(state, operation.patientId, operation.branchId, 'note', 'עריכה ידנית בדיונית.', undefined, operation.sessionId);
  expect(operationDisposition(manual, operation)).toBe('stale');
  const preference: PortalState = { ...state, preferences: [{ id: 'pref', topic: 'מעבר דירה', action: 'block', scope: 'patient', patientId: operation.patientId, branchId: operation.branchId, recordedAt: new Date().toISOString() }] };
  expect(operationDisposition(preference, operation)).toBe('stale');
});

it('ignores wall-clock generation time while preserving the full contextual fingerprint', () => {
  const { state, operation } = fixture();
  operation.context.asOf = '2026-10-18T00:00:00.000Z';
  expect(operationDisposition(state, operation)).toBe('current');
  operation.context.sources[0].text += 'tamper';
  expect(operationDisposition(state, operation)).toBe('stale');
});

it('never treats a result from a missing session as applicable', () => {
  const { state, operation } = fixture(); operation.sessionId = 'different-session';
  expect(operationDisposition(state, operation)).toBe('stale');
});

it('recovers a lost start reply by looking up the same operation ID without another POST', async () => {
  const { operation } = fixture();
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(Response.json({ operation }));
  vi.stubGlobal('fetch', fetcher);
  const recovered = await startOperation('', 'fictional', { requestId: operation.id, task: operation.task, model: operation.model, context: operation.context, workspaceRevision: 2 });
  expect(recovered.id).toBe(operation.id);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][1].method).toBe('POST'); expect(fetcher.mock.calls[1][1].method).toBe('GET');
  expect(fetcher.mock.calls[1][0]).toContain(operation.id);
});

it('an uncertain provider outcome is returned without silently sending a new generation', async () => {
  const { operation } = fixture(); operation.status = 'uncertain'; delete operation.response;
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(await waitForOperation('', 'fictional', operation, new AbortController().signal)).toBe(operation);
  expect(fetcher).not.toHaveBeenCalled();
});

it('stopping the wait does not send a cancellation or another generation to the server', async () => {
  const { operation } = fixture(); operation.status = 'running'; delete operation.response;
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const expected = expect(waitForOperation('', 'fictional', operation, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await expected; expect(fetcher).not.toHaveBeenCalled();
});

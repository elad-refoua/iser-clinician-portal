import { describe, expect, it } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { preparedDraft } from '../fixtures/fictional/prepared';
import { addUserMessage, buildContext, compactModelContext, createSession, exportState, importState, saveDraft } from '../packages/domain';
import { buildSystemPrompt } from '../packages/prompts';
import { prepareProviderRequest, type CatalogModel } from '../apps/api/provider';
import { responseSchema, validateRequest } from '../apps/api/validation';
import { LIMITS } from '../apps/api/quota';
import type { DraftResult } from '../packages/contracts';
import { MAX_MODEL_REQUEST_BYTES } from '../packages/contracts';
import { longCaseRequest } from './long-case-fixture';

// Public catalogue prices observed on 2026-10-16; no provider requests in this suite.
const model: CatalogModel = { id: 'anthropic/claude-sonnet-5.5', context_length: 1_000_000,
  pricing: { prompt: 0.000002, completion: 0.00001 }, supported_parameters: ['response_format', 'structured_outputs', 'max_tokens'] };
function active(patientIndex = 0) {
  const seed = createDemoState(); const patient = seed.patients[patientIndex];
  const branch = seed.branches.find(item => item.patientId === patient.id)!;
  const created = createSession(seed, patient.id, branch.id, 5);
  return { ...created, state: addUserMessage(created.state, created.session.id, 'תיאור בדיוני לצורך בדיקה בלבד. המטפל מסר שחזרו לשיחה מהשבוע שעבר וסיכמו להמשיך בפגישה הבאה.') };
}

describe('lossless bounded model requests', () => {
  it('gives a near-maximum accepted Hebrew case a full Sonnet draft without dropping source, document or pending-draft content', () => {
    const request = longCaseRequest();
    const before = JSON.stringify(request);
    expect(Buffer.byteLength(before, 'utf8')).toBe(MAX_MODEL_REQUEST_BYTES - 128);
    validateRequest(request, 'draft');
    const prepared = prepareProviderRequest(model, 'draft', buildSystemPrompt(request.context, 'draft'), request.context, responseSchema('draft'));
    expect(prepared.micros).toBeGreaterThan(250_000);
    expect(prepared.micros).toBeLessThanOrEqual(2_000_000);
    expect(prepared.outputTokens).toBe(6000);
    const messages = prepared.body.messages as { role: string; content: string }[];
    expect(JSON.parse(messages[1].content)).toEqual(request.context);
    expect(JSON.stringify(request)).toBe(before);
  });
  it('keeps first drafts and their regeneration usable for every seeded case under the request cap', () => {
    for (let patient = 0; patient < 3; patient++) {
      let { state, session } = active(patient);
      const original = buildContext(state, session.id, 'draft');
      const result: DraftResult = { ...preparedDraft(original), summary: 'סיכום בדיוני לבדיקה', followUps: [],
        fieldUpdates: [{ id: 18, value: 'המטפל מסר שגרת יום בדיונית לבדיקה.', status: 'partial', sourceIds: [state.sources.at(-1)!.id], remaining: 'מידע נוסף לא נמסר.' }] };
      state = saveDraft(state, session.id, original.baseRevision, result);
      const before = exportState(state);
      for (const raw of [original, buildContext(state, session.id, 'draft')]) {
        const context = compactModelContext(raw);
        validateRequest({ requestId: 'budget-review', model: model.id, context }, 'draft');
        const prepared = prepareProviderRequest(model, 'draft', buildSystemPrompt(context, 'draft'), context, responseSchema('draft'));
        expect(prepared.outputTokens).toBeGreaterThanOrEqual(3500);
        expect(prepared.micros).toBeLessThanOrEqual(LIMITS.requestMicros);
        expect(context.sources).toEqual(raw.sources);
        expect(context.messages).toEqual(raw.messages);
        expect(context.documents.map(doc => doc.fields)).toEqual(raw.documents.map(doc => doc.fields));
        expect(context.pendingIntakeFields).toEqual(raw.pendingIntakeFields);
        expect(compactModelContext(context)).toEqual(context);
        expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(Buffer.byteLength(JSON.stringify(raw)));
      }
      expect(exportState(state)).toBe(before);
      const context = compactModelContext(buildContext(state, session.id, 'draft'));
      expect(context.workingDraft!.fieldUpdates).toEqual([]);
      expect(state.sessions.find(item => item.id === session.id)!.pendingDraft!.result.fieldUpdates).toHaveLength(1);
      state.sessions.find(item => item.id === session.id)!.traces.push({ id: 'projected-trace', at: new Date().toISOString(), mode: 'live', model: model.id,
        promptVersion: 'test', prompt: 'test', contextOrigin: 'server', context, response: result, elapsedMs: 1 });
      expect(importState(exportState(state))).toEqual(state);
    }
  });

  it('does not remove independently authored intake text or a nonduplicate field patch', () => {
    const { state, session } = active(); const context = buildContext(state, session.id, 'draft');
    const intake = context.documents.find(document => document.kind === 'intake')!;
    intake.content += '\nמידע נוסף שנכתב באופן עצמאי ואינו חלק מהשדות.';
    const result = preparedDraft(context);
    context.workingDraft = { ...result, fieldUpdates: [{ id: 18, value: 'מידע אחר', status: 'partial', sourceIds: [state.sources.at(-1)!.id], remaining: '' }] };
    context.pendingIntakeFields = intake.fields;
    const compact = compactModelContext(context);
    expect(compact.documents.find(document => document.kind === 'intake')!.content).toBe(intake.content);
    expect(compact.workingDraft!.fieldUpdates).toEqual(context.workingDraft.fieldUpdates);
  });

  it('adapts output capacity but never drops below the useful draft floor or exceeds the authorized request cap', () => {
    const prepared = prepareProviderRequest(model, 'draft', 'x'.repeat(940_000), {}, {});
    expect(prepared.outputTokens).toBeGreaterThanOrEqual(3500);
    expect(prepared.outputTokens).toBeLessThan(6000);
    expect(prepared.micros).toBeLessThanOrEqual(2_000_000);
    expect(() => prepareProviderRequest(model, 'draft', 'x'.repeat(970_000), {}, {})).toThrow('request_budget_exceeded');
    expect(() => prepareProviderRequest({ ...model, context_length: 10_000 }, 'draft', 'x'.repeat(2000), {}, {})).toThrow('model_context_limit');
    expect(() => prepareProviderRequest({ ...model, top_provider: { max_completion_tokens: 3499 } }, 'draft', '', {}, {})).toThrow('model_output_limit');
    expect(LIMITS.requestMicros).toBe(2_000_000);
  });

  it('pins final output capacity to the reservation even when the final prompt is shorter', () => {
    const initial = prepareProviderRequest(model, 'draft', 'x'.repeat(940_000), {}, {});
    const final = prepareProviderRequest(model, 'draft', 'x'.repeat(939_990), {}, {}, initial.outputTokens);
    expect(final.outputTokens).toBe(initial.outputTokens);
    expect(final.micros).toBeLessThanOrEqual(initial.micros);
  });
});

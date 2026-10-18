import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDemoState } from '../fixtures/fictional';
import { preparedDraft } from '../fixtures/fictional/prepared';
import type { ContextPacket, DraftResult, FieldStatus, TurnResult } from '../packages/contracts';
import { addUserMessage, buildContext, createSession } from '../packages/domain';
import { normalizeWireResult, responseSchema, validateRequest, validateResult } from '../apps/api/validation';

function context(task: 'turn' | 'draft'): ContextPacket {
  const made = createSession(createDemoState(), 'fictional-tamar', 'fictional-tamar-main', 5);
  return buildContext(addUserMessage(made.state, made.session.id, 'Artificial source text for wire schema testing.'), made.session.id, task === 'draft' ? 'draft' : 'main');
}
function output(task: 'turn' | 'draft', c: ContextPacket): TurnResult | DraftResult {
  const fieldUpdates = [{ id: 1, status: 'unknown' as const, value: '', remaining: 'Not yet documented', sourceIds: [] }];
  return task === 'draft'
    ? { ...preparedDraft(c), fieldUpdates, summary: 'Artificial test summary', followUps: [], preferenceUpdates: [], evidenceMap: [] }
    : { action: 'question', utterance: 'What detail matters?', topic: 'detail', rationale: 'Artificial test', fieldUpdates, preferenceUpdates: [], evidenceMap: [], questionAnchor: { sourceIds: [c.sources.at(-1)!.id], fieldIds: [] } };
}

describe.each(['turn', 'draft'] as const)('%s provider field schema', task => {
  it('constrains unknown to an empty string through nested anyOf without unsupported conditionals', () => {
    const schema = responseSchema(task) as any;
    expect(schema.type).toBe('object'); expect(schema.anyOf).toBeUndefined();
    const branches = schema.properties.fieldUpdates.items.anyOf;
    expect(branches).toHaveLength(2);
    expect(branches[0].properties.status.enum).toEqual(['unknown']);
    expect(branches[0].properties.value).toEqual({ type: 'string', enum: [''] });
    expect(branches[1].properties.status.enum).not.toContain('unknown');
    for (const branch of branches) {
      expect(branch.type).toBe('object'); expect(branch.additionalProperties).toBe(false);
      expect([...branch.required].sort()).toEqual(Object.keys(branch.properties).sort());
    }
    expect(JSON.stringify(schema)).not.toMatch(/"(?:oneOf|if|then|else|allOf|const|minLength|maxLength|pattern)"/);
    // Exercise the emitted JSON Schema, not the internal runtime field validator.
    const wire = z.fromJSONSchema(schema);
    const c = context(task); const value = output(task, c);
    expect(wire.safeParse(value).success).toBe(true);
    for (const text of ['not provided', 'Fictional substantive detail', ' ']) {
      const invalid = structuredClone(value); invalid.fieldUpdates[0].value = text;
      expect(wire.safeParse(invalid).success).toBe(false);
    }
    for (const status of branches[1].properties.status.enum as FieldStatus[]) {
      const factual = structuredClone(value);
      factual.fieldUpdates[0] = { ...factual.fieldUpdates[0], status, value: 'Fictional substantive detail', sourceIds: [c.sources[0].id] };
      expect(wire.safeParse(factual).success).toBe(true);
    }
  });

  it('retains runtime rejection and never silently empties returned clinical text', () => {
    const c = context(task); const value = output(task, c);
    value.fieldUpdates[0].value = 'Fictional substantive detail that must not be discarded';
    const before = structuredClone(value);
    expect(() => validateResult(normalizeWireResult(value), task, c)).toThrow('unsupported_unknown_value');
    expect(value).toEqual(before);
    value.fieldUpdates[0].value = '';
    expect(validateResult(value, task, c).fieldUpdates[0].value).toBe('');
    value.fieldUpdates[0].status = 'partial'; value.fieldUpdates[0].value = 'Preserved sourced detail'; value.fieldUpdates[0].sourceIds = [c.sources[0].id];
    expect(validateResult(value, task, c).fieldUpdates[0].value).toBe('Preserved sourced detail');
  });
});

it('keeps historical stored fields and derivative draft context compatible with their existing shapes', () => {
  const c = context('draft');
  const legacy = { id: 1, status: 'unknown' as const, value: 'Legacy fictional text. '.repeat(300), sourceIds: [], remaining: 'Legacy remainder' };
  c.pendingIntakeFields = [legacy];
  c.workingDraft = { ...preparedDraft(c), fieldUpdates: [legacy] };
  const intake = c.documents.find(document => document.kind === 'intake')!;
  intake.fields = intake.fields!.map(field => field.id === legacy.id ? legacy : field);
  const validated = validateRequest({ requestId: 'wire-legacy-compatibility', model: 'anthropic/claude-sonnet-5.5', context: c }, 'draft').context;
  expect(validated.pendingIntakeFields?.[0].value).toBe(legacy.value);
  expect(validated.workingDraft?.fieldUpdates[0].value).toBe(legacy.value);
  expect(validated.documents.find(document => document.kind === 'intake')?.fields?.find(field => field.id === legacy.id)?.value).toBe(legacy.value);
});

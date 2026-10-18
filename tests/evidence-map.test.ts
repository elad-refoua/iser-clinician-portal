import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDemoState } from '../fixtures/fictional';
import type { ContextPacket, EvidenceItem, FieldStatus, PortalState, Session, TurnResult } from '../packages/contracts';
import { addUserMessage, applyTurn, buildContext, createPatient, createSession, currentVersion, editDocument, emptyIntakeFields, exportState, forkBranch, importState, restoreVersion } from '../packages/domain';
import { deriveEvidenceMap } from '../packages/domain/evidence-map';
import { intakeCompletionFocus, intakeReadiness } from '../packages/domain/intake-readiness';
import { responseSchema, validateRequest, validateResult } from '../apps/api/validation';

const get = (state: PortalState, session: Session) => state.sessions.find(item => item.id === session.id)!;
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
  const blank: PortalState = { schemaVersion: 1, patients: [], branches: [], sessions: [], sources: [], versions: [], preferences: [] };
  const created = createPatient(blank, { name: 'Fictional evidence map test' });
  vi.advanceTimersByTime(1000);
  const active = createSession(created.state, created.patient.id, created.branch.id, 4);
  return { ...created, ...active };
}
function entry(context: ContextPacket, fieldIds = [6], sourceId = context.sources.at(-1)!.id): EvidenceItem {
  const source = context.sources.find(item => item.id === sourceId)!;
  return { sourceId, quote: source.text, attribution: 'clinician_report', kind: 'event', temporalReference: '', fieldIds, destinations: ['intake'], uncertainty: 'unspecified' };
}
const turn = (context: ContextPacket): TurnResult => ({ action: 'question', utterance: 'What detail matters?', topic: 'detail', rationale: 'Fictional test', fieldUpdates: [], preferenceUpdates: [], evidenceMap: [], questionAnchor: { sourceIds: [context.sources.at(-1)!.id], fieldIds: [] } });
function appendEvidence(state: PortalState, session: Session, fieldIds: number[], text = 'Fictional event yesterday.') {
  vi.advanceTimersByTime(10); state = addUserMessage(state, session.id, text);
  const context = buildContext(state, session.id);
  const item = entry(context, fieldIds);
  get(state, session).traces.push({ id: `trace-${state.sources.length}`, at: context.asOf, mode: 'live', model: 'fictional-model', promptVersion: 'fixture', prompt: 'Fictional evidence fixture', elapsedMs: 1, context, response: { ...turn(context), evidenceMap: [item] } });
  return { state, item };
}
function editField(state: PortalState, session: Session, id: number, status: FieldStatus, value: string) {
  vi.advanceTimersByTime(10);
  const fields = structuredClone(currentVersion(state, session.patientId, session.branchId, 'intake')?.fields ?? emptyIntakeFields());
  Object.assign(fields.find(field => field.id === id)!, { status, value });
  return editDocument(state, session.patientId, session.branchId, 'intake', '', fields, session.id);
}
afterEach(() => vi.useRealTimers());

describe('source-linked evidence validation', () => {
  it('requires the new fields on provider wire while retaining absent additions in historical shapes', () => {
    const { state, session } = setup(); const context = buildContext(state, session.id);
    const output = turn(context);
    const wire = z.fromJSONSchema(responseSchema('turn') as any);
    expect(wire.safeParse(output).success).toBe(true);
    const legacy = { ...output }; delete legacy.evidenceMap; delete legacy.questionAnchor;
    expect(wire.safeParse(legacy).success).toBe(false);
    expect(validateResult(legacy, 'turn', context)).toEqual(legacy);
    expect(() => validateResult(legacy, 'turn', context, { requireEvidence: true })).toThrow('invalid_model_output');
    expect(validateResult(output, 'turn', context, { requireEvidence: true })).toEqual(output);
    const draft = responseSchema('draft') as any;
    expect(draft.required).toContain('evidenceMap'); expect(draft.properties.questionAnchor).toBeUndefined();
    const noMap = { ...output }; delete noMap.evidenceMap;
    expect(wire.safeParse(noMap).success).toBe(false);
  });

  it.each([
    ['unknown source', { sourceId: 'foreign-source' }, 'unknown_evidence_source'],
    ['paraphrased quote', { quote: 'A plausible invented paraphrase' }, 'invalid_evidence_quote'],
    ['blank quote', { quote: ' ' }, 'invalid_evidence_quote'],
    ['invented date', { temporalReference: '2020-01-01' }, 'invalid_evidence_time'],
    ['duplicate fields', { fieldIds: [6, 6] }, 'duplicate_evidence_link'],
    ['duplicate destinations', { destinations: ['note', 'note'] }, 'duplicate_evidence_link'],
  ] as const)('rejects %s without rewriting excerpts', (_name, patch, error) => {
    let { state, session } = setup(); ({ state } = appendEvidence(state, session, [6]));
    const context = buildContext(state, session.id); const output = { ...turn(context), evidenceMap: [{ ...entry(context), ...patch }] };
    const before = structuredClone(output);
    expect(() => validateResult(output, 'turn', context)).toThrow(error); expect(output).toEqual(before);
  });

  it('accepts an exact source time phrase and rejects oversize maps and quotes', () => {
    let { state, session } = setup(); ({ state } = appendEvidence(state, session, [6]));
    const context = buildContext(state, session.id); const item = { ...entry(context), temporalReference: 'yesterday' };
    expect(validateResult({ ...turn(context), evidenceMap: [item] }, 'turn', context).evidenceMap).toEqual([item]);
    expect(() => validateResult({ ...turn(context), evidenceMap: Array(9).fill(item) }, 'turn', context)).toThrow('invalid_model_output');
    expect(() => validateResult({ ...turn(context), evidenceMap: [{ ...item, quote: 'x'.repeat(601) }] }, 'turn', context)).toThrow('invalid_model_output');
  });

  it('requires a real source or an explicit admissible selected field for a question', () => {
    const { state, session } = setup(); const context = buildContext(state, session.id);
    const output = { ...turn(context), questionAnchor: { sourceIds: [], fieldIds: [6] } };
    expect(() => validateResult(output, 'turn', context)).toThrow('ungrounded_question');
    context.focusGoal = 'intake'; context.focusSelection = intakeCompletionFocus(6);
    expect(() => validateResult(output, 'turn', context)).toThrow('ungrounded_question');
    context.stage = 'intake';
    expect(validateResult(output, 'turn', context)).toBeTruthy();
    context.skippedTopics = ['תלונת המטופל'];
    expect(() => validateResult(output, 'turn', context)).toThrow('blocked_question_anchor');
    expect(() => validateResult({ ...turn(context), questionAnchor: { sourceIds: ['outside'], fieldIds: [] } }, 'turn', context)).toThrow('unknown_question_source');
    expect(() => validateResult({ ...turn(context), action: 'draft', utterance: 'Draft now.' }, 'turn', context)).toThrow('unexpected_question_anchor');
    expect(validateResult({ ...turn(context), action: 'draft', utterance: 'Draft now.', questionAnchor: { sourceIds: [], fieldIds: [] } }, 'turn', context)).toBeTruthy();
  });

  it('checks maps carried in request context and archived trace responses', () => {
    let { state, session } = setup(); ({ state } = appendEvidence(state, session, [6]));
    const context = buildContext(state, session.id);
    context.evidenceMap![0].quote = 'Fabricated excerpt';
    expect(() => validateRequest({ requestId: 'evidence-request', model: 'anthropic/claude-sonnet-5.5', context }, 'turn')).toThrow('invalid_evidence_quote');
    get(state, session).traces[0].response.evidenceMap![0].sourceId = 'outside';
    expect(() => importState(exportState(state))).toThrow('מיפוי המקורות');
  });
});

describe('derived map boundaries and authority', () => {
  it('preserves derived evidence across JSON object reordering and validated workspace import', () => {
    let { state, session } = setup(); const appended = appendEvidence(state, session, [6]); state = appended.state;
    const reordered = JSON.parse(JSON.stringify(state, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : value)) as PortalState;
    const imported = importState(JSON.stringify(reordered));
    const expected = [appended.item];
    expect(buildContext(state, session.id).evidenceMap).toEqual(expected);
    expect(buildContext(reordered, session.id).evidenceMap).toEqual(expected);
    expect(buildContext(imported, session.id).evidenceMap).toEqual(expected);
    // A real source edit still invalidates the old snapshot even when its excerpt remains present.
    imported.sources.find(source => source.id === appended.item.sourceId)!.text += ' Additional invented sentence.';
    expect(buildContext(imported, session.id).evidenceMap).toEqual([]);
  });

  it('derives from responses, preserves raw sources and never promotes mapped evidence into fields', () => {
    let { state, session } = setup(); ({ state } = appendEvidence(state, session, [6]));
    const before = exportState(state); const context = buildContext(state, session.id);
    expect(context.evidenceMap).toHaveLength(1); expect(context.sources).toEqual(state.sources);
    expect(intakeReadiness(context).fields.find(field => field.id === 6)?.status).toBe('unknown');
    const updated = applyTurn(state, session.id, get(state, session).revision, { ...turn(context), evidenceMap: context.evidenceMap });
    expect(get(updated, session).pendingFields).toEqual([]);
    expect(exportState(state)).toBe(before); expect(importState(before)).toEqual(state);
  });

  it('bounds the map at forty recent entries without discarding raw history', () => {
    let { state, session } = setup();
    for (let index = 0; index < 43; index++) ({ state } = appendEvidence(state, session, [6], `Artificial event ${index}.`));
    const context = buildContext(state, session.id);
    expect(context.evidenceMap).toHaveLength(40); expect(context.evidenceMap![0].quote).toBe('Artificial event 42.');
    expect(context.evidenceMap!.at(-1)!.quote).toBe('Artificial event 3.');
    expect(context.sources).toHaveLength(44); expect(get(state, session).traces).toHaveLength(43);
  });

  it('suppresses old field links on manual change or deletion and restores the selected authority', () => {
    let { state, session } = setup(); ({ state } = appendEvidence(state, session, [6, 8]));
    state = editField(state, session, 6, 'partial', 'Manual fictional correction');
    const corrected = currentVersion(state, session.patientId, session.branchId, 'intake')!;
    expect(buildContext(state, session.id).evidenceMap![0].fieldIds).not.toContain(6);
    ({ state } = appendEvidence(state, session, [6], 'A newer artificial account.'));
    expect(buildContext(state, session.id).evidenceMap![0].fieldIds).toEqual([6]);
    state = editField(state, session, 6, 'unknown', '');
    expect(buildContext(state, session.id).evidenceMap!.every(item => !item.fieldIds.includes(6))).toBe(true);
    vi.advanceTimersByTime(10); state = restoreVersion(state, corrected.id);
    const restored = buildContext(state, session.id);
    expect(restored.evidenceMap!.every(item => !item.fieldIds.includes(6))).toBe(true);
    expect(intakeReadiness(restored).fields.find(field => field.id === 6)?.value).toBe('Manual fictional correction');
    expect(get(state, session).traces[0].response.evidenceMap![0].fieldIds).toEqual([6, 8]);
    expect(importState(exportState(state))).toEqual(state);
  });

  it('does not revive a deleted field association when a later provider response maps the old source again', () => {
    let { state, session } = setup(); const original = appendEvidence(state, session, [6]); state = original.state;
    state = editField(state, session, 6, 'partial', 'Manual fictional correction');
    state = editField(state, session, 6, 'unknown', '');
    vi.advanceTimersByTime(10);
    const context = buildContext(state, session.id);
    const response = validateResult({ ...turn(context), evidenceMap: [original.item] }, 'turn', context, { requireEvidence: true }) as TurnResult;
    get(state, session).traces.push({ id: 'reintroduced-map', at: context.asOf, context, response, mode: 'live', model: 'fictional-model', promptVersion: 'fixture', prompt: 'Fictional remapping fixture', elapsedMs: 1 });
    const updated = applyTurn(state, session.id, get(state, session).revision, response);
    const effective = buildContext(updated, session.id);
    expect(effective.evidenceMap![0].fieldIds).toEqual([]);
    expect(get(updated, session).pendingFields).toEqual([]);
    expect(intakeReadiness(effective).fields.find(field => field.id === 6)).toMatchObject({ status: 'unknown', value: '' });
    expect(get(updated, session).traces.at(-1)!.response.evidenceMap![0].fieldIds).toEqual([6]);
    expect(importState(exportState(updated))).toEqual(updated);
  });

  it('keeps restored empty baseline fields authoritative while retaining baseline-supported links', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
    const seed = createDemoState(); const patient = seed.patients[0]; const branch = seed.branches.find(item => item.patientId === patient.id)!;
    const made = createSession(seed, patient.id, branch.id, 5); let state = made.state; const session = made.session;
    const baseline = currentVersion(state, patient.id, branch.id, 'intake')!;
    expect(baseline.fields!.find(field => field.id === 2)).toMatchObject({ status: 'unknown', sourceIds: [] });
    ({ state } = appendEvidence(state, session, [2]));
    const trace = get(state, session).traces[0];
    const supported = baseline.fields!.find(field => field.sourceIds.length)!;
    const source = trace.context.sources.find(source => source.id === supported.sourceIds[0])!;
    trace.response.evidenceMap!.push({ ...entry(trace.context, [supported.id], source.id), quote: source.text.slice(0, 100) });
    state = editField(state, session, 2, 'partial', 'Manual correction');
    vi.advanceTimersByTime(10); state = restoreVersion(state, baseline.id);
    const context = buildContext(state, session.id);
    expect(context.evidenceMap!.find(item => item.sourceId === trace.response.evidenceMap![0].sourceId)!.fieldIds).toEqual([]);
    expect(context.evidenceMap!.find(item => item.sourceId === source.id)!.fieldIds).toContain(supported.id);
    expect(intakeReadiness(context).fields.find(field => field.id === 2)).toMatchObject({ status: 'unknown', sourceIds: [] });
    const restoredAuthority = context.intakeAuthority!.find(item => item.fieldId === 2)!;
    expect(restoredAuthority.retainedSourceIds).toEqual([]);
    state = editField(state, session, 3, 'partial', 'Unrelated later manual edit');
    const afterUnrelatedEdit = buildContext(state, session.id);
    expect(afterUnrelatedEdit.intakeAuthority!.find(item => item.fieldId === 2)).toEqual(restoredAuthority);
    expect(afterUnrelatedEdit.evidenceMap!.find(item => item.sourceId === trace.response.evidenceMap![0].sourceId)!.fieldIds).toEqual([]);
    const stalePatch = { ...turn(afterUnrelatedEdit), fieldUpdates: [{ id: 2, value: 'Old non-retained claim', status: 'partial' as const, remaining: '', sourceIds: [trace.response.evidenceMap![0].sourceId] }] };
    expect(() => validateResult(stalePatch, 'turn', afterUnrelatedEdit, { requireEvidence: true })).toThrow('superseded_field_source');
    expect(() => applyTurn(state, session.id, get(state, session).revision, stalePatch)).toThrow('שקדם לעריכה');
    const authoritySnapshot = exportState(state);
    get(state, session).traces.push({ id: 'after-restoration-trace', at: afterUnrelatedEdit.asOf, context: afterUnrelatedEdit, response: turn(afterUnrelatedEdit), elapsedMs: 1, mode: 'live', model: 'fictional-model', prompt: 'Fictional authority fixture', promptVersion: 'fixture' });
    expect(importState(exportState(state))).toEqual(state);
    const changed = structuredClone(state); get(changed, session).traces.at(-1)!.context.intakeAuthority!.find(item => item.fieldId === 2)!.retainedSourceIds = [trace.response.evidenceMap![0].sourceId];
    expect(() => importState(exportState(changed))).toThrow('סמכות שדות האינטייק');
    expect(importState(authoritySnapshot)).toEqual(JSON.parse(authoritySnapshot));
  });

  it('rejects old-only AI patches after manual deletion and ignores injected pending claims for map authority', () => {
    let { state, session } = setup(); const original = appendEvidence(state, session, [6]); state = original.state;
    state = editField(state, session, 6, 'partial', 'Manual correction');
    state = editField(state, session, 6, 'unknown', '');
    const context = buildContext(state, session.id);
    const update = { id: 6, value: original.item.quote, status: 'documented' as const, sourceIds: [original.item.sourceId], remaining: '' };
    const response = { ...turn(context), fieldUpdates: [update], evidenceMap: [original.item] };
    expect(() => validateResult(response, 'turn', context, { requireEvidence: true })).toThrow('superseded_field_source');
    expect(() => applyTurn(state, session.id, get(state, session).revision, response)).toThrow('שקדם לעריכה');
    context.pendingIntakeFields = [update];
    expect(deriveEvidenceMap(state, context)[0].fieldIds).toEqual([]);
    expect(intakeReadiness(context).fields.find(field => field.id === 6)).toMatchObject({ status: 'unknown', value: '' });
    get(state, session).pendingFields = [update];
    expect(buildContext(state, session.id).pendingIntakeFields).toBeUndefined();
    expect(importState(exportState(state))).toEqual(state);
  });

  it('permits genuinely new clinician information after a manual correction', () => {
    let { state, session } = setup(); ({ state } = appendEvidence(state, session, [6]));
    state = editField(state, session, 6, 'unknown', '');
    ({ state } = appendEvidence(state, session, [6], 'A new fictional fact supplied after the manual change.'));
    const context = buildContext(state, session.id); const source = context.sources.at(-1)!;
    const response = { ...turn(context), fieldUpdates: [{ id: 6, value: source.text, status: 'partial' as const, sourceIds: [source.id], remaining: '' }] };
    expect(validateResult(response, 'turn', context, { requireEvidence: true })).toEqual(response);
    state = applyTurn(state, session.id, get(state, session).revision, response);
    expect(intakeReadiness(buildContext(state, session.id)).fields.find(field => field.id === 6)).toMatchObject({ status: 'partial', value: source.text });
    expect(buildContext(state, session.id).evidenceMap![0].fieldIds).toEqual([6]);
  });

  it('excludes future trace interpretations even when their source existed before a fork', () => {
    let { state, session } = setup(); ({ state } = appendEvidence(state, session, [6], 'Before the fictional fork.'));
    const oldSource = state.sources.at(-1)!;
    vi.advanceTimersByTime(100); const forked = forkBranch(state, session.id, 'Alternative fictional sequence'); state = forked.state;
    vi.advanceTimersByTime(100); const later = createSession(state, session.patientId, session.branchId, 5); state = later.state;
    ({ state } = appendEvidence(state, later.session, [8], 'Future branch-specific fact.'));
    const laterTrace = get(state, later.session).traces.at(-1)!;
    laterTrace.response.evidenceMap!.push(entry(laterTrace.context, [9], oldSource.id));
    const child = createSession(state, session.patientId, forked.branch.id, 5); state = child.state;
    const scoped = buildContext(state, child.session.id);
    expect(scoped.evidenceMap).toHaveLength(1); expect(scoped.evidenceMap![0].fieldIds).toEqual([6]);
    expect(buildContext(state, session.id).evidenceMap).toHaveLength(1);
    const other = createPatient(state, { name: 'Another fictional case' }); state = other.state;
    ({ state } = appendEvidence(state, other.session, [11], 'Other fictional patient.'));
    expect(deriveEvidenceMap(state, scoped)).toEqual(scoped.evidenceMap);
    expect(importState(exportState(state))).toEqual(state);
  });

  it.skipIf(!existsSync('.local/Compatibility_2026-10-18/fictional-snapshot.json'))('imports the frozen pre-mapping fictional archive without adding or rewriting properties', () => {
    const raw = readFileSync('.local/Compatibility_2026-10-18/fictional-snapshot.json', 'utf8');
    expect(importState(raw)).toEqual(JSON.parse(raw));
  });
});

describe('evidence-aware intake ranking', () => {
  it('ranks selected, latest partial, previous mapped, other gaps and lower priority in order', () => {
    let { state, session } = setup(); ({ state } = appendEvidence(state, session, [20]));
    ({ state } = appendEvidence(state, session, [22], 'Latest artificial report.'));
    const context = buildContext(state, session.id);
    context.pendingIntakeFields = [{ id: 22, value: 'Known part', status: 'partial', sourceIds: [context.sources.at(-1)!.id] }];
    context.focusGoal = 'intake'; context.focusSelection = intakeCompletionFocus(29);
    context.preferences.push({ id: 'less', topic: 'עבודה', scope: 'session', action: 'less' });
    const readiness = intakeReadiness(context);
    expect(readiness.gaps.slice(0, 4).map(gap => gap.field.id)).toEqual([29, 22, 20, 1]);
    expect(readiness.gaps[1].relevanceReason).toBe('עלה בשיתוף האחרון');
    expect(readiness.gaps[2].relevanceReason).toBe('נמצא מידע קודם לעיון');
    expect(readiness.gaps.at(-1)?.field.id).toBe(16);
    expect(readiness.gaps.find(gap => gap.field.id === 20)?.field.status).toBe('unknown');
  });

  it('never elevates blocked, skipped or not-recalled fields and hides excluded fields', () => {
    let { state, session } = setup(); ({ state } = appendEvidence(state, session, [11, 13, 22, 29]));
    ({ state } = appendEvidence(state, session, []));
    const context = buildContext(state, session.id);
    context.preferences.push({ id: 'exclude', topic: 'תרופות', goal: 'intake', scope: 'session', action: 'exclude' }, { id: 'block', topic: 'משפחה', scope: 'session', action: 'block' });
    context.skippedTopics = ['סיכון']; context.focusGoal = 'intake'; context.focusSelection = intakeCompletionFocus(13);
    context.pendingIntakeFields = [{ id: 29, value: '', status: 'not_recalled', sourceIds: [context.sources.at(-1)!.id] }];
    const readiness = intakeReadiness(context);
    expect(readiness.gaps[0].field.id).toBe(1); expect(readiness.gaps.some(gap => gap.field.id === 11)).toBe(false);
    for (const id of [13, 22, 29]) {
      const gap = readiness.gaps.find(gap => gap.field.id === id)!;
      expect(gap.canDiscuss).toBe(false); expect(gap.relevanceReason).toBeUndefined();
    }
  });

  it('uses current and pending known fields and ignores stale drafts regardless of missing map entries', () => {
    let { state, session } = setup(); state = editField(state, session, 6, 'documented', 'Known fictional fact');
    vi.advanceTimersByTime(10); state = addUserMessage(state, session.id, 'New fictional facts supplied after the manual record.');
    const context = buildContext(state, session.id);
    context.pendingIntakeFields = [{ id: 8, value: 'Pending fact', status: 'documented', sourceIds: [context.sources.at(-1)!.id] }];
    const readiness = intakeReadiness(context);
    expect(readiness.gaps.some(gap => [6, 8].includes(gap.field.id))).toBe(false);
    expect(readiness.fields.filter(field => [6, 8].includes(field.id)).every(field => field.status === 'documented')).toBe(true);
    context.pendingIntakeFields = emptyIntakeFields().map(field => ({ ...field, value: 'Synthetic complete field', status: 'documented', sourceIds: [context.sources.at(-1)!.id] }));
    expect(intakeReadiness(context).gaps).toEqual([]);
  });
});

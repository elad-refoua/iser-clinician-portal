import { describe, expect, it } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { preparedDraft } from '../fixtures/fictional/prepared';
import type { IntakeField } from '../packages/contracts';
import { addUserMessage, buildContext, compactModelContext, createSession, exportState, importState } from '../packages/domain';
import { intakeFields, intakeSections } from '../packages/prompts/intake-schema';

const compactMarker = 'פרטי האינטייק המלאים, מצבם ומקורותיהם מופיעים בשדות המובנים בחבילת ההקשר.';
const prefix = 'הערת מטפל עצמאית: מצב: לא נמסר מידע נשאר כאן במילותיו.\n\n';
// Frozen pre-2026-10-18 report layout, independent of the current renderer/status labels.
function legacyReport(fields: IntakeField[], excludedMedication = false): string {
  const labels = { documented: 'תועד', partial: 'תועד חלקית', unknown: 'לא הוזכר', not_assessed: 'לא נבדק', not_recalled: 'לא זכור', conflict: 'קיימת סתירה', not_applicable: 'לא רלוונטי' };
  return intakeSections.map(section => `## ${section.title}\n\n${section.fieldIds.map(id => {
    const field = fields.find(item => item.id === id);
    const excluded = excludedMedication && id === 11;
    const value = excluded ? 'תוכן השדה הוחרג מתוצר זה לבקשת המטפל.' : field?.value.trim() || 'לא נמסר מידע בשדה זה.';
    const remaining = excluded ? '' : field?.remaining?.trim();
    return `### ${id}. ${intakeFields.find(item => item.id === id)!.label}\nמצב: ${labels[field?.status ?? 'unknown']}\n${value}${remaining ? `\nלהשלמה: ${remaining}` : ''}`;
  }).join('\n\n')}`).join('\n\n');
}

function historicalTrace(excludedMedication = false) {
  const seed = createDemoState();
  const patient = seed.patients[0];
  const branch = seed.branches.find(item => item.patientId === patient.id)!;
  const created = createSession(seed, patient.id, branch.id, 5);
  const state = addUserMessage(created.state, created.session.id, 'מקור בדיוני לבדיקת תאימות בלבד.');
  if (excludedMedication) state.preferences.push({ id: 'legacy-medication-exclusion', patientId: patient.id, branchId: branch.id, sessionId: created.session.id, scope: 'session', goal: 'intake', action: 'exclude', topic: 'טיפול תרופתי', recordedAt: created.session.startedAt });
  let context = buildContext(state, created.session.id, 'draft');
  const versionId = context.documents.find(document => document.kind === 'intake')!.versionId;
  const version = state.versions.find(item => item.id === versionId)!;
  version.content = prefix + legacyReport(version.fields!, excludedMedication);
  context = buildContext(state, created.session.id, 'draft');
  const intake = context.documents.find(document => document.kind === 'intake')!;
  // This is the actual old compacted trace format, not the current compaction result.
  intake.content = prefix + compactMarker;
  const session = state.sessions.find(item => item.id === created.session.id)!;
  session.traces.push({ id: 'historical-compacted-trace', at: context.asOf, mode: 'live', model: 'anthropic/claude-sonnet-5.5', promptVersion: '2026-10-16.13', prompt: 'Historical fictional prompt', context, response: preparedDraft(context), elapsedMs: 1 });
  return { state, session, version, context };
}

describe('legacy intake report compatibility', () => {
  it.each([false, true])('round-trips historical compacted traces without rewriting history (excluded medication: %s)', excluded => {
    const { state, version } = historicalTrace(excluded);
    expect(version.content).toContain('מצב: לא הוזכר');
    if (excluded) expect(version.content).toContain('תוכן השדה הוחרג מתוצר זה לבקשת המטפל.');
    const before = exportState(state);
    expect(importState(before)).toEqual(state);
    expect(exportState(state)).toBe(before);
  });

  it.each([false, true])('compacts the exact legacy suffix while retaining clinician prefixes and all fields (excluded medication: %s)', excluded => {
    const { state, session, version } = historicalTrace(excluded);
    const context = buildContext(state, session.id, 'draft');
    context.workingDraft = preparedDraft(context);
    context.workingDraft.documents.find(document => document.kind === 'intake')!.content = version.content;
    const before = structuredClone(context);
    const compact = compactModelContext(context);
    expect(compact.documents.find(document => document.kind === 'intake')!.content).toBe(prefix + compactMarker);
    expect(compact.workingDraft!.documents.find(document => document.kind === 'intake')!.content).toBe(prefix + compactMarker);
    expect(compact.documents.find(document => document.kind === 'intake')!.fields).toEqual(version.fields);
    expect(context).toEqual(before);
  });

  it('retains custom prose after the old rendering and rejects pretending that it was compacted away', () => {
    const { state, session, version, context } = historicalTrace();
    version.content += '\nתוספת עצמאית של המטפל שלא נכללת בשדות.';
    const raw = buildContext(state, session.id, 'draft');
    expect(compactModelContext(raw).documents.find(document => document.kind === 'intake')!.content).toBe(version.content);
    expect(() => importState(exportState(state))).toThrow('רישום הפעולה');
    context.documents.find(document => document.kind === 'intake')!.content = version.content;
    expect(importState(exportState(state))).toEqual(state);
  });

  it('does not normalize status-looking text inside a clinician field value', () => {
    const { state, session, version } = historicalTrace();
    version.fields!.find(field => field.id === 5)!.value += '\nמצב: לא נמסר מידע הוא ציטוט בדיוני שנשמר כפי שנכתב.';
    version.content = prefix + legacyReport(version.fields!);
    const context = buildContext(state, session.id, 'draft');
    const compact = compactModelContext(context);
    expect(compact.documents.find(document => document.kind === 'intake')!.content).toBe(prefix + compactMarker);
    expect(compact.documents.find(document => document.kind === 'intake')!.fields!.find(field => field.id === 5)!.value).toContain('מצב: לא נמסר מידע הוא ציטוט');
  });

  it.each(['trace-content', 'trace-fields', 'stored-format'] as const)('still rejects tampering in %s', target => {
    const { state, version, context } = historicalTrace(true);
    const intake = context.documents.find(document => document.kind === 'intake')!;
    if (target === 'trace-content') intake.content = 'הקדמה שלא נשמרה\n' + intake.content;
    if (target === 'trace-fields') intake.fields![0].value += 'טקסט שלא נשמר';
    if (target === 'stored-format') version.content = version.content.replace('מצב: לא הוזכר', 'מצב: לא נמסר מידע');
    expect(() => importState(exportState(state))).toThrow('רישום הפעולה');
  });
});

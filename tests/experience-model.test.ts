import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { addUserMessage, buildContext, createPatient, createSession, editDocument } from '../packages/domain';
import type { Trace } from '../packages/contracts';
import { caseOverview, citedSourceIds, documentExcerpt, traceOrigin } from '../apps/web/experience-model';

afterEach(() => vi.useRealTimers());

describe('case welcome evidence', () => {
  it('describes actual past records and does not count an empty upcoming session as a meeting with content', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
    const state = createSession(createDemoState(), 'fictional-tamar', 'fictional-tamar-main', 5).state;
    const overview = caseOverview(state, 'fictional-tamar')!;
    expect(overview.timeline.map(item => item.session.number)).toEqual([1, 2, 3, 4]);
    expect(overview.timeline[3].excerpt).toContain('השאירה את המחשב סגור');
    expect(overview.timeline.every(item => item.note?.sourceIds.every(id => overview.context?.sources.some(source => source.id === id)))).toBe(true);
    expect(overview.hasOpenSession).toBe(true);
    expect(overview.nextNumber).toBe(5);
    expect(overview.materials.find(item => item.kind === 'note')?.present).toBe(true);
  });

  it('does not invent clinical history or materials from the administrative source of a new record', () => {
    const created = createPatient(createDemoState(), { name: 'בדיקת תצוגה', schedule: { dayOfWeek: 1, time: '17:30' } });
    const overview = caseOverview(created.state, created.patient.id)!;
    expect(overview.timeline).toEqual([]);
    expect(overview.materials.every(item => !item.present)).toBe(true);
    expect(overview.patient.description).toBe('');
    expect(overview.nextNumber).toBe(1);
    expect(overview.documentedFields).toBe(0);
    expect(overview.partialFields).toBe(0);
  });

  it('does not present placeholder documents without linked material as populated', () => {
    const state = createDemoState();
    state.sessions = state.sessions.filter(item => item.patientId !== 'fictional-tamar' || item.number === 1);
    const overview = caseOverview(state, 'fictional-tamar')!;
    expect(overview.materials.filter(item => item.present).map(item => item.kind)).toEqual(['note', 'intake']);
    expect(overview.nextNumber).toBe(2);
    expect(overview.hasOpenSession).toBe(false);
  });

  it('does not include later material in the preview of a closed latest session', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
    const state = createDemoState();
    const latest = state.sessions.find(item => item.id === 'fictional-tamar-session-4')!;
    latest.closedAt = latest.startedAt;
    state.sources.push({ id: 'future-only', patientId: latest.patientId, branchId: latest.branchId, kind: 'manual', text: 'אסור שיופיע בסקירה הסגורה', recordedAt: '2026-10-16T09:00:00Z' });
    state.versions.push({ id: 'future-version', patientId: latest.patientId, branchId: latest.branchId, kind: 'formulation', content: 'אסור שיופיע בסקירה הסגורה', sourceIds: ['future-only'], createdAt: '2026-10-16T09:00:00Z', author: 'clinician', reason: 'בדיקה', approved: false });
    const overview = caseOverview(state, latest.patientId)!;
    expect(JSON.stringify(overview.context)).not.toContain('אסור שיופיע');
    expect(JSON.stringify(overview.materials)).not.toContain('אסור שיופיע');
  });

  it('keeps separate patients out and recognizes newly saved content', () => {
    const created = createPatient(createDemoState(), { name: 'בדיקת תצוגה שנייה' });
    let state = addUserMessage(created.state, created.session.id, 'דיווח בדיוני ראשון לפגישה.');
    state = editDocument(state, created.patient.id, created.branch.id, 'note', 'רשומה בדיונית חדשה.', undefined, created.session.id);
    const overview = caseOverview(state, created.patient.id)!;
    expect(overview.timeline).toHaveLength(1);
    expect(overview.timeline[0].excerpt).toBe('רשומה בדיונית חדשה.');
    expect(overview.context?.sources.every(source => source.patientId === created.patient.id)).toBe(true);
  });
});

describe('response explanation provenance', () => {
  function trace(): Trace {
    return { id: 'trace', at: '2026-10-16T10:00:00Z', mode: 'live', model: 'anthropic/claude-sonnet-5.5', prompt: 'בדיקה', promptVersion: 'test', elapsedMs: 100,
      context: buildContext(createDemoState(), 'fictional-tamar-session-4'),
      response: { action: 'question', utterance: 'כתבת על מחשב סגור. מה תואר ברגע הזה?', topic: 'רגע בפגישה', rationale: 'הסבר אינו מקור', fieldUpdates: [], preferenceUpdates: [] } };
  }

  it('never labels server policy or a historical prepared trace as a real model response', () => {
    expect(traceOrigin(trace())).toMatchObject({ kind: 'model', sent: true });
    expect(traceOrigin({ ...trace(), model: 'server-policy' })).toMatchObject({ kind: 'policy', sent: false });
    expect(traceOrigin({ ...trace(), mode: 'prepared' })).toMatchObject({ kind: 'prepared', sent: false });
  });

  it('lists only explicit output source references, not all context or rationale as citations', () => {
    const turn = trace();
    expect(turn.context.sources.length).toBeGreaterThan(0);
    expect(citedSourceIds(turn)).toEqual([]);
    turn.response.fieldUpdates = [{ id: 1, status: 'partial', value: 'ערך בדיוני', sourceIds: ['one', 'two'], remaining: '' }];
    expect(citedSourceIds(turn)).toEqual(['one', 'two']);
    turn.response = { rationale: 'הסבר', documents: [{ kind: 'note', content: 'טיוטה', sourceIds: ['two', 'three'] }], fieldUpdates: turn.response.fieldUpdates };
    expect(citedSourceIds(turn)).toEqual(['one', 'two', 'three']);
  });

  it('uses an excerpt of supplied prose without rewriting it into a model-generated summary', () => {
    expect(documentExcerpt('# כותרת\n\nמשפט שנכתב במקור.\nמקור: רשומת הדגמה')).toBe('משפט שנכתב במקור.');
    expect(documentExcerpt('טקסט ארוך שנשמר במקור לצורך התצוגה', 15)).toBe('טקסט ארוך שנשמר…');
  });
});

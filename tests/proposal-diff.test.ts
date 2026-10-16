import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { diffDocument, changedIntakeFieldIds, proposalDestinations, proposalSummary } from '../apps/web/proposal-diff';
import { DocumentDiff, DocumentText } from '../apps/web/ui';
import ReviewProposal from '../apps/web/ReviewProposal';
import { GOAL_LABELS, type DocumentVersion, type Goal, type IntakeField, type PendingDraft } from '../packages/contracts';
import { createDemoState } from '../fixtures/fictional';
import { preparedDraft } from '../fixtures/fictional/prepared';
import { addUserMessage, buildContext, createPatient, createSession, editDocument, intakeFields, saveDraft } from '../packages/domain';

function expectReconstruction(before: string, after: string) {
  const diff = diffDocument(before, after);
  expect(diff.blocks.map(block => block.before).join('')).toBe(before);
  expect(diff.blocks.map(block => block.after).join('')).toBe(after);
  for (const block of diff.blocks) {
    expect(block.parts.filter(part => part.kind !== 'added').map(part => part.text).join('')).toBe(block.before);
    expect(block.parts.filter(part => part.kind !== 'removed').map(part => part.text).join('')).toBe(block.after);
  }
  return diff;
}

describe('document changes are exact and deterministic', () => {
  it('preserves unchanged Hebrew, Markdown, punctuation and line endings', () => {
    const text = '# סיכום\r\n\r\nנכתב **טקסט** לבדיקה בלבד.\n';
    expect(expectReconstruction(text, text)).toMatchObject({ changed: false, addedLines: 0, removedLines: 0, replacements: 0 });
  });

  it('identifies an insertion without marking surrounding text as replaced', () => {
    const diff = expectReconstruction('ראשון\nאחרון', 'ראשון\nנוסף\nאחרון');
    expect(diff.blocks.map(block => block.kind)).toEqual(['unchanged', 'added', 'unchanged']);
    expect(diff.addedLines).toBe(1); expect(diff.removedLines).toBe(0);
  });

  it('identifies a removal without inventing replacement content', () => {
    const diff = expectReconstruction('ראשון\nיוסר\nאחרון', 'ראשון\nאחרון');
    expect(diff.blocks.map(block => block.kind)).toEqual(['unchanged', 'removed', 'unchanged']);
    expect(diff.removedLines).toBe(1); expect(diff.addedLines).toBe(0);
  });

  it('isolates a Hebrew word replacement inside its unchanged sentence', () => {
    const diff = expectReconstruction('הטקסט הקודם נשמר.', 'הטקסט החדש נשמר.');
    expect(diff.blocks[0].kind).toBe('replaced');
    expect(diff.blocks[0].parts).toEqual([{ kind: 'equal', text: 'הטקסט ' }, { kind: 'removed', text: 'הקודם' }, { kind: 'added', text: 'החדש' }, { kind: 'equal', text: ' נשמר.' }]);
  });

  it('preserves combining marks, mixed Hebrew/English and missing final newline', () => {
    expectReconstruction('שָׁלוֹם — CBT 3\nסוף', 'שָׁלוֹם — CBT 4\nסוף\n');
    expectReconstruction('', 'מסמך חדש');
    expectReconstruction('מסמך שיוסר', '');
    expectReconstruction('', '');
  });

  it('handles repeated and reordered paragraphs without losing text', () => {
    expectReconstruction('כותרת\nחוזר\nישן\nחוזר\nסוף', 'כותרת\nחוזר\nחוזר\nחדש\nסוף');
  });

  it('bounds work on large wholly changed documents and preserves both complete texts', () => {
    const before = 'כותרת\n' + Array.from({ length: 950 }, (_, index) => `קודם ${index}\n`).join('') + 'סוף';
    const after = 'כותרת\n' + Array.from({ length: 950 }, (_, index) => `מוצע ${index}\n`).join('') + 'סוף';
    const diff = expectReconstruction(before, after);
    expect(diff.blocks.map(block => block.kind)).toEqual(['unchanged', 'replaced', 'unchanged']);
    expect(diff.addedLines).toBe(950);
  });
});

describe('proposal comparison keeps its original baseline', () => {
  const version = (id: string, content: string): DocumentVersion => ({ id, patientId: 'fictional', branchId: 'branch', kind: 'note', content, sourceIds: ['source'], createdAt: '2026-10-16T12:00:00.000Z', author: 'clinician', reason: 'artificial fixture', approved: true });
  const pending = (): PendingDraft => ({ id: 'draft', createdAt: '2026-10-16T12:00:00.000Z', reviewRevision: 1, baseVersionIds: { note: 'base' }, fields: [], result: { rationale: 'artificial test', documents: [{ kind: 'note', content: 'proposed', sourceIds: ['source'] }], fieldUpdates: [] } });

  it('selects the explicit base ID even when a newer version exists', () => {
    const result = proposalDestinations(pending(), [version('base', 'original'), version('newer', 'concurrent edit')])[0];
    expect(result.base?.content).toBe('original'); expect(result.status).toBe('updated');
  });

  it('does not call a missing original version a new document', () => {
    const result = proposalDestinations(pending(), [version('newer', 'concurrent edit')])[0];
    expect(result.baseMissing).toBe(true); expect(result.status).toBe('unavailable');
  });

  it('distinguishes a new document, unchanged text and source-only updates', () => {
    const fresh = pending(); fresh.baseVersionIds = {};
    expect(proposalDestinations(fresh, [])[0].status).toBe('new');
    const same = pending(); same.result.documents[0].content = 'original';
    expect(proposalDestinations(same, [version('base', 'original')])[0].status).toBe('unchanged');
    same.result.documents[0].sourceIds.push('additional-source');
    expect(proposalDestinations(same, [version('base', 'original')])[0]).toMatchObject({ status: 'updated', textChanged: false, sourcesChanged: true });
  });

  it('compares intake content/status/open items and ignores source ordering', () => {
    const field: IntakeField = { id: 5, value: 'טקסט מלאכותי', status: 'partial', remaining: 'להשלמה', sourceIds: ['a', 'b'] };
    expect(changedIntakeFieldIds([field], [{ ...field, sourceIds: ['b', 'a'] }])).toEqual([]);
    for (const change of [{ value: 'טקסט אחר' }, { status: 'documented' as const }, { remaining: '' }, { sourceIds: ['a'] }]) expect(changedIntakeFieldIds([field], [{ ...field, ...change }])).toEqual([5]);
  });
});

describe('the visible summary describes actual saved-baseline changes', () => {
  const goals: Goal[] = ['note', 'intake', 'formulation', 'supervision', 'gold'];
  const field: IntakeField = { id: 6, value: 'Fictional known information', status: 'partial', remaining: 'Timing', sourceIds: ['source'] };
  const pending = (): PendingDraft => ({ id: 'draft', createdAt: '2026-10-16T12:00:00.000Z', reviewRevision: 1, baseVersionIds: {}, fields: [structuredClone(field)],
    result: { summary: 'MODEL CLAIM: other documents did not change.', rationale: 'Artificial test', fieldUpdates: [],
      documents: goals.map(kind => ({ kind, content: `Fictional ${kind}`, sourceIds: ['source'] })) } });
  const saved = (proposal: PendingDraft): DocumentVersion[] => proposal.result.documents.map(document => ({ ...structuredClone(document),
    id: `base-${document.kind}`, patientId: 'fictional', branchId: 'branch', createdAt: '2026-10-16T11:00:00.000Z', author: 'clinician', approved: true, reason: 'Artificial test',
    ...(document.kind === 'intake' ? { fields: structuredClone(proposal.fields) } : {}) }));
  function withBases() {
    const proposal = pending(); const versions = saved(proposal);
    proposal.baseVersionIds = Object.fromEntries(versions.map(version => [version.kind, version.id]));
    return { proposal, versions };
  }
  const summarize = (proposal: PendingDraft, versions: DocumentVersion[]) => proposalSummary(proposalDestinations(proposal, versions), 5, intakeFields);

  it('calls all proposed documents new when no saved baseline exists, regardless of the model summary', () => {
    const text = summarize(pending(), []);
    expect(text).toContain('רשומה חדשה לפגישה 5');
    expect(text).toContain('מסמכים חדשים בתיק: אינטייק, המשגה, לקראת הדרכה וחומרי למידה');
    expect(text).not.toContain('ללא שינוי');
    expect(text).not.toContain('MODEL CLAIM');
    expect(text).not.toContain('שינוי בשדות');
  });

  it('describes unchanged documents without claiming additions or updates', () => {
    const { proposal, versions } = withBases();
    const text = summarize(proposal, versions);
    expect(text).toContain('רשומת פגישה 5 נשארת ללא שינוי');
    expect(text).toContain('ללא שינוי בתיק: אינטייק, המשגה, לקראת הדרכה וחומרי למידה');
    expect(text).not.toContain('חדשה'); expect(text).not.toContain('חדשים'); expect(text).not.toContain('עדכונים מוצעים');
  });

  it('reports unavailable baseline comparison without calling the document new or inventing field changes', () => {
    const { proposal, versions } = withBases();
    const text = summarize(proposal, versions.filter(version => version.kind !== 'intake'));
    expect(text).toContain('גרסת הבסיס אינה זמינה עבור אינטייק');
    expect(text).toContain('אי אפשר לקבוע מה השתנה');
    expect(text).not.toContain('מסמכים חדשים'); expect(text).not.toContain('שינוי בשדות');
  });

  it('names a structured field-only update even when the rendered document and sources are unchanged', () => {
    const { proposal, versions } = withBases();
    proposal.fields[0] = { ...proposal.fields[0], status: 'documented', remaining: '' };
    const destinations = proposalDestinations(proposal, versions);
    expect(destinations.find(item => item.goal === 'intake')).toMatchObject({ status: 'updated', textChanged: false, sourcesChanged: false, fieldIds: [6] });
    const text = proposalSummary(destinations, 5, intakeFields);
    expect(text).toContain('עדכונים מוצעים בתיק: אינטייק');
    expect(text).toContain(`באינטייק מוצע שינוי בשדות: ${intakeFields.find(item => item.id === 6)!.label}`);
    expect(text).not.toContain('מקורות בלבד');
  });

  it('distinguishes source-only changes from changes to the document wording', () => {
    const { proposal, versions } = withBases();
    proposal.result.documents.find(document => document.kind === 'gold')!.sourceIds.push('new-source');
    const text = summarize(proposal, versions);
    expect(text).toContain(`עדכון מקורות בלבד, ללא שינוי בנוסח: ${GOAL_LABELS.gold}`);
    expect(text).not.toContain('עדכונים מוצעים בתיק');
  });

  it('keeps a broad intake update compact while counting remaining changed fields exactly', () => {
    const { proposal, versions } = withBases();
    const ids = [5, 6, 7, 8, 9];
    versions.find(version => version.kind === 'intake')!.fields = ids.map(id => ({ ...field, id }));
    proposal.fields = ids.map(id => ({ ...field, id, status: 'documented' }));
    const text = summarize(proposal, versions);
    for (const id of ids.slice(0, 3)) expect(text).toContain(intakeFields.find(item => item.id === id)!.label);
    expect(text).toContain('ועוד 2 שדות');
  });
});

describe('accessible proposal rendering', () => {
  it('preserves three document heading levels and inline emphasis', () => {
    const html = renderToStaticMarkup(createElement(DocumentText, { text: '# Main **heading**\n## Section **heading**\n### Detail **heading**\nBody **emphasis**.' }));
    expect(html).toMatch(/<h3\b[^>]*>Main <strong>heading<\/strong><\/h3>/);
    expect(html).toMatch(/<h4\b[^>]*>Section <strong>heading<\/strong><\/h4>/);
    expect(html).toMatch(/<h5\b[^>]*>Detail <strong>heading<\/strong><\/h5>/);
    expect(html).toContain('<p>Body <strong>emphasis</strong>.</p>');
  });

  it('shows the computed overview while retaining model-generated documents and the raw diagnostic summary', () => {
    const opened = createPatient(createDemoState(), { name: 'Artificial summary review' });
    let state = addUserMessage(opened.state, opened.session.id, 'Fictional review input.');
    const context = buildContext(state, opened.session.id, 'draft');
    const result = preparedDraft(context);
    result.summary = 'MODEL SUMMARY CONTRADICTION: the other three documents did not change.';
    result.documents.find(document => document.kind === 'formulation')!.content = 'MODEL_DOCUMENT_CONTENT_PRESERVED';
    state = saveDraft(state, opened.session.id, context.baseRevision, result);
    const session = state.sessions.find(item => item.id === opened.session.id)!;
    const html = renderToStaticMarkup(createElement(ReviewProposal, { state, session, pending: session.pendingDraft!, busy: false, onApprove() {}, onExpand() {}, onRevise() {}, onExplain() {} }));
    expect(html).toContain('רשומה חדשה לפגישה 1');
    expect(html).toContain('מסמכים חדשים בתיק: אינטייק, המשגה, לקראת הדרכה וחומרי למידה');
    expect(html).not.toContain('MODEL SUMMARY CONTRADICTION');
    expect(html).toContain('MODEL_DOCUMENT_CONTENT_PRESERVED');
    expect(session.pendingDraft!.result.summary).toBe(result.summary);
  });

  it.each([
    ['', ' \t\n'],
    ['\n\n', '\n'],
    ['first\nlast', 'first\n\nlast'],
  ])('labels a spacing-only edit explicitly: %j to %j', (before, after) => {
    const html = renderToStaticMarkup(createElement(DocumentDiff, { before, after }));
    expect(html).toContain('שינוי בריווח');
    expect(html).toContain('ריווח בלבד');
    expect(html).toContain('לפני השינוי');
    expect(html).toContain('אחרי השינוי');
    expect(html).not.toContain('עדיין אין תוכן במסמך הזה');
    expectReconstruction(before, after);
  });

  it('shows a text-to-spacing replacement without an empty-document fallback', () => {
    const html = renderToStaticMarkup(createElement(DocumentDiff, { before: 'טקסט שיוסר\n', after: '\n' }));
    expect(html).toContain('טקסט שיוסר'); expect(html).toContain('ריווח בלבד');
    expect(html).not.toContain('עדיין אין תוכן במסמך הזה');
  });

  it('renders removals when valid proposed note and cumulative document contents are empty', () => {
    const fixture = createDemoState(); const patient = fixture.patients[0]; const branch = fixture.branches.find(item => item.patientId === patient.id)!;
    const created = createSession(fixture, patient.id, branch.id, 5);
    let state = editDocument(created.state, patient.id, branch.id, 'note', 'NOTE_TO_REMOVE', undefined, created.session.id);
    state = editDocument(state, patient.id, branch.id, 'formulation', 'FORMULATION_TO_REMOVE');
    const context = buildContext(state, created.session.id, 'draft');
    const result = preparedDraft(context);
    for (const document of result.documents) if (document.kind === 'note' || document.kind === 'formulation') document.content = '';
    state = saveDraft(state, created.session.id, context.baseRevision, result);
    const session = state.sessions.find(item => item.id === created.session.id)!;
    const html = renderToStaticMarkup(createElement(ReviewProposal, { state, session, pending: session.pendingDraft!, busy: false, onApprove: () => {}, onExpand: () => {}, onRevise: () => {}, onExplain: () => {} }));
    expect(html).toContain('הסרה מוצעת');
    expect(html).toMatch(/<del class="document-diff-whole"><div class="document-text"><p>NOTE_TO_REMOVE/);
    expect(html).toMatch(/<del class="document-diff-whole"><div class="document-text"><p>FORMULATION_TO_REMOVE/);
    expect(html).toContain('ההצעה משאירה את המסמך ללא טקסט');
    expect(html).not.toContain('לא הוחזרה רשומה לשמירה');
    expect(html).not.toMatch(/class="primary" disabled=""/);
  });

  it('renders semantic additions/removals and visible change labels', () => {
    const html = renderToStaticMarkup(createElement(DocumentDiff, { before: 'הטקסט הקודם נשמר.', after: 'הטקסט החדש נשמר.' }));
    expect(html).toContain('החלפת נוסח'); expect(html).toContain('<del>'); expect(html).toContain('<ins>');
    expect(html).toContain('נוסח שמוצע להסיר'); expect(html).toContain('נוסח שמוצע להוסיף');
  });

  it('preserves Markdown emphasis and does not turn blank spacing into missing-content notices', () => {
    const html = renderToStaticMarkup(createElement(DocumentDiff, { before: '# כותרת\n\nטקסט **קודם**.', after: '# כותרת\n\nטקסט **חדש**.' }));
    expect(html).toContain('<strong>קודם</strong>'); expect(html).toContain('<strong>חדש</strong>');
    expect(html).not.toContain('עדיין אין תוכן במסמך הזה');
    expect(html).not.toContain('**');
  });

  it('does not claim intake fields changed when the saved baseline is unavailable', () => {
    const fixture = createDemoState(); const patient = fixture.patients[0]; const branch = fixture.branches.find(item => item.patientId === patient.id)!;
    const created = createSession(fixture, patient.id, branch.id, 5);
    const context = buildContext(created.state, created.session.id, 'draft');
    let state = saveDraft(created.state, created.session.id, context.baseRevision, preparedDraft(context));
    const session = state.sessions.find(item => item.id === created.session.id)!;
    const pending = session.pendingDraft!;
    expect(pending.baseVersionIds.intake).toBeDefined();
    state = { ...state, versions: state.versions.filter(version => version.id !== pending.baseVersionIds.intake) };
    const html = renderToStaticMarkup(createElement(ReviewProposal, { state, session, pending, busy: false, onApprove() {}, onExpand() {}, onRevise() {}, onExplain() {} }));
    expect(html).toContain('גרסת הבסיס אינה זמינה עבור אינטייק');
    expect(html).toContain('אי אפשר לסמן השוואה מדויקת');
    expect(html).not.toContain('review-field-changes');
    expect(html).toMatch(/class="primary" disabled=""/);
  });

  it('keeps stale approval disabled and displays the original baseline, not concurrent edits', () => {
    const fixture = createDemoState(); const patient = fixture.patients[0]; const branch = fixture.branches.find(item => item.patientId === patient.id)!;
    const created = createSession(fixture, patient.id, branch.id, 5);
    let state = addUserMessage(created.state, created.session.id, 'טקסט בדיקה מלאכותי.');
    state = editDocument(state, patient.id, branch.id, 'note', 'BASELINE_MARKER', undefined, created.session.id);
    const context = buildContext(state, created.session.id, 'draft');
    const result = preparedDraft(context); result.documents.find(item => item.kind === 'note')!.content = 'PROPOSED_MARKER'; result.summary = 'סיכום הצעה מלאכותי לבדיקה.';
    state = saveDraft(state, created.session.id, context.baseRevision, result);
    const pending = state.sessions.find(item => item.id === created.session.id)!.pendingDraft!;
    state = editDocument(state, patient.id, branch.id, 'note', 'CONCURRENT_MARKER', undefined, created.session.id);
    const session = state.sessions.find(item => item.id === created.session.id)!;
    const html = renderToStaticMarkup(createElement(ReviewProposal, { state, session, pending, busy: false, onApprove: () => {}, onExpand: () => {}, onRevise: () => {}, onExplain: () => {} }));
    expect(html).toContain('BASELINE_MARKER'); expect(html).toContain('PROPOSED_MARKER'); expect(html).not.toContain('CONCURRENT_MARKER');
    expect(html).toContain('צריך להכין סיכום מעודכן לפני האישור');
    expect(html).toMatch(/class="primary" disabled=""/);
    expect(html).not.toContain('סיכום הצעה מלאכותי לבדיקה.');
    expect(html).toContain('מוצע עדכון לרשומת פגישה 5');
  });
});

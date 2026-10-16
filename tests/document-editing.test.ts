import { createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDemoState } from '../fixtures/fictional';
import { TEXT_LIMITS } from '../packages/contracts';
import { currentVersion, editDocument, emptyIntakeFields, exportState, importState, restoreVersion } from '../packages/domain';
import { clearEditorDrafts, editorDrafts, hasUnsavedDocumentEdits, saveEditorDraft, writeEditorDraft } from '../apps/web/document-editing';
import { DocumentEditor } from '../apps/web/Documents';

const patientId = 'fictional-tamar';
const branchId = `${patientId}-main`;
const key = `${patientId}/${branchId}/formulation/`;
beforeEach(clearEditorDrafts);

describe('manual editor buffers and version protection', () => {
  it('retains the actual base while switching away and back, then appends a reloadable edit', () => {
    const state = createDemoState();
    const base = currentVersion(state, patientId, branchId, 'formulation')!;
    writeEditorDraft(key, { text: 'Fictional manually written text', fields: emptyIntakeFields(), baseVersionId: base.id });
    expect(hasUnsavedDocumentEdits()).toBe(true);
    expect(editorDrafts.get(key)?.baseVersionId).toBe(base.id);
    const saved = saveEditorDraft(state, key, patientId, branchId, 'formulation');
    expect(currentVersion(saved, patientId, branchId, 'formulation')).toMatchObject({ baseVersionId: base.id, content: 'Fictional manually written text' });
    expect(importState(exportState(saved)).versions).toHaveLength(state.versions.length + 1);
  });

  it('blocks a stale save after a restore and retains the unsaved buffer for recovery', () => {
    const state = createDemoState();
    const base = currentVersion(state, patientId, branchId, 'formulation')!;
    writeEditorDraft(key, { text: 'Uncommitted fictional edit', fields: emptyIntakeFields(), baseVersionId: base.id });
    const older = state.versions.find(version => version.patientId === patientId && version.kind === 'formulation' && version.id !== base.id)!;
    const restored = restoreVersion(state, older.id);
    expect(() => saveEditorDraft(restored, key, patientId, branchId, 'formulation')).toThrow('המסמך השתנה');
    expect(editorDrafts.get(key)?.text).toBe('Uncommitted fictional edit');
    expect(currentVersion(restored, patientId, branchId, 'formulation')?.content).toBe(older.content);
    const markup = renderToStaticMarkup(createElement(DocumentEditor, { state: restored, update: () => true, patientId, branchId, kind: 'formulation', notify: () => undefined }));
    expect(markup).toContain('נשמרה גרסה חדשה מאז תחילת העריכה');
    expect(markup).toMatch(/<button class="primary" disabled=""[^>]*>/);
    expect(markup).toContain('Uncommitted fictional edit');
  });

  it('treats an explicitly empty base as empty even when a version appears later', () => {
    const state = createDemoState();
    const empty = { ...state, versions: state.versions.filter(version => !(version.patientId === patientId && version.kind === 'gold')) };
    const emptyKey = `${patientId}/${branchId}/gold/`;
    writeEditorDraft(emptyKey, { text: 'Empty-base edit', fields: emptyIntakeFields(), baseVersionId: null });
    const changed = editDocument(empty, patientId, branchId, 'gold', 'New intervening version');
    expect(() => saveEditorDraft(changed, emptyKey, patientId, branchId, 'gold')).toThrow('המסמך השתנה');
    const markup = renderToStaticMarkup(createElement(DocumentEditor, { state: changed, update: () => true, patientId, branchId, kind: 'gold', notify: () => undefined }));
    expect(markup).toContain('נשמרה גרסה חדשה מאז תחילת העריכה');
  });

  it('keeps oversize content open instead of committing an archive that cannot reload', () => {
    const state = createDemoState();
    writeEditorDraft(key, { text: 'x'.repeat(TEXT_LIMITS.manualDocument + 1), fields: emptyIntakeFields(), baseVersionId: currentVersion(state, patientId, branchId, 'formulation')!.id });
    expect(() => saveEditorDraft(state, key, patientId, branchId, 'formulation')).toThrow('תווים בעריכה ישירה');
    expect(editorDrafts.get(key)?.text.length).toBe(TEXT_LIMITS.manualDocument + 1);
    expect(importState(exportState(state)).versions).toHaveLength(state.versions.length);
  });

  it('accepts the documented maximum while allowing room for the attributed source prefix', () => {
    const state = createDemoState();
    writeEditorDraft(key, { text: 'x'.repeat(TEXT_LIMITS.manualDocument), fields: emptyIntakeFields(), baseVersionId: currentVersion(state, patientId, branchId, 'formulation')!.id });
    const saved = saveEditorDraft(state, key, patientId, branchId, 'formulation');
    expect(saved.sources.at(-1)!.text.length).toBeLessThanOrEqual(TEXT_LIMITS.source);
    expect(importState(exportState(saved)).versions.at(-1)!.content.length).toBe(TEXT_LIMITS.manualDocument);
  });
});

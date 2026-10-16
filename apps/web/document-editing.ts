import type { Goal, IntakeField, PortalState } from '../../packages/contracts';
import { editDocument, renderIntake } from '../../packages/domain';

export interface EditorDraft { text: string; fields: IntakeField[]; baseVersionId: string | null }
/** Uncommitted buffers live only for the lifetime of this page. */
export const editorDrafts = new Map<string, EditorDraft>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function writeEditorDraft(key: string, draft: EditorDraft) { editorDrafts.set(key, draft); emit(); }
export function removeEditorDraft(key: string) { editorDrafts.delete(key); emit(); }
export function subscribeEditorDrafts(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getEditorDraftCount() { return editorDrafts.size; }
export function clearEditorDrafts() { editorDrafts.clear(); emit(); }
export function hasUnsavedDocumentEdits() { return editorDrafts.size > 0; }

/** Domain compare-and-swap protects against a version changing after the UI check. */
export function saveEditorDraft(state: PortalState, key: string, patientId: string, branchId: string, kind: Goal, sessionId?: string): PortalState {
  const draft = editorDrafts.get(key);
  if (!draft) throw new Error('העריכה אינה פתוחה עוד. יש לפתוח את המסמך מחדש.');
  return editDocument(state, patientId, branchId, kind, kind === 'intake' ? renderIntake(draft.fields) : draft.text,
    kind === 'intake' ? draft.fields : undefined, sessionId, draft.baseVersionId);
}

import type { ContextPacket, DraftFollowUp, IntakeField } from '../contracts';
import { emptyIntakeFields, intakeFields, intakeSections } from '../prompts/intake-schema.js';
import { intakeTopicMatches } from './intake-report.js';

export interface IntakeGap {
  field: IntakeField;
  label: string;
  section: string;
  canDiscuss: boolean;
  discussionReason?: string;
  lowerPriority: boolean;
}
export interface IntakeReadiness {
  visible: boolean;
  phase: 'early' | 'approaching' | 'due' | 'overdue';
  fields: IntakeField[];
  gaps: IntakeGap[];
  excludedCount: number;
  hasPendingInformation: boolean;
}

/** Reads only the already time/branch-scoped context; AI proposals are not approved records. */
export function intakeReadiness(context: ContextPacket): IntakeReadiness {
  const ids = new Set(context.sources.map(source => source.id));
  const fields = new Map(emptyIntakeFields().map(field => [field.id, field]));
  const apply = (updates: IntakeField[] | undefined) => {
    for (const field of updates ?? []) {
      if (fields.has(field.id) && field.sourceIds.every(id => ids.has(id))) fields.set(field.id, structuredClone(field));
    }
  };
  apply(context.documents.find(document => document.kind === 'intake')?.fields);
  const freshDraft = context.workingDraft && context.workingDraftMetadata?.stale === false;
  if (freshDraft) apply(context.workingDraft!.fieldUpdates);
  apply(context.pendingIntakeFields);
  const gaps: IntakeGap[] = [];
  let excludedCount = 0;
  for (const field of fields.values()) {
    if (context.preferences.some(preference => preference.action === 'exclude' && (!preference.goal || preference.goal === 'intake') && intakeTopicMatches(field, preference.topic))) {
      excludedCount++; continue;
    }
    if (field.status === 'documented' || field.status === 'not_applicable') continue;
    const blocked = context.preferences.some(preference => preference.action === 'block' && intakeTopicMatches(field, preference.topic));
    const skipped = context.skippedTopics.some(topic => intakeTopicMatches(field, topic));
    const notRecalled = field.status === 'not_recalled';
    gaps.push({ field, label: intakeFields.find(item => item.id === field.id)!.label,
      section: intakeSections.find(section => section.fieldIds.includes(field.id))!.title,
      canDiscuss: !blocked && !skipped && !notRecalled,
      ...(blocked ? { discussionReason: 'הנושא חסום לשאלות לפי ההעדפה שלך.' } : skipped ? { discussionReason: 'בחרת לדלג על הנושא בפגישה הזו.' } : notRecalled ? { discussionReason: 'הפרט סומן כלא זכור; לא נבקש אותו שוב.' } : {}),
      lowerPriority: context.preferences.some(preference => preference.action === 'less' && intakeTopicMatches(field, preference.topic)),
    });
  }
  gaps.sort((left, right) => Number(left.lowerPriority) - Number(right.lowerPriority) || left.field.id - right.field.id);
  return { visible: context.sessionNumber >= 4, phase: context.sessionNumber < 4 ? 'early' : context.sessionNumber === 4 ? 'approaching' : context.sessionNumber === 5 ? 'due' : 'overdue',
    fields: [...fields.values()], gaps, excludedCount, hasPendingInformation: Boolean(context.pendingIntakeFields?.length || freshDraft) };
}

export function intakeCompletionFocus(fieldId: number): DraftFollowUp {
  const field = intakeFields.find(item => item.id === fieldId);
  if (!field) throw new Error('שדה האינטייק אינו מוכר.');
  return { goal: 'intake', kind: 'expand', fieldIds: [fieldId], text: `השלמת האינטייק בנושא: ${field.label}` };
}

export function isIntakeCompletionFocus(context: ContextPacket, selection: DraftFollowUp): boolean {
  const readiness = intakeReadiness(context);
  return readiness.visible && isCanonicalIntakeCompletionFocus(selection)
    && readiness.gaps.some(gap => gap.canDiscuss && gap.field.id === selection.fieldIds[0]);
}

/** Stable archive identity; eligibility can change after a valid round has begun. */
export function isCanonicalIntakeCompletionFocus(selection: DraftFollowUp): boolean {
  const field = intakeFields.find(item => item.id === selection.fieldIds[0]);
  return Boolean(field && selection.goal === 'intake' && selection.kind === 'expand' && selection.fieldIds.length === 1
    && selection.text === intakeCompletionFocus(field.id).text);
}

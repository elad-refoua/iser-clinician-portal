import type { ContextPacket, DraftFollowUp, IntakeField } from '../contracts';
import { emptyIntakeFields, intakeFields, intakeSections } from '../prompts/intake-schema.js';
import { intakeTopicMatches } from './intake-report.js';
import { effectiveIntakeFields, evidenceItemIssue } from './evidence-map.js';

// Discussion preferences have a wider vocabulary than historical report redaction.
// Keep the latter unchanged so old approved intake renderings remain recognizable.
function discussionTopicMatches(field: IntakeField, topic: string): boolean {
  const terms = topic.normalize('NFKC').replace(/[\u0591-\u05C7]/g, '').split(/[^\p{L}\p{N}]+/u);
  return intakeTopicMatches(field, topic) || (field.id === 10 && terms.some(term => /^(?:ו?[בכלמש]?ה?)?(?:רפואי|רפואית|מחלות)$/u.test(term)));
}

export interface IntakeGap {
  field: IntakeField;
  label: string;
  section: string;
  canDiscuss: boolean;
  discussionReason?: string;
  lowerPriority: boolean;
  relevanceReason?: string;
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
  const fields = new Map(effectiveIntakeFields(context, emptyIntakeFields()).map(field => [field.id, field]));
  const freshDraft = context.workingDraft && context.workingDraftMetadata?.stale === false;
  const latestSourceId = [...context.messages].reverse().find(message => message.role === 'user' && message.sourceId)?.sourceId;
  const evidence = (context.evidenceMap ?? []).filter(item => !evidenceItemIssue(item, context));
  const recentFields = new Set(evidence.filter(item => item.sourceId === latestSourceId).flatMap(item => item.fieldIds));
  const priorFields = new Set(evidence.filter(item => item.sourceId !== latestSourceId && item.kind !== 'uncertainty' && item.uncertainty !== 'ambiguous').flatMap(item => item.fieldIds));
  const gaps: IntakeGap[] = [];
  let excludedCount = 0;
  for (const field of fields.values()) {
    if (context.preferences.some(preference => preference.action === 'exclude' && (!preference.goal || preference.goal === 'intake') && intakeTopicMatches(field, preference.topic))) {
      excludedCount++; continue;
    }
    if (field.status === 'documented' || field.status === 'not_applicable') continue;
    const blocked = context.preferences.some(preference => preference.action === 'block' && discussionTopicMatches(field, preference.topic));
    const skipped = context.skippedTopics.some(topic => discussionTopicMatches(field, topic));
    const notRecalled = field.status === 'not_recalled';
    const canDiscuss = !blocked && !skipped && !notRecalled;
    const lowerPriority = context.preferences.some(preference => preference.action === 'less' && discussionTopicMatches(field, preference.topic));
    const recentlyRelevant = (field.status === 'partial' || field.status === 'conflict') && Boolean(latestSourceId)
      && (field.sourceIds.includes(latestSourceId!) || recentFields.has(field.id));
    gaps.push({ field, label: intakeFields.find(item => item.id === field.id)!.label,
      section: intakeSections.find(section => section.fieldIds.includes(field.id))!.title,
      canDiscuss,
      ...(blocked ? { discussionReason: 'הנושא חסום לשאלות לפי ההעדפה שלך.' } : skipped ? { discussionReason: 'בחרת לדלג על הנושא בפגישה הזו.' } : notRecalled ? { discussionReason: 'הפרט סומן כלא זכור; לא נבקש אותו שוב.' } : {}),
      lowerPriority,
      ...(canDiscuss && !lowerPriority && recentlyRelevant ? { relevanceReason: 'עלה בשיתוף האחרון' }
        : canDiscuss && !lowerPriority && priorFields.has(field.id) ? { relevanceReason: 'נמצא מידע קודם לעיון' } : {}),
    });
  }
  const rank = (gap: IntakeGap) => gap.lowerPriority ? 5 : !gap.canDiscuss ? 4
    : context.focusSelection?.goal === 'intake' && context.focusSelection.fieldIds.includes(gap.field.id) ? 0
      : gap.relevanceReason === 'עלה בשיתוף האחרון' ? 1 : gap.relevanceReason === 'נמצא מידע קודם לעיון' ? 2 : 3;
  gaps.sort((left, right) => rank(left) - rank(right) || left.field.id - right.field.id);
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

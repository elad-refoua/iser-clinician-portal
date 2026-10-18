import { z } from 'zod';
import type { ContextPacket, DocumentVersion, EvidenceItem, IntakeAuthority, IntakeField, PortalState, QuestionAnchor, Source } from '../contracts/index.js';

export const EVIDENCE_LIMITS = { increment: 8, context: 40, quote: 600 } as const;
const identifier = z.string().min(1).max(160).regex(/^[\p{L}\p{N}_.:-]+$/u);
const fieldIds = z.array(z.number().int().min(1).max(32)).max(32);
export const evidenceItemSchema = z.object({
  sourceId: identifier, quote: z.string().min(1).max(EVIDENCE_LIMITS.quote),
  attribution: z.enum(['clinician_report', 'patient_report_relayed', 'clinician_observation', 'clinician_interpretation', 'unspecified']),
  kind: z.enum(['event', 'background', 'intervention', 'response', 'plan', 'correction', 'uncertainty']),
  temporalReference: z.string().max(EVIDENCE_LIMITS.quote), fieldIds,
  destinations: z.array(z.enum(['note', 'formulation', 'intake', 'gold', 'supervision'])).max(5),
  uncertainty: z.enum(['explicit', 'ambiguous', 'unspecified']),
}).strict();
export const questionAnchorSchema = z.object({ sourceIds: z.array(identifier).max(8), fieldIds }).strict();
export const intakeAuthoritySchema = z.object({ fieldId: z.number().int().min(1).max(32), cutoffAt: z.string().datetime({ offset: true }), retainedSourceIds: z.array(identifier).max(200) }).strict();
const unique = (values: unknown[]) => new Set(values).size === values.length;
type EvidenceContext = Pick<ContextPacket, 'sources' | 'patientId' | 'sessionNumber' | 'branchScope' | 'asOf'>;

export function sourceWithinContext(source: Source, context: EvidenceContext): boolean {
  const scope = context.branchScope.find(item => item.branchId === source.branchId);
  return Boolean(source.patientId === context.patientId && scope
    && (source.sessionNumber === undefined || source.sessionNumber <= Math.min(scope.throughSession, context.sessionNumber))
    && Date.parse(source.recordedAt) <= Math.min(Date.parse(context.asOf), scope.cutoffAt ? Date.parse(scope.cutoffAt) : Infinity));
}

/** Exact excerpts are checked; category and field links remain reviewable model interpretations. */
export function evidenceItemIssue(item: EvidenceItem, context: EvidenceContext): string | undefined {
  const source = context.sources.find(source => source.id === item.sourceId);
  if (!source || !sourceWithinContext(source, context)) return 'unknown_evidence_source';
  if (!item.quote.trim() || !source.text.includes(item.quote)) return 'invalid_evidence_quote';
  if (item.temporalReference && (!item.temporalReference.trim() || !source.text.includes(item.temporalReference))) return 'invalid_evidence_time';
  if (!unique(item.fieldIds) || !unique(item.destinations)) return 'duplicate_evidence_link';
  return undefined;
}

export function questionAnchorIssue(anchor: QuestionAnchor, action: 'question' | 'draft', context: ContextPacket): string | undefined {
  if (!unique(anchor.sourceIds) || !unique(anchor.fieldIds)) return 'duplicate_question_anchor';
  if (anchor.sourceIds.some(id => !context.sources.some(source => source.id === id && sourceWithinContext(source, context)))) return 'unknown_question_source';
  if (action === 'draft') return anchor.sourceIds.length || anchor.fieldIds.length ? 'unexpected_question_anchor' : undefined;
  if (!anchor.sourceIds.length && (context.stage !== 'intake' || !anchor.fieldIds.length || context.focusSelection?.goal !== 'intake'
    || anchor.fieldIds.some(id => !context.focusSelection!.fieldIds.includes(id)))) return 'ungrounded_question';
  return undefined;
}

type IntakeAuthorityContext = Pick<ContextPacket, 'documents' | 'sources' | 'intakeAuthority'>;
/** Inputs have already been restricted to the current patient, branch and time. */
export function deriveIntakeAuthority(versions: DocumentVersion[], sources: Source[]): IntakeAuthority[] {
  const byId = new Map(sources.map(source => [source.id, source]));
  const authority = new Map<number, IntakeAuthority>();
  const intakeVersions = versions.filter(version => version.kind === 'intake' && !version.proposal && !version.rejected)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  for (const version of intakeVersions) {
    const restored = version.reason.startsWith('שחזור מלא של גרסה ');
    for (const field of version.fields ?? []) {
      if (restored) {
        authority.set(field.id, { fieldId: field.id, cutoffAt: version.createdAt, retainedSourceIds: [...field.sourceIds] });
        continue;
      }
      const newest = field.sourceIds.map(id => byId.get(id)).filter((source): source is Source => Boolean(source))
        .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt))[0];
      const previous = authority.get(field.id);
      if (newest?.kind === 'manual' && (!previous || Date.parse(newest.recordedAt) > Date.parse(previous.cutoffAt)
        || (version.reason === 'עריכה ישירה של המטפל' && newest.recordedAt === version.createdAt && Date.parse(version.createdAt) >= Date.parse(previous.cutoffAt)))) {
        authority.set(field.id, { fieldId: field.id, cutoffAt: newest.recordedAt, retainedSourceIds: [...field.sourceIds] });
      }
    }
  }
  return [...authority.values()].sort((left, right) => left.fieldId - right.fieldId);
}

function savedFieldAuthority(context: IntakeAuthorityContext, fieldId: number) {
  const intake = context.documents.find(document => document.kind === 'intake');
  const field = intake?.fields?.find(field => field.id === fieldId);
  const sourceIds = new Set(field?.sourceIds ?? []);
  const newest = context.sources.filter(source => sourceIds.has(source.id)).sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt))[0];
  const manualAt = newest?.kind === 'manual' ? Date.parse(newest.recordedAt) : -Infinity;
  const restoredAt = intake?.reason?.startsWith('שחזור מלא של גרסה ') && intake.createdAt ? Date.parse(intake.createdAt) : -Infinity;
  const derived = context.intakeAuthority?.find(item => item.fieldId === fieldId);
  return { field, cutoff: Math.max(manualAt, restoredAt, derived ? Date.parse(derived.cutoffAt) : -Infinity), retainedSourceIds: derived?.retainedSourceIds ?? field?.sourceIds ?? [] };
}

/** Saved clinician authority is independent of pending AI fields and map recency. */
export function evidenceFieldAssociationAllowed(context: IntakeAuthorityContext, fieldId: number, source: Source): boolean {
  const { cutoff, retainedSourceIds } = savedFieldAuthority(context, fieldId);
  return retainedSourceIds.includes(source.id) || Date.parse(source.recordedAt) > cutoff;
}

export function fieldUpdateAuthorityIssue(update: IntakeField, context: IntakeAuthorityContext): string | undefined {
  const { field, cutoff } = savedFieldAuthority(context, update.id);
  if (!Number.isFinite(cutoff)) return undefined;
  const unchanged = field && field.value === update.value && field.status === update.status && (field.remaining ?? '') === (update.remaining ?? '')
    && field.sourceIds.length === update.sourceIds.length && field.sourceIds.every(id => update.sourceIds.includes(id));
  if (unchanged || context.sources.some(source => update.sourceIds.includes(source.id) && Date.parse(source.recordedAt) > cutoff)) return undefined;
  return 'superseded_field_source';
}

/** Resolve fields without converting evidence associations into factual updates. */
export function effectiveIntakeFields(context: ContextPacket, initial: IntakeField[] = []): IntakeField[] {
  const ids = new Set(context.sources.map(source => source.id));
  const fields = new Map(initial.map(field => [field.id, structuredClone(field)]));
  const apply = (updates: IntakeField[] | undefined, derivative = false) => {
    for (const field of updates ?? []) if (field.sourceIds.every(id => ids.has(id)) && (!derivative || !fieldUpdateAuthorityIssue(field, context))) fields.set(field.id, structuredClone(field));
  };
  apply(context.documents.find(document => document.kind === 'intake')?.fields);
  if (context.workingDraft && context.workingDraftMetadata?.stale === false) apply(context.workingDraft.fieldUpdates, true);
  apply(context.pendingIntakeFields, true);
  return [...fields.values()];
}

function sameSource(left: Source, right: Source): boolean {
  // JSONB and archive validation can reorder object keys without changing a source.
  return left.id === right.id && left.patientId === right.patientId && left.branchId === right.branchId
    && left.sessionId === right.sessionId && left.sessionNumber === right.sessionNumber
    && left.text === right.text && left.recordedAt === right.recordedAt && left.kind === right.kind;
}

/** Derive a bounded index from eligible immutable responses, never from generated prose. */
export function deriveEvidenceMap(state: PortalState, context: ContextPacket): EvidenceItem[] {
  const sources = new Map(context.sources.map(source => [source.id, source]));
  const traces = state.sessions.flatMap(session => {
    const scope = context.branchScope.find(scope => scope.branchId === session.branchId && session.number <= scope.throughSession);
    if (session.patientId !== context.patientId || !scope) return [];
    return session.traces.filter(trace => trace.context.patientId === session.patientId && trace.context.branchId === session.branchId
      && trace.context.sessionId === session.id && trace.context.sessionNumber === session.number
      && Date.parse(trace.at) >= Date.parse(trace.context.asOf)
      && Date.parse(trace.at) <= Math.min(Date.parse(context.asOf), scope.cutoffAt ? Date.parse(scope.cutoffAt) : Infinity));
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const mapped = new Map<string, EvidenceItem>();
  for (const trace of traces) for (const candidate of trace.response.evidenceMap ?? []) {
    if (!evidenceItemSchema.safeParse(candidate).success || evidenceItemIssue(candidate, context) || evidenceItemIssue(candidate, trace.context)) continue;
    const source = sources.get(candidate.sourceId)!;
    if (!trace.context.sources.some(saved => sameSource(saved, source))) continue;
    const key = JSON.stringify([candidate.sourceId, candidate.quote, candidate.kind, candidate.attribution, candidate.temporalReference]);
    if (mapped.has(key)) continue;
    const fieldIds = candidate.fieldIds.filter(id => evidenceFieldAssociationAllowed(context, id, source));
    mapped.set(key, { ...structuredClone(candidate), fieldIds });
    if (mapped.size >= EVIDENCE_LIMITS.context) return [...mapped.values()];
  }
  return [...mapped.values()];
}

import { z } from 'zod';
import type { ContextPacket, DraftResult, ModelRequest, TurnResult } from '../../packages/contracts/index.js';
import { MODELS } from '../../packages/contracts/index.js';
import { ApiError } from './errors.js';

const id = z.string().min(1).max(160).regex(/^[\p{L}\p{N}_.:-]+$/u);
const date = z.string().datetime({ offset: true });
const goal = z.enum(['note', 'formulation', 'intake', 'gold', 'supervision']);
const status = z.enum(['documented', 'partial', 'unknown', 'not_assessed', 'not_recalled', 'conflict', 'not_applicable']);
const sourceIds = z.array(id).max(200);
const field = z.object({ id: z.number().int().min(1).max(32), value: z.string().max(5000), status, sourceIds, remaining: z.string().max(2000) }).strict();
const preferenceCore = { topic: z.string().min(1).max(200), goal: goal.optional(), action: z.enum(['less', 'block', 'exclude']), scope: z.enum(['session', 'patient']) };
const preference = z.object({ id, ...preferenceCore, sessionId: id.optional(), patientId: id.optional(), branchId: id.optional(), recordedAt: date.optional() }).strict();
const source = z.object({ id, patientId: id, branchId: id, sessionId: id.optional(), sessionNumber: z.number().int().min(1).max(1000).optional(), text: z.string().max(16000), recordedAt: date, kind: z.enum(['clinician', 'manual', 'seed']) }).strict();
const storedField = field.extend({ remaining: z.string().max(2000).optional() });
const followUp = z.object({ goal, text: z.string().min(1).max(1200), kind: z.enum(['expand', 'next_session']), fieldIds: z.array(z.number().int().min(1).max(32)).max(32) }).strict();
export const draftSchema = z.object({ documents: z.array(z.object({ kind: goal, content: z.string().max(30000), sourceIds }).strict()).length(5), fieldUpdates: z.array(field).max(32), rationale: z.string().max(1200), summary: z.string().min(1).max(1600).optional(), followUps: z.array(followUp).max(3).optional() }).strict();
const liveDraftSchema = draftSchema.extend({ summary: z.string().min(1).max(1600), followUps: z.array(followUp).max(3) });
const contextSchema = z.object({
  patientId: id, patientName: z.string().min(1).max(200), branchId: id, sessionId: id,
  sessionNumber: z.number().int().min(1).max(1000), baseRevision: z.number().int().min(0), asOf: date,
  stage: z.enum(['main', 'intake', 'draft']), questionCount: z.number().int().min(0).max(3), intakeCount: z.number().int().min(0).max(2),
  intakeRound: z.number().int().min(0).max(10).optional(),
  focusGoal: goal.optional(), focusSelection: followUp.extend({ kind: z.literal('expand') }).optional(), workingDraft: draftSchema.optional(), pendingIntakeFields: z.array(storedField).max(32).optional(),
  branchScope: z.array(z.object({ branchId: id, throughSession: z.number().int().min(1).max(1000), cutoffAt: date.optional() }).strict()).min(1).max(20),
  preferences: z.array(preference).max(50), skippedTopics: z.array(z.string().max(200)).max(50), sources: z.array(source).max(200),
  documents: z.array(z.object({ kind: goal, versionId: id, content: z.string().max(30000), fields: z.array(storedField).max(32).optional(), sourceIds }).strict()).max(5),
  messages: z.array(z.object({ id, role: z.enum(['user', 'assistant']), text: z.string().max(16000), sourceId: id.optional(), at: date }).strict()).max(80),
}).strict();
export const requestSchema = z.object({ requestId: id, model: z.enum(MODELS.map(m => m.id)), context: contextSchema }).strict();
export const turnSchema = z.object({ action: z.enum(['question', 'draft']), utterance: z.string().min(1).max(1500), topic: z.string().max(200), rationale: z.string().max(1200), fieldUpdates: z.array(field).max(32), preferenceUpdates: z.array(z.object(preferenceCore).strict()).max(10) }).strict();
const unique = (values: unknown[]) => new Set(values).size === values.length;

export function validateRequest(raw: unknown, task: 'turn' | 'draft'): ModelRequest {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'invalid_request');
  const request = parsed.data as ModelRequest; const c = request.context;
  if ((task === 'draft') !== (c.stage === 'draft')) throw new ApiError(400, 'invalid_stage');
  if (!unique(c.sources.map(s => s.id)) || !unique(c.branchScope.map(b => b.branchId)) || !unique(c.documents.map(d => d.kind)) || !unique(c.messages.map(m => m.id))) throw new ApiError(400, 'duplicate_context_id');
  if (!c.branchScope.some(b => b.branchId === c.branchId && b.throughSession === c.sessionNumber)) throw new ApiError(400, 'invalid_branch_scope');
  if (c.focusSelection && (c.focusSelection.goal !== c.focusGoal || !unique(c.focusSelection.fieldIds))) throw new ApiError(400, 'invalid_expansion_selection');
  const ids = new Set(c.sources.map(s => s.id));
  const sources = new Map(c.sources.map(s => [s.id, s]));
  for (const s of c.sources) {
    const scope = c.branchScope.find(b => b.branchId === s.branchId);
    const current = s.sessionId === c.sessionId && s.branchId === c.branchId;
    if (s.patientId !== c.patientId || !scope || (s.sessionNumber !== undefined && (s.sessionNumber > scope.throughSession || s.sessionNumber > c.sessionNumber)) || (current && s.sessionNumber !== c.sessionNumber) || Date.parse(s.recordedAt) > Math.min(Date.parse(c.asOf), scope.cutoffAt ? Date.parse(scope.cutoffAt) : Infinity)) throw new ApiError(400, 'source_outside_context');
  }
  for (const d of c.documents) {
    if (!d.sourceIds.every(s => ids.has(s)) || !unique(d.sourceIds) || (d.fields && !unique(d.fields.map(f => f.id))) || d.fields?.some(f => !f.sourceIds.every(s => ids.has(s)))) throw new ApiError(400, 'unknown_source');
  }
  if (c.pendingIntakeFields && (!unique(c.pendingIntakeFields.map(f => f.id)) || c.pendingIntakeFields.some(f => !unique(f.sourceIds) || !f.sourceIds.every(s => ids.has(s)) || (f.status !== 'unknown' && !f.sourceIds.length)))) throw new ApiError(400, 'unknown_pending_source');
  if (c.workingDraft && (!unique(c.workingDraft.documents.map(d => d.kind)) || !unique(c.workingDraft.fieldUpdates.map(f => f.id))
    || c.workingDraft.documents.some(d => !unique(d.sourceIds) || !d.sourceIds.every(s => ids.has(s)))
    || c.workingDraft.fieldUpdates.some(f => !unique(f.sourceIds) || !f.sourceIds.every(s => ids.has(s)) || (f.status !== 'unknown' && !f.sourceIds.length)))) throw new ApiError(400, 'unknown_pending_source');
  for (const m of c.messages) {
    if (m.sourceId && (!ids.has(m.sourceId) || (m.role === 'user' && sources.get(m.sourceId)?.text !== m.text))) throw new ApiError(400, 'message_source_mismatch');
  }
  if (c.preferences.some(p => {
    const scope = p.branchId ? c.branchScope.find(b => b.branchId === p.branchId) : undefined;
    return (p.scope === 'session' && p.sessionId && p.sessionId !== c.sessionId) || (p.patientId && p.patientId !== c.patientId) || (p.branchId && !scope) || (p.recordedAt && Date.parse(p.recordedAt) > Math.min(Date.parse(c.asOf), scope?.cutoffAt ? Date.parse(scope.cutoffAt) : Infinity));
  })) throw new ApiError(400, 'preference_outside_session');
  return request;
}
const normalize = (value: string) => value.normalize('NFKC').replace(/[\u0591-\u05c7]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().toLowerCase();
function mentions(text: string, topic: string) { const needle = normalize(topic); return needle.length > 1 && normalize(text).includes(needle); }
export function shouldFinish(c: ContextPacket) {
  if (c.stage === 'intake' && c.intakeCount === 0) return false;
  const last = [...c.messages].reverse().find(m => m.role === 'user')?.text ?? '';
  return /^(?:(?:זהו|תודה|בבקשה)[,\s]*)?(?:סיימתי(?:\s+להיום)?|סיים\s+לטיוטה|נעבור\s+לטיוטה|להפסיק\s+לשאול|stop|finish|draft now)[.!\s]*$/i.test(last.trim());
}
export function validateResult(raw: unknown, task: 'turn' | 'draft', c: ContextPacket): TurnResult | DraftResult {
  const parsed = (task === 'turn' ? turnSchema : liveDraftSchema).safeParse(raw);
  if (!parsed.success) throw new ApiError(502, 'invalid_model_output');
  const result = parsed.data as TurnResult | DraftResult;
  if (c.focusSelection && (c.focusSelection.goal !== c.focusGoal || !unique(c.focusSelection.fieldIds))) throw new ApiError(400, 'invalid_expansion_selection');
  const ids = new Set(c.sources.map(s => s.id));
  if (!unique(result.fieldUpdates.map(f => f.id))) throw new ApiError(502, 'duplicate_field_update');
  for (const f of result.fieldUpdates) {
    if (!f.sourceIds.every(s => ids.has(s)) || !unique(f.sourceIds)) throw new ApiError(502, 'unknown_model_source');
    if (f.status !== 'unknown' && f.sourceIds.length === 0) throw new ApiError(502, 'unsourced_field');
    if (f.status === 'unknown' && f.value.trim()) throw new ApiError(502, 'unsupported_unknown_value');
    if (c.preferences.some(p => p.action === 'exclude' && (!p.goal || p.goal === 'intake') && mentions(f.value, p.topic))) throw new ApiError(502, 'excluded_topic_in_output');
  }
  if ('documents' in result) {
    if (!unique(result.documents.map(d => d.kind))) throw new ApiError(502, 'missing_document_kind');
    for (const d of result.documents) {
      if (!d.sourceIds.every(s => ids.has(s)) || !unique(d.sourceIds)) throw new ApiError(502, 'unknown_model_source');
      for (const p of c.preferences.filter(p => p.action === 'exclude' && (!p.goal || p.goal === d.kind))) {
        if (mentions(d.content, p.topic)) throw new ApiError(502, 'excluded_topic_in_output');
      }
    }
    if (result.followUps?.some(item => !unique(item.fieldIds))) throw new ApiError(502, 'duplicate_follow_up_field');
  } else if (result.action === 'question') {
    if (shouldFinish(c) || (c.stage === 'main' ? c.questionCount >= 3 : c.intakeCount >= 2)) throw new ApiError(502, 'question_limit');
    if ((result.utterance.match(/[?？]/g) ?? []).length !== 1 || /(?:^|[.!]\s*)האם\s/.test(result.utterance) || /(?:\sו|[,;]\s*(?:ו)?)(?:איך|מה|כיצד|מתי|האם|מי|איזה|אילו|היכן|למה|מדוע)\s/u.test(result.utterance) || !result.topic.trim()) throw new ApiError(502, 'invalid_question');
    const blocked = [...c.skippedTopics, ...c.preferences.filter(p => p.action === 'block').map(p => p.topic)];
    if (blocked.some(t => mentions(result.topic, t) || mentions(result.utterance, t))) throw new ApiError(502, 'blocked_question_topic');
  } else if (/[?？]/.test(result.utterance)) {
    throw new ApiError(502, 'question_in_draft_transition');
  }
  return result;
}

// OpenAI strict schemas require every property in required; represent optional goal with null on the wire.
export function responseSchema(task: 'turn' | 'draft') {
  const wirePreference = z.object({ ...preferenceCore, goal: goal.nullable() }).strict();
  const schema = task === 'draft' ? liveDraftSchema : turnSchema.extend({ preferenceUpdates: z.array(wirePreference).max(10) });
  // Provider grammars implement different JSON Schema subsets. Keep the wire contract
  // structural; all length, range and provenance constraints still run in validateResult.
  const unsupported = new Set(['$schema', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'pattern', 'format']);
  const portable = (value: unknown): unknown => Array.isArray(value) ? value.map(portable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !unsupported.has(key)).map(([key, child]) => [key, portable(child)])) : value;
  return portable(z.toJSONSchema(schema, { target: 'draft-7' }));
}
export function normalizeWireResult(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'preferenceUpdates' in raw && Array.isArray(raw.preferenceUpdates)) {
    for (const preference of raw.preferenceUpdates) if (preference && typeof preference === 'object' && preference.goal === null) delete preference.goal;
  }
  return raw;
}

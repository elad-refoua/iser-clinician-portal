import { createDemoState } from '../fixtures/fictional';
import { preparedDraft } from '../fixtures/fictional/prepared';
import { addUserMessage, buildContext, compactModelContext, createSession, saveDraft } from '../packages/domain';
import { DEFAULT_MODEL, MAX_MODEL_REQUEST_BYTES, TEXT_LIMITS, type ModelRequest } from '../packages/contracts';

/** Artificial text only. Keeps a pending draft and fills the accepted request envelope. */
export function longCaseRequest(targetBytes = MAX_MODEL_REQUEST_BYTES - 128): ModelRequest {
  const seed = createDemoState();
  const patient = seed.patients[0];
  const branch = seed.branches.find(item => item.patientId === patient.id)!;
  const created = createSession(seed, patient.id, branch.id, 5);
  let state = addUserMessage(created.state, created.session.id, 'בדיקת עומס בדיונית בלבד: להכין טיוטה מתוך התיק המלא, ללא המצאת מידע.');
  const context = buildContext(state, created.session.id, 'draft');
  state = saveDraft(state, created.session.id, context.baseRevision, {
    ...preparedDraft(context), summary: 'טיוטה בדיונית לבדיקת עומס', followUps: [],
  });
  const request: ModelRequest = {
    requestId: 'synthetic-long-case', model: DEFAULT_MODEL,
    context: compactModelContext(buildContext(state, created.session.id, 'draft')),
  };
  const bytes = () => Buffer.byteLength(JSON.stringify(request), 'utf8');
  const unit = 'טקסט בדיקה מלאכותי בלבד. ';
  while (targetBytes - bytes() > 1_000) {
    const index = request.context.sources.length;
    const source = {
      id: `synthetic-long-source-${index}`, patientId: patient.id, branchId: branch.id,
      sessionId: created.session.id, sessionNumber: 5, recordedAt: created.session.startedAt,
      kind: 'manual' as const, text: `תחילת מקור בדיוני ${index}. `,
    };
    request.context.sources.push(source);
    const available = targetBytes - bytes() - 300;
    const repeats = Math.max(0, Math.min(Math.floor(available / Buffer.byteLength(unit)), Math.floor((TEXT_LIMITS.source - 100) / unit.length)));
    source.text += unit.repeat(repeats) + ` סוף מקור בדיוני ${index}.`;
  }
  // A short distinct tail makes it possible to prove that no source was truncated.
  const last = request.context.sources.at(-1)!;
  const remaining = targetBytes - bytes();
  if (remaining > 0) last.text += 'Z'.repeat(remaining);
  return request;
}

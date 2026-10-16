import { GOAL_LABELS, type ContextPacket, type Goal, type PortalState, type Session, type Source, type Trace } from '../../packages/contracts';
import { buildContext } from '../../packages/domain';

export const experienceGoals: Goal[] = ['note', 'formulation', 'intake', 'gold', 'supervision'];

/** A reading excerpt, never a generated case summary. Full originals remain available. */
export function documentExcerpt(content: string, limit = 240) {
  const prose = content.split('\n').filter(line => line.trim() && !/^\s*#/.test(line) && !/^מקור:/.test(line)).join(' ').trim();
  if (prose.length <= limit) return prose;
  const cut = prose.lastIndexOf(' ', limit);
  return `${prose.slice(0, cut > limit / 2 ? cut : limit)}…`;
}

export function sourceLabel(source: Source) {
  const owner = source.sessionNumber ? `פגישה ${source.sessionNumber}` : 'בין פגישות / פרטי התיק';
  const kind = source.kind === 'seed' ? 'מקור הדגמה בדיוני' : source.kind === 'manual' ? 'עריכת המטפל' : 'דברי המטפל';
  return `${owner} · ${kind}`;
}

export function traceOrigin(trace: Trace) {
  if (trace.model === 'server-policy') return { kind: 'policy', label: 'כלל סיום של המערכת', sent: false } as const;
  if (trace.mode === 'prepared') return { kind: 'prepared', label: 'דוגמה היסטורית מוכנה מראש', sent: false } as const;
  return { kind: 'model', label: 'תשובה שנוצרה במודל שפה', sent: true } as const;
}

export function citedSourceIds(trace: Trace): string[] {
  const result = trace.response;
  return [...new Set([
    ...result.fieldUpdates.flatMap(field => field.sourceIds),
    ...('documents' in result ? result.documents.flatMap(document => document.sourceIds) : []),
  ])];
}

function isInContext(session: Session, context: ContextPacket) {
  const scope = context.branchScope.find(item => item.branchId === session.branchId && session.number <= item.throughSession);
  return session.patientId === context.patientId && scope && Date.parse(session.startedAt) <= Date.parse(context.asOf)
    && (!scope.cutoffAt || Date.parse(session.startedAt) <= Date.parse(scope.cutoffAt));
}

export function caseOverview(state: PortalState, patientId: string) {
  const patient = state.patients.find(item => item.id === patientId);
  if (!patient) return undefined;
  const branch = state.branches.find(item => item.patientId === patientId && !item.parentId)
    ?? state.branches.find(item => item.patientId === patientId);
  const latest = state.sessions.filter(item => item.patientId === patientId && item.branchId === branch?.id)
    .sort((a, b) => b.number - a.number)[0];
  const context = latest ? buildContext(state, latest.id) : undefined;
  const timeline = context ? state.sessions.filter(item => isInContext(item, context)).sort((a, b) => a.number - b.number)
    .flatMap(session => {
      const atSession = buildContext(state, session.id);
      // Intersect with the current branch snapshot so later parent-branch edits never leak into a fork overview.
      const permitted = new Set(context.sources.map(source => source.id));
      const note = atSession.documents.find(document => document.kind === 'note' && document.sourceIds.length > 0 && document.sourceIds.every(id => permitted.has(id)));
      const ownSource = atSession.sources.find(source => source.sessionId === session.id && permitted.has(source.id));
      const submitted = session.messages.some(message => message.role === 'user' && Boolean(message.text.trim()) && atSession.messages.some(item => item.id === message.id));
      if (!note && !ownSource && !submitted) return [];
      return [{ session, note, excerpt: note ? documentExcerpt(note.content, 260) : ownSource ? documentExcerpt(ownSource.text, 260) : 'נשמרו דברים מהפגישה; עדיין אין רשומה מעובדת.' }];
    }) : [];
  const materials = experienceGoals.map(kind => {
    const document = context?.documents.find(item => item.kind === kind);
    const present = kind === 'note' ? timeline.some(item => Boolean(item.note)) : Boolean(document?.sourceIds.length && document.content.trim());
    return { kind, label: GOAL_LABELS[kind], present, document };
  });
  const fields = context?.documents.find(document => document.kind === 'intake')?.fields ?? [];
  return { patient, branch, latest, context, timeline, materials,
    documentedFields: fields.filter(field => field.status === 'documented').length,
    partialFields: fields.filter(field => field.status === 'partial').length,
    nextNumber: latest?.status === 'approved' ? latest.number + 1 : latest?.number ?? 1,
    hasOpenSession: Boolean(latest && latest.status !== 'approved'),
  };
}

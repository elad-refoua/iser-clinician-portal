export type Goal = 'note' | 'formulation' | 'intake' | 'gold' | 'supervision';
export type FieldStatus = 'documented' | 'partial' | 'unknown' | 'not_assessed' | 'not_recalled' | 'conflict' | 'not_applicable';
export type Mode = 'prepared' | 'live';
export interface PatientSchedule { dayOfWeek?: number; time?: string }
export interface Patient { id: string; name: string; age?: number; schedule?: PatientSchedule; description: string; fictional: true }
export interface Branch { id: string; patientId: string; name: string; parentId?: string; forkSession?: number; cutoffAt?: string }
export interface Preference { id: string; topic: string; goal?: Goal; action: 'less' | 'block' | 'exclude'; scope: 'session' | 'patient'; sessionId?: string; patientId?: string; branchId?: string; recordedAt?: string }
export type PreferenceUpdate = Omit<Preference, 'id' | 'sessionId' | 'patientId' | 'branchId' | 'recordedAt'>;
export interface PreferenceCancellation { id: string; preferenceId: string; patientId: string; branchId: string; sessionId: string; recordedAt: string }
export interface Source { id: string; patientId: string; branchId: string; sessionId?: string; sessionNumber?: number; text: string; recordedAt: string; kind: 'clinician' | 'manual' | 'seed' }
export interface EvidenceItem {
  sourceId: string; quote: string;
  attribution: 'clinician_report' | 'patient_report_relayed' | 'clinician_observation' | 'clinician_interpretation' | 'unspecified';
  kind: 'event' | 'background' | 'intervention' | 'response' | 'plan' | 'correction' | 'uncertainty';
  temporalReference: string; fieldIds: number[]; destinations: Goal[];
  uncertainty: 'explicit' | 'ambiguous' | 'unspecified';
}
export interface QuestionAnchor { sourceIds: string[]; fieldIds: number[] }
export interface IntakeAuthority { fieldId: number; cutoffAt: string; retainedSourceIds: string[] }
export interface IntakeField { id: number; value: string; status: FieldStatus; sourceIds: string[]; remaining?: string }
export interface DocumentVersion { id: string; patientId: string; branchId: string; kind: Goal; sessionId?: string; sessionNumber?: number; content: string; fields?: IntakeField[]; sourceIds: string[]; createdAt: string; author: 'clinician' | 'assistant' | 'seed'; reason: string; baseVersionId?: string; approved: boolean; proposal?: boolean; rejected?: boolean }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; sourceId?: string; at: string }
export interface Trace { id: string; at: string; mode: Mode; model: string; promptVersion: string; prompt: string; contextOrigin?: 'server' | 'client'; context: ContextPacket; response: TurnResult | DraftResult; elapsedMs: number; usage?: { input: number; output: number; cost?: number } }
export interface PendingDraft { id: string; createdAt: string; baseVersionIds: Partial<Record<Goal, string>>; result: DraftResult; fields: IntakeField[]; reviewRevision: number; preferenceSnapshot?: Preference[]; approvedAt?: string; approvedVersionIds?: string[] }
export interface Session { id: string; patientId: string; branchId: string; number: number; startedAt: string; closedAt?: string; revision: number; status: 'writing' | 'asking' | 'draft' | 'approved'; messages: Message[]; composer: string; questionCount: number; intakeCount: number; intakeRound?: number; intakeActive: boolean; focusGoal?: Goal; focusSelection?: DraftFollowUp; pendingFields?: FieldUpdate[]; pendingDraft?: PendingDraft; draftHistory?: PendingDraft[]; skippedTopics: string[]; traces: Trace[] }
export interface PortalState { schemaVersion: 1; patients: Patient[]; branches: Branch[]; sessions: Session[]; sources: Source[]; versions: DocumentVersion[]; preferences: Preference[]; preferenceCancellations?: PreferenceCancellation[] }
export interface ContextPacket {
  patientId: string; patientName: string; branchId: string; sessionId: string; sessionNumber: number;
  baseRevision: number; asOf: string; stage: 'main' | 'intake' | 'draft'; questionCount: number; intakeCount: number;
  intakeRound?: number;
  focusGoal?: Goal; focusSelection?: DraftFollowUp; workingDraft?: DraftResult; pendingIntakeFields?: IntakeField[];
  workingDraftMetadata?: { draftId: string; createdAt: string; reviewRevision: number; baseVersionIds: Partial<Record<Goal, string>>; stale: boolean; derivative: true };
  branchScope: {branchId: string; throughSession: number; cutoffAt?: string}[];
  preferences: Preference[]; skippedTopics: string[]; sources: Source[];
  evidenceMap?: EvidenceItem[];
  intakeAuthority?: IntakeAuthority[];
  documents: { kind: Goal; versionId: string; content: string; fields?: IntakeField[]; sourceIds: string[]; author?: DocumentVersion['author']; approved?: boolean; createdAt?: string; reason?: string }[];
  messages: Message[];
}
export interface FieldUpdate { id: number; value: string; status: FieldStatus; sourceIds: string[]; remaining: string }
export interface TurnResult {
  action: 'question' | 'draft'; utterance: string; topic: string; rationale: string;
  fieldUpdates: FieldUpdate[]; preferenceUpdates: PreferenceUpdate[];
  evidenceMap?: EvidenceItem[]; questionAnchor?: QuestionAnchor;
}
export interface DraftDocument { kind: Goal; content: string; sourceIds: string[] }
export interface DraftFollowUp { goal: Goal; text: string; kind: 'expand' | 'next_session'; fieldIds: number[] }
export interface DraftResult { documents: DraftDocument[]; fieldUpdates: FieldUpdate[]; rationale: string; summary?: string; followUps?: DraftFollowUp[]; preferenceUpdates?: PreferenceUpdate[]; evidenceMap?: EvidenceItem[] }
export interface ModelRequest { requestId: string; model: string; context: ContextPacket }
export interface ModelResponse<T> { result: T; prompt: string; promptVersion: string; model: string; elapsedMs: number; effectiveContext?: ContextPacket; usage?: { input: number; output: number; cost?: number } }
export const MODELS = [
  { id: 'anthropic/claude-sonnet-5.5', label: 'Sonnet 5.5' },
  { id: 'openai/gpt-6.1-sol', label: 'GPT 6.1 Sol' },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
] as const;
export const DEFAULT_MODEL = MODELS[0].id;
export const GOAL_LABELS: Record<Goal, string> = { note: 'רשומת הפגישה', formulation: 'המשגה', intake: 'אינטייק', gold: 'חומרי למידה', supervision: 'לקראת הדרכה' };

export const MAX_MODEL_REQUEST_BYTES = 600_000;
export const TEXT_LIMITS = { source: 100_000, document: 100_000, fieldValue: 30_000, fieldRemaining: 5_000, manualDocument: 99_900, message: 16_000 } as const;

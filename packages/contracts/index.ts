export type Goal = 'note' | 'formulation' | 'intake' | 'gold' | 'supervision';
export type FieldStatus = 'documented' | 'partial' | 'unknown' | 'not_assessed' | 'not_recalled' | 'conflict' | 'not_applicable';
export type Mode = 'prepared' | 'live';
export interface PatientSchedule { dayOfWeek?: number; time?: string }
export interface Patient { id: string; name: string; age?: number; schedule?: PatientSchedule; description: string; fictional: true }
export interface Branch { id: string; patientId: string; name: string; parentId?: string; forkSession?: number; cutoffAt?: string }
export interface Preference { id: string; topic: string; goal?: Goal; action: 'less' | 'block' | 'exclude'; scope: 'session' | 'patient'; sessionId?: string; patientId?: string; branchId?: string; recordedAt?: string }
export interface PreferenceCancellation { id: string; preferenceId: string; patientId: string; branchId: string; sessionId: string; recordedAt: string }
export interface Source { id: string; patientId: string; branchId: string; sessionId?: string; sessionNumber?: number; text: string; recordedAt: string; kind: 'clinician' | 'manual' | 'seed' }
export interface IntakeField { id: number; value: string; status: FieldStatus; sourceIds: string[]; remaining?: string }
export interface DocumentVersion { id: string; patientId: string; branchId: string; kind: Goal; sessionId?: string; sessionNumber?: number; content: string; fields?: IntakeField[]; sourceIds: string[]; createdAt: string; author: 'clinician' | 'assistant' | 'seed'; reason: string; baseVersionId?: string; approved: boolean; proposal?: boolean; rejected?: boolean }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; sourceId?: string; at: string }
export interface Trace { id: string; at: string; mode: Mode; model: string; promptVersion: string; prompt: string; context: ContextPacket; response: TurnResult | DraftResult; elapsedMs: number; usage?: { input: number; output: number; cost?: number } }
export interface Session { id: string; patientId: string; branchId: string; number: number; startedAt: string; closedAt?: string; revision: number; status: 'writing' | 'asking' | 'draft' | 'approved'; messages: Message[]; composer: string; questionCount: number; intakeCount: number; intakeRound?: number; intakeActive: boolean; skippedTopics: string[]; traces: Trace[] }
export interface PortalState { schemaVersion: 1; patients: Patient[]; branches: Branch[]; sessions: Session[]; sources: Source[]; versions: DocumentVersion[]; preferences: Preference[]; preferenceCancellations?: PreferenceCancellation[] }
export interface ContextPacket {
  patientId: string; patientName: string; branchId: string; sessionId: string; sessionNumber: number;
  baseRevision: number; asOf: string; stage: 'main' | 'intake' | 'draft'; questionCount: number; intakeCount: number;
  intakeRound?: number;
  branchScope: {branchId: string; throughSession: number; cutoffAt?: string}[];
  preferences: Preference[]; skippedTopics: string[]; sources: Source[];
  documents: { kind: Goal; versionId: string; content: string; fields?: IntakeField[]; sourceIds: string[] }[];
  messages: Message[];
}
export interface FieldUpdate { id: number; value: string; status: FieldStatus; sourceIds: string[]; remaining: string }
export interface TurnResult {
  action: 'question' | 'draft'; utterance: string; topic: string; rationale: string;
  fieldUpdates: FieldUpdate[]; preferenceUpdates: Omit<Preference, 'id' | 'sessionId' | 'patientId' | 'branchId' | 'recordedAt'>[];
}
export interface DraftDocument { kind: Goal; content: string; sourceIds: string[] }
export interface DraftResult { documents: DraftDocument[]; fieldUpdates: FieldUpdate[]; rationale: string }
export interface ModelRequest { requestId: string; model: string; context: ContextPacket }
export interface ModelResponse<T> { result: T; prompt: string; promptVersion: string; model: string; elapsedMs: number; usage?: { input: number; output: number; cost?: number } }
export const MODELS = [
  { id: 'anthropic/claude-sonnet-5.5', label: 'Sonnet 5.5' },
  { id: 'openai/gpt-6.1-sol', label: 'GPT 6.1 Sol' },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
] as const;
export const DEFAULT_MODEL = MODELS[0].id;
export const GOAL_LABELS: Record<Goal, string> = { note: 'רשומת הפגישה', formulation: 'המשגה', intake: 'אינטייק', gold: 'חומרי למידה', supervision: 'לקראת הדרכה' };

import type { ContextPacket } from '../contracts';
import { intakeFields, intakeSections } from './intake-schema.js';
import { AUTHORED_PROMPTS } from './authored.generated.js';
import { interpolatePrompt } from './template.js';

export const PROMPT_VERSION = AUTHORED_PROMPTS.version;

const intakeValues = {
  INTAKE_FIELDS: intakeFields.map(field => field.id + '. ' + field.label).join('\n'),
  INTAKE_SECTIONS: intakeSections.map(section => section.title + ': ' + section.fieldIds.join(', ')).join('\n'),
};

export const PROMPT_SECTIONS: Array<{ id: string; title: string; content: string }> =
  AUTHORED_PROMPTS.sections.map(section => ({
    ...section, content: interpolatePrompt(section.content, intakeValues),
  }));

/** Editable templates are exposed for inspection; request data is inserted only below. */
export const PROMPT_TEMPLATES = {
  turnContract: AUTHORED_PROMPTS.contracts.turn,
  draftContract: AUTHORED_PROMPTS.contracts.draft,
  requestControl: AUTHORED_PROMPTS.requestControl,
  assembly: AUTHORED_PROMPTS.assembly,
};

export function buildSystemPrompt(context: ContextPacket, task: 'turn' | 'draft'): string {
  const control = {
    patientId: context.patientId, branchId: context.branchId, sessionId: context.sessionId,
    sessionNumber: context.sessionNumber, asOf: context.asOf, stage: context.stage,
    questionCount: context.questionCount, intakeCount: context.intakeCount,
    intakeRound: context.intakeRound ?? 0, focusGoal: context.focusGoal, branchScope: context.branchScope,
  };
  return interpolatePrompt(AUTHORED_PROMPTS.assembly, {
    VERSION: PROMPT_VERSION,
    SECTIONS: PROMPT_SECTIONS.map(section => '## ' + section.title + '\n' + section.content).join('\n\n'),
    REQUEST_CONTROL: interpolatePrompt(AUTHORED_PROMPTS.requestControl, { CONTROL_JSON: JSON.stringify(control) }),
    TASK: task,
    CONTRACT: AUTHORED_PROMPTS.contracts[task],
  });
}

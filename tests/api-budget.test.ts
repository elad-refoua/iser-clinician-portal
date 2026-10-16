import { expect, it } from 'vitest';
import { createDemoState } from '../fixtures/fictional';
import { addUserMessage, buildContext, createSession } from '../packages/domain';
import { buildSystemPrompt } from '../packages/prompts';
import { getModels, prepareProviderRequest } from '../apps/api/provider';
import { responseSchema, validateRequest } from '../apps/api/validation';

it.skipIf(process.env.API_BUDGET_LIVE !== '1')('fits all fictional fifth-session drafts under the request budget at live public catalogue prices', async () => {
  const models = await getModels();
  const rows: { patient: string; model: string; inputTokenBound: number; reservationUSD: number }[] = [];
  for (const patient of createDemoState().patients) {
    const seed = createDemoState();
    const branch = seed.branches.find(item => item.patientId === patient.id)!;
    const created = createSession(seed, patient.id, branch.id, 5);
    const state = addUserMessage(created.state, created.session.id, 'זוהי פגישת בדיקה בדיונית בלבד. חזרנו היום לנושא שהוזכר בפגישה הקודמת. המטפל תיאר הפסקה קצרה בשיחה וסיכם שימשיכו בבירור בפגישה הבאה. לא נמסר מידע נוסף.');
    const context = buildContext(state, created.session.id, 'draft');
    validateRequest({ requestId: 'budget-test', model: models[0].id, context }, 'draft');
    for (const model of models) {
      expect(model.available).toBe(true);
      const prepared = prepareProviderRequest(model.catalog!, 'draft', buildSystemPrompt(context, 'draft'), context, responseSchema('draft'));
      rows.push({ patient: patient.id, model: model.id, inputTokenBound: prepared.inputBound, reservationUSD: prepared.micros / 1e6 });
      expect(prepared.micros).toBeLessThanOrEqual(250000);
    }
  }
  console.log(JSON.stringify(rows));
}, 20000);

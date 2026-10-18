import { z } from 'zod';
import { MODELS } from '../../packages/contracts/index.js';
import { ApiError, boundedJson } from './errors.js';
import { LIMITS } from './quota.js';

const positivePrice = z.union([z.string(), z.number()]).transform(Number).refine(n => Number.isFinite(n) && n >= 0);
const pricingSchema = z.object({ prompt: positivePrice, completion: positivePrice, internal_reasoning: positivePrice.optional(), request: positivePrice.optional(), overrides: z.array(z.object({ min_prompt_tokens: z.number(), prompt: positivePrice.optional(), completion: positivePrice.optional() })).optional() });
const modelSchema = z.object({ id: z.string(), canonical_slug: z.string().optional(), context_length: z.number().positive(), pricing: pricingSchema, supported_parameters: z.array(z.string()), top_provider: z.object({ max_completion_tokens: z.number().nullable().optional() }).optional(), reasoning: z.object({ mandatory: z.boolean().optional(), supported_efforts: z.array(z.string()).optional() }).optional() });
export type CatalogModel = z.infer<typeof modelSchema>;
export interface ApprovedModel { id: string; label: string; available: boolean; reason?: string; promptPerMillion?: number; outputPerMillion?: number; supportedParameters?: string[]; catalog?: CatalogModel }
let catalogCache: { at: number; entries: ApprovedModel[] } | undefined;
// Leave time for catalogue lookup, reservation and finalization inside Vercel's duration.
export const PROVIDER_TIMEOUT_MS = 180_000;

export async function getModels(fetcher: typeof fetch = fetch, now = Date.now()): Promise<ApprovedModel[]> {
  if (fetcher === fetch && catalogCache && now - catalogCache.at < 60000) return catalogCache.entries;
  let raw: { data?: unknown[] };
  try {
    const response = await fetcher('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new Error();
    raw = await boundedJson(response, 8_000_000) as { data?: unknown[] };
    if (!Array.isArray(raw.data)) throw new Error();
  } catch { throw new ApiError(503, 'model_catalog_unavailable'); }
  const entries = MODELS.map(model => {
    const match = raw.data!.find(entry => !!entry && typeof entry === 'object' && 'id' in entry && entry.id === model.id);
    const parsed = modelSchema.safeParse(match);
    if (!parsed.success) return { ...model, available: false, reason: 'model_unavailable' };
    const catalog = parsed.data;
    const supported = catalog.supported_parameters;
    const available = supported.includes('response_format') && supported.includes('structured_outputs') && supported.includes('max_tokens') && (!catalog.reasoning?.mandatory || supported.includes('reasoning'));
    return { ...model, available, reason: available ? undefined : 'required_parameters_unavailable', promptPerMillion: catalog.pricing.prompt * 1e6, outputPerMillion: catalog.pricing.completion * 1e6, supportedParameters: supported, catalog };
  });
  if (fetcher === fetch) catalogCache = { at: now, entries };
  return entries;
}

export function prepareProviderRequest(model: CatalogModel, task: 'turn' | 'draft', prompt: string, context: unknown, schema: unknown, outputTokenLimit?: number) {
  const targetOutputTokens = task === 'draft' ? 6000 : 2500;
  const minimumOutputTokens = task === 'draft' ? 3500 : 1500;
  const messages = [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(context) }];
  // UTF-8 bytes conservatively bound text token counts; include schema and framing margin.
  const inputBound = Buffer.byteLength(JSON.stringify({ messages, schema }), 'utf8') + 4096;
  let promptPrice = model.pricing.prompt;
  let outputPrice = Math.max(model.pricing.completion, model.pricing.internal_reasoning ?? 0);
  for (const tier of model.pricing.overrides ?? []) if (inputBound >= tier.min_prompt_tokens) {
    promptPrice = Math.max(promptPrice, tier.prompt ?? 0);
    outputPrice = Math.max(outputPrice, tier.completion ?? 0);
  }
  const providerLimit = model.top_provider?.max_completion_tokens ?? targetOutputTokens;
  if (providerLimit < minimumOutputTokens) throw new ApiError(503, 'model_output_limit');
  const contextLimit = Math.floor((model.context_length - inputBound) / 2);
  if (contextLimit < minimumOutputTokens) throw new ApiError(400, 'model_context_limit');
  // Keep the full input. Adapt output capacity within the fixed request cap, retaining
  // enough room for the five concise documents and changed intake fields.
  const inputCost = inputBound * promptPrice + (model.pricing.request ?? 0);
  const remainingBudget = LIMITS.requestMicros / 1e6 - inputCost - 0.0001;
  const budgetLimit = outputPrice > 0 ? Math.floor(remainingBudget / (2 * outputPrice)) : Infinity;
  if (remainingBudget < 0 || budgetLimit < minimumOutputTokens) throw new ApiError(400, 'request_budget_exceeded');
  const outputTokens = Math.min(targetOutputTokens, providerLimit, contextLimit, budgetLimit, outputTokenLimit ?? targetOutputTokens);
  if (outputTokens < minimumOutputTokens) throw new ApiError(400, 'request_budget_exceeded');
  // Some providers count reasoning separately. Reserve a second complete output budget.
  const micros = Math.ceil((inputBound * promptPrice + outputTokens * 2 * outputPrice + (model.pricing.request ?? 0)) * 1e6);
  if (micros > LIMITS.requestMicros) throw new ApiError(400, 'request_budget_exceeded');
  const body: Record<string, unknown> = {
    model: model.id, messages, stream: false, max_tokens: outputTokens,
    response_format: { type: 'json_schema', json_schema: { name: task === 'draft' ? 'clinician_draft' : 'clinician_turn', strict: true, schema } },
    provider: { require_parameters: true, allow_fallbacks: false, max_price: { prompt: promptPrice * 1e6, completion: outputPrice * 1e6, request: model.pricing.request ?? 0 } },
  };
  if (model.supported_parameters.includes('reasoning')) {
    body.reasoning = { effort: model.reasoning?.supported_efforts?.includes('low') ? 'low' : 'minimal', exclude: true };
  }
  if (model.supported_parameters.includes('temperature')) body.temperature = 0.2;
  return { body, micros, inputBound, outputTokens };
}

const envelopeSchema = z.object({
  id: z.string(), model: z.string(), choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable() }), error: z.unknown().optional() })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), cost: z.number().nonnegative().finite().optional() }).optional(),
});
export interface ProviderReply { raw: unknown; model: string; usage?: { input: number; output: number; cost?: number }; costMicros?: number }
export class ProviderError extends ApiError { constructor(code: string, public costMicros?: number) { super(502, code); } }
export async function callProvider(key: string, body: Record<string, unknown>, expectedModel: CatalogModel, fetcher: typeof fetch = fetch): Promise<ProviderReply> {
  let parsed: z.infer<typeof envelopeSchema>;
  try {
    const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Fictional clinician demo' }, body: JSON.stringify(body), signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), redirect: 'error' });
    if (!response.ok) {
      // Classify upstream failures without logging prompts, credentials or upstream free text.
      let category = 'unclassified';
      try {
        const problem = await boundedJson(response, 32000) as { error?: { message?: string; metadata?: { raw?: string } } };
        const message = `${problem.error?.message ?? ''} ${problem.error?.metadata?.raw ?? ''}`.toLowerCase();
        category = /credit|balance|payment|fund/.test(message) ? 'credits'
          : /schema|response_format/.test(message) ? 'schema'
            : /max_price|pricing|price limit/.test(message) ? 'price_filter'
              : /reasoning|effort|temperature|max_tokens/.test(message) ? 'model_parameter'
                : /no endpoints|no provider|available provider/.test(message) ? 'routing'
                  : /key|unauthoriz|authenticat/.test(message) ? 'authentication' : 'unclassified';
      } catch { /* No upstream content is persisted or returned. */ }
      throw new ProviderError(`provider_http_${response.status}_${category}`);
    }
    const envelope = envelopeSchema.safeParse(await boundedJson(response, 500_000));
    if (!envelope.success) throw new ProviderError('invalid_provider_response');
    parsed = envelope.data;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('provider_outcome_uncertain');
  }
  const costMicros = parsed.usage?.cost === undefined ? undefined : Math.ceil(parsed.usage.cost * 1e6);
  if (parsed.model !== expectedModel.id && parsed.model !== expectedModel.canonical_slug) throw new ProviderError('unexpected_response_model', costMicros);
  const choice = parsed.choices[0];
  if (choice.finish_reason !== 'stop' || choice.error || !choice.message.content) throw new ProviderError('incomplete_model_output', costMicros);
  let raw: unknown;
  try { raw = JSON.parse(choice.message.content); } catch { throw new ProviderError('invalid_model_json', costMicros); }
  return { raw, model: parsed.model, costMicros, usage: parsed.usage ? { input: parsed.usage.prompt_tokens, output: parsed.usage.completion_tokens, ...(parsed.usage.cost === undefined ? {} : { cost: parsed.usage.cost }) } : undefined };
}

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createDemoState } from '../fixtures/fictional/index';
import { addUserMessage, buildContext, createSession } from '../packages/domain/index';
import { DEFAULT_MODEL, MODELS } from '../packages/contracts/index';

// Explicit invocation only. One paid request; never retries or silently changes model.
const model = process.argv.find(a => a.startsWith('--model='))?.slice(8) ?? DEFAULT_MODEL;
const task = process.argv.includes('--draft') ? 'draft' : 'turn';
if (!MODELS.some(item => item.id === model)) throw new Error('Select one of the application models.');
const codeFile = process.env.DEMO_CODE_FILE;
if (!codeFile) throw new Error('Set DEMO_CODE_FILE to a private access-code file. Provider keys are never read here.');
const base = process.env.DEMO_API_URL ?? 'https://iser-clinician-api.vercel.app';
const auth = await fetch(`${base}/api/access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: (await readFile(codeFile, 'utf8')).trim() }) });
const access = await auth.json();
if (!auth.ok) throw new Error(`Access failed: ${access.error ?? auth.status}`);
const created = createSession(createDemoState(), 'fictional-noa', 'fictional-noa-main', 5);
const state = addUserMessage(created.state, created.session.id, 'נועה סיפרה שקיבלה תשובה קצרה מהמנחה ונפתחה אצלה שאלה חדשה על המשך הכתיבה. ביקשתי שתתאר את הרגע שבו קראה את התשובה. היא סיפרה שהניחה את הטלפון וחזרה אליו אחר כך. לא נמסרה משמעות שהייתה לרגע הזה עבורה. להדרכה בלבד: אני רוצה לבדוק את הנטייה שלי להציע הסבר מהר מדי.');
const context = buildContext(state, created.session.id, task === 'draft' ? 'draft' : 'main');
const requestId = crypto.randomUUID(); const started = Date.now();
const response = await fetch(`${base}/api/${task}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.token}` }, body: JSON.stringify({ requestId, model, context }), signal: AbortSignal.timeout(65000) });
const body = await response.json().catch(() => ({ error: 'non_json_response' }));
const evidence = { date: new Date().toISOString(), model, task, requestId, status: response.status, elapsedMs: Date.now() - started, fictional: true, response: body };
const folder = `Verification_${new Date().toISOString().slice(0, 10)}`; await mkdir(folder, { recursive: true });
const file = `${folder}/live-${model.replace(/[\/.]/g, '-')}-${task}-${Date.now()}.json`;
await writeFile(file, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ status: response.status, model, task, elapsedMs: evidence.elapsedMs, error: body.error, action: body.result?.action, utterance: body.result?.utterance, documents: body.result?.documents?.length, usage: body.usage, evidence: file }, null, 2));
if (!response.ok) process.exitCode = 1;

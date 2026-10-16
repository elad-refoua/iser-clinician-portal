import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { buildSystemPrompt, PROMPT_VERSION } from '../packages/prompts/index.ts';
import type { ContextPacket } from '../packages/contracts/index.ts';
import { syncPrompts } from './sync-prompts.ts';

syncPrompts(true);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(root, 'Prompt_Workbench_2026-10-16');
const publicDir = resolve(root, 'apps/web/public');
const files = [
  { source: 'README.md', output: 'prompt-workbench-guide.md', id: 'editing', title: 'איך עורכים ומפעילים' },
  { source: 'PROMPTS.md', output: 'prompts.md', id: 'prompts', title: 'כל הפרומפטים — מקור לעריכה' },
  { source: 'CONTEXT.md', output: 'context-management.md', id: 'context', title: 'ניהול ההקשר — מסמך נפרד' },
];
const font = await readFile(resolve(root, 'docs/handbook/2026-10-16/assets/NotoSansHebrew.ttf'));
const css = (await readFile(resolve(root, 'docs/handbook/2026-10-16/handbook.css'), 'utf8')).replace('{{FONT_BASE64}}', font.toString('base64'));
const hashes: { path: string; sha256: string }[] = [];
const chapters: string[] = [];
await mkdir(publicDir, { recursive: true });
for (const file of files) {
  const source = await readFile(resolve(sourceDir, file.source), 'utf8');
  hashes.push({ path: `Prompt_Workbench_2026-10-16/${file.source}`, sha256: createHash('sha256').update(source).digest('hex') });
  await writeFile(resolve(publicDir, file.output), source, 'utf8');
  const article = (await marked.parse(source)).replace(/<h([1-5])>/g, (_, level) => `<h${Number(level) + 1}>`).replace(/<\/h([1-5])>/g, (_, level) => `</h${Number(level) + 1}>`);
  chapters.push(`<section class="chapter" id="${file.id}" aria-label="${file.title}"><p><a class="button" href="${file.output}" download>הורדת ${file.source} לעריכה</a></p>${article}</section>`);
}
const example: ContextPacket = {
  patientId: 'fictional-workbench', patientName: 'דוגמה טכנית ריקה', branchId: 'example-main',
  sessionId: 'example-session-4', sessionNumber: 4, baseRevision: 0, asOf: '2026-10-16T00:00:00.000Z',
  stage: 'main', questionCount: 0, intakeCount: 0, intakeRound: 0,
  branchScope: [{ branchId: 'example-main', throughSession: 4 }], preferences: [], skippedTopics: [], sources: [], documents: [], messages: [],
};
for (const task of ['turn', 'draft'] as const) {
  await writeFile(resolve(publicDir, `${task}-prompt-example.txt`), buildSystemPrompt({ ...example, stage: task === 'draft' ? 'draft' : 'main' }, task), 'utf8');
}
const fingerprint = createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="prompt-version" content="${PROMPT_VERSION}"><meta name="workbench-source-sha256" content="${fingerprint}"><title>מרווח — עבודה על הפרומפטים וההקשר</title><style>${css}
.page-end{overflow-wrap:anywhere}
.cover{padding:36px 24px 28px}.cover h1{font-size:clamp(30px,4vw,44px);margin-bottom:12px}.cover .subtitle{font-size:19px;margin:12px 0}.layout{gap:24px;padding-inline:24px}.chapter{margin-top:28px;padding-top:28px}main{padding:28px}main h2{font-size:26px;margin-bottom:16px}main h3{font-size:21px;margin-top:24px}main h4{font-size:18px;margin-top:20px}.actions{gap:8px}.scope-note{margin-top:16px}.downloads{display:flex;gap:8px;flex-wrap:wrap}.chapter:target{scroll-margin-top:18px}@media(max-width:850px){.layout{display:block;padding-inline:16px}.toc{position:static;max-height:none;padding:16px 0}.toc ol{display:flex;gap:12px;flex-wrap:wrap}main{padding:20px}.cover{padding:24px 16px}.topbar{padding:14px 16px}}
</style></head><body><a class="skip" href="#content">דילוג לתוכן</a><header class="topbar"><a class="brand" href="./">מרווח</a><div class="actions"><a class="button" href="handbook.html">ספר ההפעלה</a><a class="button" href="./">חזרה למערכת</a></div></header><div class="cover"><h1>עבודה על הפרומפטים וההקשר</h1><p class="subtitle">מקור ההוראות לעריכה, הסבר ניהול ההקשר בנפרד, והדרך להפוך שינוי לגרסה פעילה.</p><p>גרסת הוראות <bdi>${PROMPT_VERSION}</bdi></p><div class="downloads"><a class="button" href="prompts.md" download>הורדת כל הפרומפטים</a><a class="button" href="context-management.md" download>הורדת ניהול ההקשר</a><a class="button" href="turn-prompt-example.txt" download>דוגמת הוראות שיחה</a><a class="button" href="draft-prompt-example.txt" download>דוגמת הוראות טיוטה</a></div><p class="scope-note">PROMPTS.md הוא מקור לעריכה. הורדת קובץ או שינוי מקומי אינם משנים את האתר הפעיל עד סנכרון, בדיקה ופרסום. דוגמאות ההפעלה משתמשות בהקשר טכני ריק, ללא מידע מתיק.</p></div><div class="layout"><nav class="toc" aria-label="חלקי חבילת העבודה"><h2>בחבילת העבודה</h2><ol>${files.map(file => `<li><a href="#${file.id}">${file.title}</a></li>`).join('')}</ol></nav><main id="content">${chapters.join('')}</main></div><footer class="page-end">חתימת מקור: <bdi>${fingerprint}</bdi></footer></body></html>`;
await writeFile(resolve(publicDir, 'prompt-workbench.html'), html, 'utf8');
const outputs = await Promise.all([...files.map(file => file.output), 'turn-prompt-example.txt', 'draft-prompt-example.txt', 'prompt-workbench.html'].map(async name => ({ path: `apps/web/public/${name}`, sha256: createHash('sha256').update(await readFile(resolve(publicDir, name))).digest('hex') })));
await writeFile(resolve(sourceDir, 'build-manifest.json'), JSON.stringify({ promptVersion: PROMPT_VERSION, sourceSha256: fingerprint, sourceFiles: hashes, outputs }, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ promptVersion: PROMPT_VERSION, sourceSha256: fingerprint, outputs: files.length + 3 }));

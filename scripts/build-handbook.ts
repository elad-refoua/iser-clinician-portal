import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { PROMPT_SECTIONS, PROMPT_VERSION, buildSystemPrompt } from '../packages/prompts/index.ts';
import { intakeFields, intakeSections, fieldStatusLabels } from '../packages/prompts/intake-schema.ts';
import { MODELS, type ContextPacket } from '../packages/contracts/index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(root, 'docs/handbook/2026-10-16');
const publicDir = resolve(root, 'apps/web/public');
const sourceFiles = [
  'docs/handbook/2026-10-16/handbook.md',
  'docs/handbook/2026-10-16/metadata.json',
  'docs/handbook/2026-10-16/release-evidence.md',
  'Verification_2026-10-16/AI_SYSTEMS_RESEARCH.md',
  'docs/handbook/2026-10-16/handbook.css',
  'packages/prompts/index.ts', 'packages/prompts/intake-schema.ts',
  'packages/prompts/authored.generated.ts', 'packages/prompts/template.ts',
  'Prompt_Workbench_2026-10-16/README.md', 'Prompt_Workbench_2026-10-16/PROMPTS.md', 'Prompt_Workbench_2026-10-16/CONTEXT.md',
  'scripts/prompt-source.ts', 'scripts/sync-prompts.ts', 'scripts/build-prompt-workbench.ts',
  'apps/web/IntakeCompletion.tsx', 'apps/web/intake-completion.css', 'apps/web/proposal-diff.ts',
  'packages/domain/intake-readiness.ts', 'tests/intake-readiness.test.ts', 'tests/proposal-diff.test.ts',
  'tests/prompt-authoring.test.ts', 'tests/prompts.test.ts',
  'tests/native-server-imports.test.ts',
  'tests/provider-runtime.test.ts', 'tests/long-case-fixture.ts', 'tests/api-budget.test.ts',
  'tests/legacy-intake-traces.test.ts',
  'Verification_2026-10-16/PORTAL_DESIGN_SKILLS_RESEARCH.md',
  'packages/contracts/index.ts', 'packages/domain/index.ts',
  'packages/domain/intake-report.ts', 'packages/transport/workspace.ts',
  'apps/web/App.tsx', 'apps/web/Documents.tsx', 'apps/web/Backstage.tsx', 'apps/web/ui.tsx',
  'apps/web/NewPatient.tsx', 'apps/web/workspace-sync.ts', 'apps/web/workspace-choice.ts', 'apps/web/workspace-state.ts', 'apps/web/document-editing.ts',
  'apps/web/LoginScreen.tsx', 'apps/web/CaseWelcome.tsx', 'apps/web/ResponseExplainer.tsx', 'apps/web/experience-model.ts',
  'apps/web/SessionConversation.tsx', 'apps/web/ReviewProposal.tsx', 'apps/web/workflow-guards.ts', 'apps/web/api-errors.ts', 'apps/web/model-retry.ts',
  'apps/web/chat-workflow.css', 'apps/web/patient-portal.css',
  'tests/staged-records.test.ts', 'tests/context-budget.test.ts', 'tests/context-integrity.test.ts', 'tests/workflow-guards.test.ts',
  'tests/document-editing.test.ts', 'tests/server-only-workflow.test.ts', 'tests/session-conversation.test.ts', 'tests/workspace-sync.test.ts', 'tests/workspace.test.ts', 'tests/model-retry.test.ts',
  'apps/web/login.css', 'apps/web/experience.css', 'apps/web/styles.css',
  'tests/api.test.ts', 'tests/quota-limits.test.ts', 'tests/wire-field-schema.test.ts', 'tests/experience-model.test.ts', 'tests/prompt-behavior.test.ts',
  'apps/api/handler.ts', 'apps/api/auth.ts', 'apps/api/errors.ts', 'apps/api/quota.ts', 'apps/api/provider.ts', 'apps/api/validation.ts',
  'apps/api/workspace.ts', 'apps/api/workspace-store.ts', 'api/workspace.ts',
  'vercel.json', '.github/workflows/pages.yml', 'vite.config.ts', 'vitest.config.ts', 'package.json', 'package-lock.json', '.env.example', 'README.md',
  'apps/api/README.md', 'apps/web/README.md', 'packages/prompts/README.md',
  'scripts/build-handbook.ts', 'docs/handbook/2026-10-16/assets/NotoSansHebrew.ttf',
];
const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const sourceEntries = await Promise.all(sourceFiles.map(async path => ({ path, sha256: hash(await readFile(resolve(root, path))) })));
const sourceHash = hash(JSON.stringify(sourceEntries));
const meta = JSON.parse(await readFile(resolve(sourceDir, 'metadata.json'), 'utf8')) as { title: string; version: string; date: string; repository: string; website: string; api: string };
const font = await readFile(resolve(sourceDir, 'assets/NotoSansHebrew.ttf'));
const css = (await readFile(resolve(sourceDir, 'handbook.css'), 'utf8')).replace('{{FONT_BASE64}}', font.toString('base64'));
const sampleContext: ContextPacket = {
  patientId: 'fictional-handbook-example', patientName: 'דוגמה טכנית בדיונית',
  branchId: 'example-main', sessionId: 'example-session-5', sessionNumber: 5,
  baseRevision: 0, asOf: '2026-10-16T09:00:00.000Z', stage: 'main',
  questionCount: 0, intakeCount: 0, intakeRound: 0,
  branchScope: [{ branchId: 'example-main', throughSession: 5 }],
  preferences: [], skippedTopics: [], sources: [], documents: [], messages: [],
};
const paragraphBlock = (content: string) => `<div class="prompt-block">${content.split('\n').map(line => `<p>${escape(line)}</p>`).join('')}</div>`;
const dynamicPrompt = (task: 'turn' | 'draft') => {
  const prompt = buildSystemPrompt({ ...sampleContext, stage: task === 'draft' ? 'draft' : 'main' }, task);
  const start = prompt.indexOf('## בקרת הבקשה');
  if (start < 0) throw new Error('Prompt control heading changed: review the handbook builder.');
  return paragraphBlock(prompt.slice(start));
};
const statuses: Record<string, string> = {
  documented: 'יש מידע מפורש המספיק לתיאור השדה.',
  partial: 'יש מידע, אך חלק נשאר פתוח ומופיע ב־remaining.',
  unknown: 'אין מידע על השדה, לרבות אמירה שלא נמסר מידע; אין כאן ממצא שלילי או ראיה שלא נבדק.',
  not_assessed: 'נמסר במפורש שהנושא לא נבדק.',
  not_recalled: 'נמסר במפורש שהפרט אינו זכור כעת.',
  conflict: 'מקורות אינם מתיישבים והפער טרם הוכרע.',
  not_applicable: 'נמסר בסיס מפורש לכך שהשדה אינו רלוונטי.',
};
const statusTable = '| מצב | מזהה בקוד | משמעות |\n|---|---|---|\n' + Object.entries(fieldStatusLabels).map(([id, label]) => `| ${label} | \`${id}\` | ${statuses[id]} |`).join('\n');
const intakeTable = '| חלק בדוח | מספר ושם השדה |\n|---|---|\n' + intakeSections.flatMap(section => section.fieldIds.map(id => `| ${section.title} | ${id}. ${intakeFields.find(field => field.id === id)!.label} |`)).join('\n');
const modelTable = '| מודל | מזהה מדויק |\n|---|---|\n' + MODELS.map(model => `| ${model.label} | \`${model.id}\` |`).join('\n');
const contracts = await readFile(resolve(root, 'packages/contracts/index.ts'), 'utf8');
const readme = (await readFile(resolve(root, 'README.md'), 'utf8')).replaceAll('\r\n', '\n');
const adopterStart = readme.indexOf('## התקנת עותק עצמאי\n');
const adopterEnd = readme.indexOf('\n## אחסון, סודות ופרסום', adopterStart);
if (adopterStart < 0 || adopterEnd < 0) throw new Error('Adopter setup section changed in README.md: review the handbook builder.');
const adopterSetup = readme.slice(adopterStart + '## התקנת עותק עצמאי\n'.length, adopterEnd).trim()
  .replace(/\]\((?![a-z][a-z0-9+.-]*:|#)([^)]+)\)/gi, (_match, path: string) => `](${meta.repository}/blob/main/${path})`);
const links = [
  ['תוכנית האב', 'Planning_2026-10-16/MASTER_PLAN_HE.md'],
  ['המשך עבודה ומצב ביצוע', 'Implementation_2026-10-18/CONTINUE_HERE.md'],
  ['README הממשק', 'apps/web/README.md'], ['README השרת', 'apps/api/README.md'],
  ['README ההוראות', 'packages/prompts/README.md'], ['לוגיקת הדומיין', 'packages/domain/index.ts'],
  ['כל הפרומפטים לעריכה', 'Prompt_Workbench_2026-10-16/PROMPTS.md'], ['ניהול ההקשר בנפרד', 'Prompt_Workbench_2026-10-16/CONTEXT.md'],
  ['מקור הספר והוראות הבנייה', 'docs/handbook/README.md'],
].map(([label, path]) => `- [${label}](${meta.repository}/blob/main/${path}) — \`${path}\``).join('\n');
let markdown = await readFile(resolve(sourceDir, 'handbook.md'), 'utf8');
const substitutions: Record<string, string> = {
  FIELD_STATUSES: statusTable, INTAKE_SCHEMA: intakeTable, MODELS: modelTable, ADOPTER_SETUP: adopterSetup,
  PROMPT_VERSION, PROMPT_SECTION_COUNT: String(PROMPT_SECTIONS.length), RELEASE_EVIDENCE: await readFile(resolve(sourceDir, 'release-evidence.md'), 'utf8'),
  PROMPT_SECTIONS: PROMPT_SECTIONS.map(section => `### ${section.title}\n\n${paragraphBlock(section.content)}`).join('\n\n'),
  TURN_CONTRACT: dynamicPrompt('turn'), DRAFT_CONTRACT: dynamicPrompt('draft'),
  CONTRACTS: `\`\`\`typescript\n${contracts}\n\`\`\``, SOURCE_LINKS: links,
};
for (const [key, value] of Object.entries(substitutions)) markdown = markdown.replaceAll(`{{${key}}}`, value);
if (/\{\{[A-Z_]+\}\}/.test(markdown)) throw new Error('Unresolved handbook marker.');
let article = await marked.parse(markdown);
const toc: { id: string; text: string }[] = [];
article = article.replace(/<h2>([\s\S]*?)<\/h2>/g, (_whole, heading: string) => {
  const id = `chapter-${toc.length + 1}`;
  toc.push({ id, text: heading.replace(/<[^>]+>/g, '') });
  return `${toc.length > 1 ? '</section>' : ''}<section class="chapter" aria-labelledby="${id}"><h2 id="${id}">${heading}</h2>`;
});
article += '</section>';
const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="ספר ההפעלה של מרווח: תיעוד פגישה, הקשר, פרומפטים, התקנה והמשך פיתוח בסביבה בדיונית."><meta name="handbook-version" content="${escape(meta.version)}"><meta name="handbook-source-sha256" content="${sourceHash}"><title>${escape(meta.title)}</title><style>${css}</style></head>
<body><a class="skip" href="#content">דילוג לתוכן הספר</a><header class="topbar"><a class="brand" href="./">מרווח</a><div class="actions"><a class="button" href="./">חזרה למערכת</a><a class="button" href="handbook.pdf" download>הורדת PDF</a><button class="button" onclick="window.print()">הדפסה</button></div></header>
<div class="cover"><div class="eyebrow">מרווח · תיעוד פגישה בקצב שלך</div><h1>ספר ההפעלה</h1><p class="subtitle">מההתנסות הראשונה ועד להבנת ההקשר,<br>ההוראות והקוד שמפעילים את המערכת.</p><div class="cover-meta"><span>מהדורה ${escape(meta.version)}</span><span>${escape(meta.date)}</span><span>גרסת הוראות ${escape(PROMPT_VERSION)}</span></div><div class="scope-note"><strong>סביבת הדגמה בחומר בדיוני בלבד.</strong><br>הספר מסביר את המימוש והגבולות שלו. הוא אינו אישור לשימוש קליני או עדות לכך שכל מסלול חי נבדק.</div><p class="fingerprint">חתימת מקור משותפת ל־HTML ול־PDF<br><bdi dir="ltr">${sourceHash}</bdi></p></div>
<div class="layout"><nav class="toc" aria-label="תוכן עניינים"><h2>תוכן העניינים</h2><ol>${toc.map(item => `<li><a href="#${item.id}">${item.text}</a></li>`).join('')}</ol></nav><main id="content">${article}</main></div><footer class="page-end">מרווח · מהדורה ${escape(meta.version)} · מקור משותף לאתר ול־PDF · כל הדוגמאות בדיוניות</footer></body></html>`;
await mkdir(publicDir, { recursive: true });
const htmlPath = resolve(publicDir, 'handbook.html');
const pdfPath = resolve(publicDir, 'handbook.pdf');
await writeFile(htmlPath, html, 'utf8');
if (process.argv.includes('--html-only')) {
  console.log(`HTML preview only: ${htmlPath}. PDF was not updated; do not release this pair.`);
  process.exit(0);
}
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require(process.env.PUPPETEER_MODULE_PATH || 'puppeteer'); }
catch { throw new Error('Puppeteer is required for the matching PDF. Install it or set PUPPETEER_MODULE_PATH to an existing installation; see docs/handbook/README.md.'); }
const browser = await puppeteer.launch({ headless: true, ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}), args: ['--font-render-hinting=none'] });
let layoutCheck;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  layoutCheck = await page.evaluate(() => ({
    headings: document.querySelectorAll('main h2').length,
    tocLinks: document.querySelectorAll('.toc a').length,
    brokenAnchors: [...document.querySelectorAll<HTMLAnchorElement>('.toc a')].filter(a => !document.getElementById(a.hash.slice(1))).length,
    desktopOverflow: document.documentElement.scrollWidth > window.innerWidth,
    loadedFonts: document.fonts.check('16px HandbookHebrew'),
  }));
  await page.setViewport({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  layoutCheck = { ...layoutCheck, mobileOverflow };
  if (layoutCheck.brokenAnchors || layoutCheck.desktopOverflow || mobileOverflow || !layoutCheck.loadedFonts) throw new Error(`Handbook layout checks failed: ${JSON.stringify(layoutCheck)}`);
  await page.emulateMediaType('print');
  await page.pdf({ path: pdfPath, format: 'A4', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#5b6f69;padding:0 17mm;display:flex;justify-content:space-between"><span>Mervach · ${escape(meta.version)} · ${sourceHash.slice(0, 12)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
} finally { await browser.close(); }
const manifest = { version: meta.version, promptVersion: PROMPT_VERSION, sourceSha256: sourceHash, generatedAt: new Date().toISOString(), sourceFiles: sourceEntries,
  outputs: [{ path: 'apps/web/public/handbook.html', sha256: hash(await readFile(htmlPath)) }, { path: 'apps/web/public/handbook.pdf', sha256: hash(await readFile(pdfPath)) }],
  localArtifactChecks: layoutCheck,
  verificationBoundary: 'Local artifact font, anchors and width checks only. Does not verify the deployed website, live API, model quality or every PDF page visually.',
};
await writeFile(resolve(sourceDir, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ version: meta.version, promptVersion: PROMPT_VERSION, sourceSha256: sourceHash, htmlPath, pdfPath, layoutCheck }, null, 2));

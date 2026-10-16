import { interpolatePrompt } from '../packages/prompts/template.js';

export const SECTION_IDS = [
  'role', 'interview', 'contextual-question', 'visible-explanation', 'revision', 'evidence',
  'preferences', 'goals', 'intake', 'working-memory', 'examples',
] as const;
const BLOCK_IDS = ['version', ...SECTION_IDS, 'turn-contract', 'draft-contract', 'request-control', 'assembly'];
const REQUIRED_PLACEHOLDERS: Record<string, string[]> = {
  intake: ['INTAKE_FIELDS', 'INTAKE_SECTIONS'],
  'request-control': ['CONTROL_JSON'],
  assembly: ['VERSION', 'SECTIONS', 'REQUEST_CONTROL', 'TASK', 'CONTRACT'],
};

export interface AuthoredPrompts {
  version: string;
  sections: Array<{ id: string; title: string; content: string }>;
  contracts: { turn: string; draft: string };
  requestControl: string;
  assembly: string;
}

/** Stable marker IDs are code interfaces; all wording inside them is editable. */
export function parsePromptSource(markdown: string): AuthoredPrompts {
  const blocks = new Map<string, string>();
  let active: string | undefined;
  let lines: string[] = [];
  for (const [index, line] of markdown.replace(/\r\n?/g, '\n').split('\n').entries()) {
    const marker = line.match(/^<!-- (BEGIN|END) prompt:([a-z][a-z0-9-]*) -->$/);
    if (!marker) {
      if (/<!--.*(?:prompt\s*:|\b(?:BEGIN|END)\s+prompt\b)/i.test(line)) {
        throw new Error(`Malformed prompt marker at line ${index + 1}`);
      }
      if (active) lines.push(line);
      continue;
    }
    const [, edge, id] = marker;
    if (!BLOCK_IDS.includes(id)) throw new Error(`Unknown prompt block: ${id}`);
    if (edge === 'BEGIN') {
      if (active) throw new Error(`Nested prompt block: ${id}`);
      if (blocks.has(id)) throw new Error(`Duplicate prompt block: ${id}`);
      active = id;
      lines = [];
    } else {
      if (active !== id) throw new Error(`Mismatched prompt end: ${id}`);
      const body = lines.join('\n').trim();
      if (!body) throw new Error(`Empty prompt block: ${id}`);
      blocks.set(id, body);
      active = undefined;
    }
  }
  if (active) throw new Error(`Unclosed prompt block: ${active}`);
  for (const id of BLOCK_IDS) {
    if (!blocks.has(id)) throw new Error(`Missing prompt block: ${id}`);
    const text = blocks.get(id)!;
    const required = REQUIRED_PLACEHOLDERS[id] ?? [];
    const tokens = [...text.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)].map(match => match[1]);
    for (const token of required) {
      if (tokens.filter(value => value === token).length !== 1) {
        throw new Error(`Prompt block ${id} requires exactly one {{${token}}}`);
      }
    }
    interpolatePrompt(text, Object.fromEntries(required.map(token => [token, ''])));
  }
  const version = blocks.get('version')!;
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(version)) throw new Error('Invalid prompt version');
  const sections = SECTION_IDS.map(id => {
    const match = blocks.get(id)!.match(/^## ([^\n]+)\n([\s\S]+)$/);
    if (!match || !match[1].trim() || !match[2].trim()) throw new Error(`Prompt section ${id} requires a heading and body`);
    if (/\{\{|\}\}/.test(match[1])) throw new Error(`Prompt section ${id} title cannot contain placeholders`);
    return { id, title: match[1].trim(), content: match[2].trim() };
  });
  return { version, sections, contracts: { turn: blocks.get('turn-contract')!, draft: blocks.get('draft-contract')! },
    requestControl: blocks.get('request-control')!, assembly: blocks.get('assembly')! };
}

export function compilePromptSource(markdown: string): string {
  const data = parsePromptSource(markdown);
  return '// Generated from Prompt_Workbench_2026-10-16/PROMPTS.md. Do not edit.\n'
    + '// Run: npx tsx scripts/sync-prompts.ts\n'
    + `export const AUTHORED_PROMPTS = ${JSON.stringify(data, null, 2)};\n`;
}

export function assertPromptParity(compiled: string, runtime: string | undefined): void {
  if (runtime?.replace(/\r\n/g, '\n') !== compiled) {
    throw new Error('Prompt source/runtime drift. Run npx tsx scripts/sync-prompts.ts and commit both files.');
  }
}

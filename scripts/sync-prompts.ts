import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPromptParity, compilePromptSource } from './prompt-source.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = resolve(root, 'Prompt_Workbench_2026-10-16/PROMPTS.md');
const generatedPath = resolve(root, 'packages/prompts/authored.generated.ts');

export function syncPrompts(check = false): 'current' | 'updated' {
  const generated = compilePromptSource(readFileSync(sourcePath, 'utf8'));
  let current: string | undefined;
  try { current = readFileSync(generatedPath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (check) { assertPromptParity(generated, current); return 'current'; }
  if (current?.replace(/\r\n/g, '\n') === generated) return 'current';
  writeFileSync(generatedPath, generated, 'utf8');
  return 'updated';
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Usage: tsx scripts/sync-prompts.ts [--check]');
    console.log(`Prompts ${syncPrompts(args.includes('--check'))}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Prompt synchronization failed.');
    process.exitCode = 1;
  }
}

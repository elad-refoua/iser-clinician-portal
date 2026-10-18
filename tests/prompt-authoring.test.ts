import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHORED_PROMPTS } from '../packages/prompts/authored.generated';
import { PROMPT_SECTIONS, PROMPT_TEMPLATES, PROMPT_VERSION } from '../packages/prompts';
import { intakeFields, intakeSections } from '../packages/prompts/intake-schema';
import { interpolatePrompt } from '../packages/prompts/template';
import { assertPromptParity, compilePromptSource, parsePromptSource, SECTION_IDS } from '../scripts/prompt-source';
import { syncPrompts } from '../scripts/sync-prompts';

const source = readFileSync(new URL('../Prompt_Workbench_2026-10-16/PROMPTS.md', import.meta.url), 'utf8');
const generatedPath = new URL('../packages/prompts/authored.generated.ts', import.meta.url);
const block = (id: string, body: string) => `<!-- BEGIN prompt:${id} -->\n${body}\n<!-- END prompt:${id} -->`;

describe('authoritative editable prompt source', () => {
  it('compiles exactly to the committed runtime data and passes the non-writing parity check', () => {
    const before = readFileSync(generatedPath, 'utf8');
    expect(compilePromptSource(source)).toBe(before.replace(/\r\n/g, '\n'));
    expect(parsePromptSource(source)).toEqual(AUTHORED_PROMPTS);
    expect(syncPrompts(true)).toBe('current');
    expect(readFileSync(generatedPath, 'utf8')).toBe(before);
    expect(PROMPT_VERSION).toBe(AUTHORED_PROMPTS.version);
  });

  it('includes all eleven separately editable sections, both contracts, control, and assembly', () => {
    const parsed = parsePromptSource(source);
    expect(parsed.sections.map(section => section.id)).toEqual(SECTION_IDS);
    expect(parsed.sections).toHaveLength(11);
    expect(PROMPT_TEMPLATES).toEqual({ turnContract: parsed.contracts.turn, draftContract: parsed.contracts.draft,
      requestControl: parsed.requestControl, assembly: parsed.assembly });
    expect(parsed.sections.find(section => section.id === 'intake')!.content).toContain('{{INTAKE_FIELDS}}');
    expect(parsed.requestControl).toContain('{{CONTROL_JSON}}');
    expect(parsed.assembly).toContain('{{TASK}}');
    expect(parsed.sections[0].content).not.toContain('npx tsx');
  });

  it('makes author edits change the compilation and leaves editor-only instructions outside runtime data', () => {
    const original = compilePromptSource(source);
    expect(compilePromptSource(source.replace('## תפקיד, שפה וגבולות', '## תפקיד ותיעוד'))).not.toBe(original);
    expect(compilePromptSource('הערת עורך שאינה הוראת מודל\n' + source)).toBe(original);
    expect(compilePromptSource(source.replace(/\r?\n/g, '\r\n'))).toBe(original);
  });

  it('fails the check used by --check when source changed, output is missing, or generated instructions were edited', () => {
    const original = compilePromptSource(source);
    const updated = compilePromptSource(source.replace('## תפקיד, שפה וגבולות', '## תפקיד ותיעוד'));
    expect(() => assertPromptParity(updated, original)).toThrow('Prompt source/runtime drift');
    expect(() => assertPromptParity(original, undefined)).toThrow('Prompt source/runtime drift');
    expect(() => assertPromptParity(original, original.replace('2026-10-18.1', '2026-10-18.99'))).toThrow('Prompt source/runtime drift');
    expect(() => assertPromptParity(original, original.replace(/\n/g, '\r\n'))).not.toThrow();
  });

  it('interpolates canonical fields and sections rather than storing a second editable schema copy', () => {
    const intake = PROMPT_SECTIONS.find(section => section.id === 'intake')!.content;
    for (const field of intakeFields) expect(intake).toContain(`${field.id}. ${field.label}`);
    for (const section of intakeSections) expect(intake).toContain(`${section.title}: ${section.fieldIds.join(', ')}`);
    expect(intake).not.toContain('{{INTAKE_');
  });

  it.each([
    ['missing', (text: string) => text.replace(/<!-- BEGIN prompt:role -->[\s\S]*?<!-- END prompt:role -->/, ''), /Missing prompt block: role/],
    ['duplicate', (text: string) => text + '\n' + block('role', '## תפקיד\nכפול'), /Duplicate prompt block: role/],
    ['nested', (text: string) => text.replace('<!-- BEGIN prompt:role -->', '<!-- BEGIN prompt:role -->\n<!-- BEGIN prompt:intake -->'), /Nested prompt block/],
    ['mismatched', (text: string) => text.replace('<!-- END prompt:role -->', '<!-- END prompt:intake -->'), /Mismatched prompt end/],
    ['unclosed', (text: string) => text.replace('<!-- END prompt:assembly -->', ''), /Unclosed prompt block/],
    ['malformed', (text: string) => text.replace('<!-- END prompt:role -->', '<!-- END prompt:role-->'), /Malformed prompt marker/],
    ['unknown', (text: string) => text + '\n' + block('new-policy', 'תוכן'), /Unknown prompt block/],
    ['empty', (text: string) => text.replace(/<!-- BEGIN prompt:version -->[\s\S]*?<!-- END prompt:version -->/, block('version', '')), /Empty prompt block/],
    ['heading', (text: string) => text.replace('## תפקיד, שפה וגבולות', 'תפקיד ללא כותרת'), /requires a heading and body/],
  ] as const)('rejects %s markers/structure instead of silently dropping instructions', (_, change, error) => {
    expect(() => parsePromptSource(change(source))).toThrow(error);
  });

  it('rejects missing, duplicate, misspelled, and malformed machine placeholders', () => {
    // Replace only the actual control block, not author documentation outside markers.
    const original = parsePromptSource(source).requestControl;
    for (const replacement of [original.replace('{{CONTROL_JSON}}', ''), original + '\n{{CONTROL_JSON}}']) {
      expect(() => parsePromptSource(source.replace(block('request-control', original), block('request-control', replacement))))
        .toThrow(/requires exactly one/);
    }
    for (const bad of ['{{UNKNOWN}}', '{{control}}', '{{UNCLOSED']) {
      expect(() => parsePromptSource(source.replace('## תפקיד, שפה וגבולות', `## תפקיד, שפה וגבולות\n${bad}`)))
        .toThrow(/placeholder/);
    }
  });
});

describe('prompt interpolation boundary', () => {
  it('replaces only template tokens once without evaluating injected text or replacement sequences', () => {
    const untrusted = '{{TASK}} $& ${process.env.KEY} `text`';
    expect(interpolatePrompt('נתונים: {{CONTROL_JSON}}\nמשימה: {{TASK}}', { CONTROL_JSON: untrusted, TASK: 'turn' }))
      .toBe(`נתונים: ${untrusted}\nמשימה: turn`);
  });

  it('fails closed on unresolved tokens and malformed delimiters', () => {
    expect(() => interpolatePrompt('{{MISSING}}', {})).toThrow('Unknown prompt placeholder');
    expect(() => interpolatePrompt('{{BROKEN}', {})).toThrow('Malformed prompt placeholder');
    expect(() => interpolatePrompt('{{TOSTRING}}', {})).toThrow('Unknown prompt placeholder');
  });
});

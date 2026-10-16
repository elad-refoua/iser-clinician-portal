/** One-pass substitution: inserted source data is never interpreted as a template. */
export function interpolatePrompt(template: string, values: Record<string, string>): string {
  const tokens = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
  if (/\{\{|\}\}/.test(template.replace(tokens, ''))) throw new Error('Malformed prompt placeholder');
  return template.replace(tokens, (_, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) throw new Error(`Unknown prompt placeholder: ${name}`);
    return values[name];
  });
}

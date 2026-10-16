import { GOAL_LABELS, type DocumentVersion, type Goal, type IntakeField, type PendingDraft } from '../../packages/contracts';

export interface DiffPart { kind: 'equal' | 'added' | 'removed'; text: string }
export interface DiffBlock { kind: 'unchanged' | 'added' | 'removed' | 'replaced'; before: string; after: string; parts: DiffPart[] }
export interface DocumentComparison { blocks: DiffBlock[]; changed: boolean; addedLines: number; removedLines: number; replacements: number }

function append(parts: DiffPart[], kind: DiffPart['kind'], text: string) {
  if (!text) return;
  const previous = parts.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else parts.push({ kind, text });
}

function diffTokens(before: string[], after: string[], maxCells: number): DiffPart[] {
  const parts: DiffPart[] = [];
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  append(parts, 'equal', before.slice(0, prefix).join(''));
  const oldMiddle = before.slice(prefix, before.length - suffix);
  const newMiddle = after.slice(prefix, after.length - suffix);
  const rows = oldMiddle.length, columns = newMiddle.length;
  if (!rows || !columns || (rows + 1) * (columns + 1) > maxCells) {
    append(parts, 'removed', oldMiddle.join(''));
    append(parts, 'added', newMiddle.join(''));
  } else {
    const width = columns + 1;
    const scores = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--) for (let j = columns - 1; j >= 0; j--) scores[i * width + j] = oldMiddle[i] === newMiddle[j]
      ? scores[(i + 1) * width + j + 1] + 1
      : Math.max(scores[(i + 1) * width + j], scores[i * width + j + 1]);
    let i = 0, j = 0;
    while (i < rows || j < columns) {
      if (i < rows && j < columns && oldMiddle[i] === newMiddle[j]) { append(parts, 'equal', oldMiddle[i]); i++; j++; }
      else if (i < rows && (j === columns || scores[(i + 1) * width + j] >= scores[i * width + j + 1])) append(parts, 'removed', oldMiddle[i++]);
      else append(parts, 'added', newMiddle[j++]);
    }
  }
  if (suffix) append(parts, 'equal', before.slice(before.length - suffix).join(''));
  return parts;
}

const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const words = (text: string) => text.match(/\s+|[\p{L}\p{N}\p{M}_]+|[^\s\p{L}\p{N}\p{M}_]+/gu) ?? [];

/** Exact text comparison; the bounded fallback shows a whole changed passage, never an invented edit. */
export function diffDocument(before: string, after: string): DocumentComparison {
  const parts = diffTokens(lines(before), lines(after), 600_000);
  const blocks: DiffBlock[] = [];
  let oldText = '', newText = '';
  function flush() {
    if (!oldText && !newText) return;
    const kind = oldText && newText ? 'replaced' : oldText ? 'removed' : 'added';
    blocks.push({ kind, before: oldText, after: newText, parts: diffTokens(words(oldText), words(newText), 120_000) });
    oldText = ''; newText = '';
  }
  for (const part of parts) {
    if (part.kind === 'equal') { flush(); blocks.push({ kind: 'unchanged', before: part.text, after: part.text, parts: [part] }); }
    else if (part.kind === 'removed') oldText += part.text;
    else newText += part.text;
  }
  flush();
  return {
    blocks,
    changed: before !== after,
    addedLines: blocks.filter(block => block.kind === 'added' || block.kind === 'replaced').reduce((sum, block) => sum + lines(block.after).length, 0),
    removedLines: blocks.filter(block => block.kind === 'removed' || block.kind === 'replaced').reduce((sum, block) => sum + lines(block.before).length, 0),
    replacements: blocks.filter(block => block.kind === 'replaced').length,
  };
}

function sameSources(first: string[], second: string[]) {
  return JSON.stringify([...new Set(first)].sort()) === JSON.stringify([...new Set(second)].sort());
}

export function changedIntakeFieldIds(before: IntakeField[], after: IntakeField[]): number[] {
  return after.filter(field => {
    const previous = before.find(item => item.id === field.id);
    return !previous || previous.value !== field.value || previous.status !== field.status || (previous.remaining || '') !== (field.remaining || '') || !sameSources(previous.sourceIds, field.sourceIds);
  }).map(field => field.id);
}

export function proposalDestinations(pending: PendingDraft, versions: DocumentVersion[]) {
  const goals: Goal[] = ['note', 'intake', 'formulation', 'supervision', 'gold'];
  return goals.map(goal => {
    const proposed = pending.result.documents.find(document => document.kind === goal);
    const base = versions.find(version => version.id === pending.baseVersionIds[goal] && version.kind === goal);
    const baseMissing = Boolean(pending.baseVersionIds[goal] && !base);
    const fieldIds = goal === 'intake' ? changedIntakeFieldIds(base?.fields ?? [], pending.fields) : [];
    const textChanged = Boolean(proposed && proposed.content !== (base?.content ?? ''));
    const sourcesChanged = Boolean(proposed && !sameSources(proposed.sourceIds, base?.sourceIds ?? []));
    const changed = Boolean(proposed && (textChanged || sourcesChanged || fieldIds.length));
    return { goal, proposed, base, baseMissing, fieldIds, textChanged, sourcesChanged, changed, status: baseMissing ? 'unavailable' as const : !proposed || (!changed && base) ? 'unchanged' as const : !base ? 'new' as const : 'updated' as const };
  });
}

function hebrewList(labels: string[]): string {
  return labels.length < 2 ? labels.join('') : `${labels.slice(0, -1).join(', ')} ו${labels.at(-1)}`;
}

/** Describes only the comparison with saved bases; model prose cannot override these facts. */
export function proposalSummary(destinations: ReturnType<typeof proposalDestinations>, sessionNumber: number, fieldLabels: readonly { id: number; label: string }[]): string {
  const sentences: string[] = [];
  const note = destinations.find(item => item.goal === 'note');
  const noteLabel = `רשומת פגישה ${sessionNumber}`;
  if (note?.status === 'unavailable') sentences.push(`גרסת הבסיס של ${noteLabel} אינה זמינה, ולכן אי אפשר לקבוע מה השתנה בה.`);
  else if (!note?.proposed && !note?.base) sentences.push(`לא הוצעה רשומה לפגישה ${sessionNumber}.`);
  else if (note?.status === 'new') sentences.push(`מוצעת רשומה חדשה לפגישה ${sessionNumber}.`);
  else if (note?.status === 'updated') sentences.push(note.textChanged
    ? `מוצע עדכון ל${noteLabel}.`
    : `ב${noteLabel} מוצע עדכון למקורות המקושרים בלבד; הנוסח נשאר זהה.`);
  else sentences.push(`${noteLabel} נשארת ללא שינוי.`);

  const cumulative = destinations.filter(item => item.goal !== 'note' && (item.proposed || item.base || item.baseMissing));
  const names = (items: typeof cumulative) => hebrewList(items.map(item => GOAL_LABELS[item.goal]));
  const fresh = cumulative.filter(item => item.status === 'new');
  const updated = cumulative.filter(item => item.status === 'updated');
  const sourceOnly = updated.filter(item => item.sourcesChanged && !item.textChanged && !item.fieldIds.length);
  const otherUpdates = updated.filter(item => !sourceOnly.includes(item));
  const unchanged = cumulative.filter(item => item.status === 'unchanged');
  const unavailable = cumulative.filter(item => item.status === 'unavailable');
  if (fresh.length) sentences.push(`מסמכים חדשים בתיק: ${names(fresh)}.`);
  if (otherUpdates.length) sentences.push(`עדכונים מוצעים בתיק: ${names(otherUpdates)}.`);
  if (sourceOnly.length) sentences.push(`עדכון מקורות בלבד, ללא שינוי בנוסח: ${names(sourceOnly)}.`);
  if (unchanged.length) sentences.push(`ללא שינוי בתיק: ${names(unchanged)}.`);
  if (unavailable.length) sentences.push(`גרסת הבסיס אינה זמינה עבור ${names(unavailable)}; אי אפשר לקבוע מה השתנה.`);

  const intake = cumulative.find(item => item.goal === 'intake');
  if (intake?.status === 'updated' && intake.fieldIds.length) {
    const labels = intake.fieldIds.map(id => fieldLabels.find(field => field.id === id)?.label ?? `שדה ${id}`);
    const visible = labels.slice(0, 3);
    sentences.push(`באינטייק מוצע שינוי בשדות: ${hebrewList(visible)}${labels.length > visible.length ? `, ועוד ${labels.length - visible.length} שדות` : ''}.`);
  }
  return sentences.join(' ');
}

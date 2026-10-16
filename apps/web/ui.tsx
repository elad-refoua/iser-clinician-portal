import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Copy, FileText, X } from 'lucide-react';
import type { DocumentVersion, PortalState } from '../../packages/contracts';
import { diffDocument, type DiffBlock } from './proposal-diff';

export const dateLabel = (value: string) => new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
export const timeLabel = (value: string) => new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const index = tabs.indexOf(event.target as HTMLButtonElement);
  if (index < 0 || !tabs.length) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus(); tabs[next].click();
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => { ref.current?.close(); }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-label={title}>
    <div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="סגירה"><X size={20} /></button></div>
    <div className="modal-body">{children}</div>
  </dialog>;
}

function inlineDocumentText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}

export function DocumentText({ text }: { text: string }) {
  if (!text.trim()) return <p className="empty-copy">עדיין אין תוכן במסמך הזה.</p>;
  return <div className="document-text">{text.split('\n').map((line, index) => {
    if (!line.trim()) return <div className="document-space" key={index} aria-hidden="true" />;
    const heading = line.match(/^(#{1,3})\s+/);
    if (heading) {
      const level = heading[1].length;
      const Heading = (['h3', 'h4', 'h5'] as const)[level - 1];
      return <Heading className={`document-heading document-heading-${level}`} key={index}>{inlineDocumentText(line.slice(heading[0].length))}</Heading>;
    }
    if (/^[-*]\s/.test(line)) return <p className="document-bullet" key={index}>{inlineDocumentText(line.replace(/^[-*]\s+/, ''))}</p>;
    return <p key={index}>{inlineDocumentText(line)}</p>;
  })}</div>;
}

const changeLabels = { added: 'תוספת מוצעת', removed: 'הסרה מוצעת', replaced: 'החלפת נוסח' };

function SpacingText({ text }: { text: string }) {
  if (!text) return <p className="document-diff-spacing">ללא תווים</p>;
  const counts = [
    ['ירידות שורה', (text.match(/\r\n|\r|\n/g) ?? []).length],
    ['רווחים', (text.match(/ /g) ?? []).length],
    ['טאבים', (text.match(/\t/g) ?? []).length],
    ['תווי ריווח אחרים', text.replace(/[ \t\r\n]/g, '').length],
  ].filter(([, count]) => count);
  return <p className="document-diff-spacing">ריווח בלבד: {counts.map(([label, count]) => `${label}: ${count}`).join('; ')}.</p>;
}

function ChangedContent({ text }: { text: string }) {
  return text.trim() ? <DocumentText text={text} /> : <SpacingText text={text} />;
}

function ReplacementText({ block }: { block: DiffBlock }) {
  const onePlainLine = [block.before, block.after].every(text => text.trim() && !/\n|^#{1,6}\s|^[-*]\s|\*\*/.test(text.replace(/\n$/, '')));
  if (onePlainLine) return <p className="document-diff-inline">{block.parts.map((part, index) => part.kind === 'equal' ? <span key={index}>{inlineDocumentText(part.text)}</span>
    : part.kind === 'removed' ? <del key={index}><span className="sr-only">נוסח שמוצע להסיר: </span>{inlineDocumentText(part.text)}<span className="sr-only"> סוף ההסרה. </span></del>
      : <ins key={index}><span className="sr-only">נוסח שמוצע להוסיף: </span>{inlineDocumentText(part.text)}<span className="sr-only"> סוף התוספת. </span></ins>)}</p>;
  return <div className="document-diff-replacement"><div className="document-diff-old"><span className="document-diff-side-label">נוסח שמוצע להסיר</span><del><ChangedContent text={block.before} /></del></div><div className="document-diff-new"><span className="document-diff-side-label">הנוסח המוצע במקומו</span><ins><ChangedContent text={block.after} /></ins></div></div>;
}

export function DocumentDiff({ before, after, showLegend = true }: { before: string; after: string; showLegend?: boolean }) {
  const comparison = useMemo(() => diffDocument(before, after), [before, after]);
  if (!comparison.changed) return <div className="document-diff"><p className="document-diff-unchanged">אין שינוי בנוסח לעומת גרסת הבסיס.</p><DocumentText text={after} /></div>;
  return <div className="document-diff" aria-label="השינויים המוצעים במסמך">
    {showLegend && <p className="document-diff-legend"><span><ins>תוספת</ins> בנוסח המוצע</span><span><del>הסרה</del> מגרסת הבסיס</span><span>החלפה מוצגת עם הנוסח הקודם והחדש</span></p>}
    {comparison.blocks.map((block, index) => block.kind === 'unchanged' ? block.after.trim() ? <DocumentText key={index} text={block.after} /> : null : <div key={index} className={`document-diff-block diff-${block.kind}`}>
      <span className="document-diff-label">{!block.before.trim() && !block.after.trim() ? 'שינוי בריווח' : changeLabels[block.kind]}</span>
      {!block.before.trim() && !block.after.trim() ? <div className="document-diff-replacement"><div><span className="document-diff-side-label">לפני השינוי</span><SpacingText text={block.before} /></div><div><span className="document-diff-side-label">אחרי השינוי</span><SpacingText text={block.after} /></div></div> : block.kind === 'replaced' ? <ReplacementText block={block} /> : block.kind === 'added' ? <ins className="document-diff-whole"><ChangedContent text={block.after} /></ins> : <del className="document-diff-whole"><ChangedContent text={block.before} /></del>}
    </div>)}
  </div>;
}

export function CopyButton({ text, notify }: { text: string; notify: (message: string) => void }) {
  return <button className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(text); notify('הטקסט הועתק.'); } catch { notify('ההעתקה לא הצליחה. אפשר לבחור את הטקסט ולהעתיק ידנית.'); } }}><Copy size={16} />העתקה</button>;
}

export function SourceViewer({ ids, state, onClose }: { ids: string[]; state: PortalState; onClose: () => void }) {
  const sources = ids.map(id => state.sources.find(source => source.id === id)).filter(source => source !== undefined);
  return <Modal title="המקורות לנוסח הזה" onClose={onClose}>
    <p className="muted">אלה הדברים שנמסרו ונשמרו בתיק הבדיוני. הנוסח המעובד אינו מקור נוסף.</p>
    {sources.length === 0 && <p className="empty-copy">לגרסה הזו אין מקורות מקושרים.</p>}
    {sources.map(source => <article className="source-entry" key={source.id}>
      <div className="row-between"><strong>{source.sessionNumber ? `פגישה ${source.sessionNumber}` : 'עריכה בין פגישות'}</strong><span className="tag">{source.kind === 'manual' ? 'עריכה ידנית' : source.kind === 'seed' ? 'מקור הדגמה' : 'דברי המטפל'}</span></div>
      <p className="preserve-lines">{source.text}</p><small className="muted">{dateLabel(source.recordedAt)} · {timeLabel(source.recordedAt)}</small>
    </article>)}
  </Modal>;
}

export function VersionMeta({ version }: { version?: DocumentVersion }) {
  if (!version) return null;
  return <span className="version-meta">{version.approved ? <Check size={14} /> : <FileText size={14} />}{version.approved ? 'נוסח מאושר' : version.author === 'clinician' ? 'עריכת המטפל' : 'טיוטה לעיון'} · {dateLabel(version.createdAt)}</span>;
}

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Copy, FileText, X } from 'lucide-react';
import type { DocumentVersion, PortalState } from '../../packages/contracts';

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
    if (/^#{1,3}\s/.test(line)) return <h3 key={index}>{inlineDocumentText(line.replace(/^#{1,3}\s+/, ''))}</h3>;
    if (/^[-*]\s/.test(line)) return <p className="document-bullet" key={index}>{inlineDocumentText(line.replace(/^[-*]\s+/, ''))}</p>;
    return <p key={index}>{inlineDocumentText(line || '\u00a0')}</p>;
  })}</div>;
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

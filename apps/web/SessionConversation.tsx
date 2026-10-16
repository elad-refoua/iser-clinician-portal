import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, LoaderCircle } from 'lucide-react';
import { MODELS, type Session } from '../../packages/contracts';
import './chat-workflow.css';

interface SessionConversationProps {
  session: Session;
  patientName: string;
  busy: boolean;
  disabled: boolean;
  modelLabel: string;
  onComposerChange: (text: string) => void;
  onSend: () => void;
  onPrepare: () => void;
  onSkip: () => void;
  onCancel: () => void;
  onExplain: () => void;
}

function messageOrigin(session: Session, index: number) {
  const message = session.messages[index];
  const trace = [...session.traces].reverse().find(item => item.context.sessionId === session.id
    && 'utterance' in item.response && item.response.utterance === message.text
    && item.context.messages.length === index
    && item.context.messages.every((previous, position) => previous.id === session.messages[position]?.id));
  if (!trace) return 'תגובה שנשמרה בתיק';
  if (trace.model === 'server-policy') return 'מעבר לפי כללי השיחה';
  if (trace.mode === 'prepared') return 'דוגמה היסטורית מוכנה מראש';
  return MODELS.find(model => model.id === trace.model)?.label ?? trace.model;
}

export default function SessionConversation({ session, patientName, busy, disabled, modelLabel,
  onComposerChange, onSend, onPrepare, onSkip, onCancel, onExplain }: SessionConversationProps) {
  const inputId = useId();
  const helpId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const followsLatest = useRef(true);
  const lastSession = useRef(session.id);
  const [hasUnread, setHasUnread] = useState(false);
  const hasMessages = session.messages.length > 0;
  const canSend = !busy && !disabled && Boolean(session.composer.trim());
  const hasUserText = session.messages.some(message => message.role === 'user' && message.text.trim());
  const lastMessage = session.messages.at(-1);
  const isQuestion = session.status === 'asking' && lastMessage?.role === 'assistant';

  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(230, Math.max(hasMessages ? 64 : 112, input.scrollHeight))}px`;
  }, [session.id, session.composer, hasMessages]);

  useEffect(() => {
    const changedSession = lastSession.current !== session.id;
    lastSession.current = session.id;
    if (changedSession || followsLatest.current) {
      const element = log.current;
      if (element) element.scrollTop = element.scrollHeight;
      followsLatest.current = true;
      setHasUnread(false);
    } else setHasUnread(true);
  }, [session.id, session.messages.length, busy]);

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    followsLatest.current = true;
    onSend();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    send();
  }

  return <section className="session-conversation" aria-label={`תיעוד הפגישה עם ${patientName}`} dir="rtl">
    {!hasMessages && <p className="chat-opening">אפשר לכתוב כאן את מה שהיה בפגישה עם {patientName}, במילים שלך.</p>}
    {hasMessages && <div className="chat-log-wrap">
      <div ref={log} className="chat-log" role="log" aria-label="השיחה על הפגישה" aria-live="polite" aria-relevant="additions" tabIndex={0}
        onScroll={event => {
          const element = event.currentTarget;
          followsLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
          if (followsLatest.current) setHasUnread(false);
        }}>
        {session.messages.map((message, index) => <article key={message.id} className={`chat-message chat-message-${message.role}`}>
          <div className="chat-message-byline"><strong>{message.role === 'user' ? 'מה ששיתפת' : 'מרווח'}</strong>
            {message.role === 'assistant' && <span><bdi>{messageOrigin(session, index)}</bdi></span>}
          </div>
          <p>{message.text}</p>
        </article>)}
      </div>
      {hasUnread && <button type="button" className="chat-unread" onClick={() => {
        const element = log.current;
        if (element) element.scrollTop = element.scrollHeight;
        followsLatest.current = true;
        setHasUnread(false);
      }}><ArrowDown size={15} aria-hidden="true" />להמשך השיחה</button>}
    </div>}
    <form className="chat-compose" onSubmit={send} aria-busy={busy}>
      <label className="sr-only" htmlFor={inputId}>{isQuestion ? 'התשובה שלך' : 'מה היה בפגישה'}</label>
      <textarea ref={textarea} id={inputId} value={session.composer} maxLength={16000} rows={hasMessages ? 2 : 4}
        disabled={disabled || busy} aria-describedby={helpId}
        placeholder={hasMessages ? 'אפשר להמשיך כאן…' : 'כותבים חופשי…'}
        onChange={event => onComposerChange(event.target.value)} onKeyDown={keyDown} />
      <div className="chat-compose-footer">
        <span id={helpId} className="chat-keyboard"><bdi>Enter</bdi> לשליחה · <bdi>Shift + Enter</bdi> לשורה חדשה</span>
        <button type="submit" className="chat-send" disabled={!canSend} aria-label="שליחת ההודעה לבינה"><ArrowUp size={20} aria-hidden="true" /><span>שליחה</span></button>
      </div>
    </form>
    {busy ? <div className="chat-waiting" role="status"><LoaderCircle size={16} className="chat-spinner" aria-hidden="true" /><span>ממתינים לתשובת <bdi>{modelLabel}</bdi>…</span><button type="button" onClick={onCancel}>ביטול ההמתנה</button></div>
      : <div className="chat-quiet-actions">
        {(hasUserText || session.composer.trim()) && session.status !== 'approved' && <button type="button" disabled={disabled} onClick={onPrepare}>{session.pendingDraft ? 'עדכון הסיכום' : 'הכנת סיכום'}</button>}
        {isQuestion && !session.composer.trim() && <button type="button" disabled={disabled} onClick={onSkip}>לדלג על השאלה</button>}
        {session.traces.length > 0 && <button type="button" className="chat-explain" onClick={onExplain}>איך נוצרה התגובה?</button>}
      </div>}
    {session.composer.length > 15000 && <p className="chat-length" role="status">{16000 - session.composer.length} תווים נוספים בהודעה הזו.</p>}
  </section>;
}

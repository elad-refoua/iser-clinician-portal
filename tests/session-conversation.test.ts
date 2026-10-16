import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SessionConversation from '../apps/web/SessionConversation';
import type { Session } from '../packages/contracts';

const initial: Session = { id: 'synthetic-session', patientId: 'synthetic-patient', branchId: 'synthetic-branch', number: 1, startedAt: '2026-10-16T12:00:00Z', revision: 0, status: 'writing', messages: [], composer: '', questionCount: 0, intakeCount: 0, intakeActive: false, skippedTopics: [], traces: [] };
const noop = () => undefined;
function render(changes: Partial<Session> = {}, busy = false, disabled = false) {
  return renderToStaticMarkup(createElement(SessionConversation, {
    session: { ...initial, ...changes }, patientName: 'דמות בדיונית', busy, disabled, modelLabel: 'Live model',
    onComposerChange: noop, onSend: noop, onPrepare: noop, onSkip: noop, onCancel: noop, onExplain: noop,
  }));
}
const user = { id: 'synthetic-user', role: 'user' as const, text: 'Synthetic contribution', at: initial.startedAt };
const assistant = { id: 'synthetic-assistant', role: 'assistant' as const, text: 'Synthetic question?', at: initial.startedAt };

describe('conversation action hierarchy', () => {
  it('makes the first contribution a fully labeled form submission before the keyboard hint', () => {
    const markup = render({ composer: 'First contribution' });
    expect(markup).toMatch(/<button type="submit" class="chat-send" aria-label="שליחה">/);
    expect(markup.indexOf('class="chat-send"')).toBeLessThan(markup.indexOf('class="chat-keyboard"'));
    expect(markup).toContain('class="chat-finish"');
    expect(markup).toContain('להכנת סיכום');
    expect(markup).toContain('כאן אפשר לשוחח עם עוזר התיעוד');
    expect(markup).not.toContain('chat-finish-ready');
    expect(markup).not.toContain('chat-message-assistant');
  });

  it('keeps the same send label for answers and finishing secondary while text is present', () => {
    const markup = render({ status: 'asking', messages: [user, assistant], composer: 'Answer', questionCount: 3 });
    expect(markup).toContain('aria-label="שליחה"');
    expect(markup).not.toContain('chat-finish-ready');
  });

  it.each([{ questionCount: 3 }, { intakeActive: true, intakeCount: 2 }])('emphasizes finishing only at the active question limit with no unsent text (%j)', counters => {
    const markup = render({ status: 'asking', messages: [user, assistant], ...counters });
    expect(markup).toContain('class="chat-finish chat-finish-ready"');
    expect(markup).toMatch(/type="submit" class="chat-send" disabled=""/);
  });

  it('does not emphasize finishing early in an optional expansion after the main limit', () => {
    expect(render({ status: 'asking', messages: [user, assistant], questionCount: 3, intakeActive: true, intakeCount: 0 })).not.toContain('chat-finish-ready');
  });

  it('keeps send disabled for empty, busy and historical input and exposes no competing finish while waiting', () => {
    expect(render()).toMatch(/type="submit" class="chat-send" disabled=""/);
    const waiting = render({ composer: 'Text', messages: [user] }, true);
    expect(waiting).toMatch(/type="submit" class="chat-send" disabled=""/);
    expect(waiting).not.toContain('chat-finish');
    expect(render({ composer: 'Historical text' }, false, true)).toMatch(/type="submit" class="chat-send" disabled=""/);
  });
});

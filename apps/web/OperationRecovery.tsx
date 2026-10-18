import type { PortalState } from '../../packages/contracts';
import type { OperationSummary } from '../../packages/contracts/operations';
import './operation-recovery.css';

const labels = { queued: 'ממתינה להתחלה', running: 'הבינה עובדת בשרת', succeeded: 'התשובה מוכנה', failed: 'הפעולה לא הושלמה', uncertain: 'לא התקבלה תשובה מאומתת' };
export default function OperationRecovery({ operations, state, disabled, error, onOpen, onRefresh }: {
  operations: OperationSummary[]; state: PortalState; disabled: boolean; error: string; onOpen: (id: string) => void; onRefresh: () => void;
}) {
  if (!operations.length && !error) return null;
  return <section className="operation-recovery" aria-label="פעולות בינה שמורות">
    <div className="operation-recovery-title"><strong>אפשר להמשיך מכאן</strong><button className="text-button" disabled={disabled} onClick={onRefresh}>בדיקת מצב</button></div>
    <p>הפעולות נשמרות בשרת גם כשהחלון נסגר. פתיחת תשובה קיימת אינה מפעילה את המודל מחדש.</p>
    {error && <p role="status">{error}</p>}
    <ul>{operations.map(operation => {
      const patient = state.patients.find(item => item.id === operation.patientId);
      const session = state.sessions.find(item => item.id === operation.sessionId);
      return <li key={operation.id}><div><strong>{patient?.name ?? 'תיק שאינו פתוח בעותק הנוכחי'}{session ? ` · פגישה ${session.number}` : ''}</strong><span>{operation.task === 'draft' ? 'הכנת סיכום' : 'תגובה בשיחה'} · {labels[operation.status]}</span></div>
        <button className="secondary small" disabled={disabled} onClick={() => onOpen(operation.id)}>{operation.status === 'succeeded' ? 'פתיחת התשובה' : operation.status === 'running' || operation.status === 'queued' ? 'המשך ההמתנה' : 'פרטים'}</button></li>;
    })}</ul>
  </section>;
}

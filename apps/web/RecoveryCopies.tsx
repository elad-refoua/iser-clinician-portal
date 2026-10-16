import { useEffect, useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { listPendingCopies, type PendingCopy } from '../../packages/domain/recovery-storage';
import { dateLabel, Modal, timeLabel } from './ui';

export default function RecoveryCopies({ onClose }: { onClose: () => void }) {
  const [copies, setCopies] = useState<PendingCopy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    listPendingCopies().then(result => { if (active) setCopies(result); })
      .catch(() => { if (active) setError('לא ניתן לקרוא את עותקי השחזור בדפדפן הזה. אפשר לסגור ולנסות שוב.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function download(copy: PendingCopy) {
    if (copy.snapshot === null) return;
    try {
      const blob = new Blob([copy.snapshot], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `merhav-recovery-${copy.savedAt?.slice(0, 10) ?? 'undated'}-${copy.id.slice(0, 8)}.json`;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setError('');
    } catch { setError('ההורדה לא התחילה. העותק נשאר שמור בדפדפן ואפשר לנסות שוב.'); }
  }

  return <Modal title="עותקים מקומיים לשחזור" onClose={onClose}>
    <p>כששמירה למאגר נעצרת, נשמר עותק נפרד של העבודה מהעמוד הפתוח. עבודה מלשונית אחרת אינה מחליפה אותו.</p>
    <p className="muted small-copy">אפשר להוריד עותק לקובץ JSON, ולאחר מכן לייבא אותו דרך אפשרויות הדמו. הרשימה אינה מעידה שהעותק נשמר בשרת; ההורדה אינה משנה את התיק הפעיל.</p>
    {loading && <p role="status"><LoaderCircle size={16} className="spin" /> טוען עותקים…</p>}
    {error && <p className="error-copy" role="alert">{error}</p>}
    {!loading && !error && copies.length === 0 && <p className="empty-copy">אין עדיין עותקים מקומיים לשחזור בדפדפן הזה.</p>}
    {copies.map(copy => <article className="source-entry" key={copy.id}>
      <strong>{copy.savedAt ? `${dateLabel(copy.savedAt)} · ${timeLabel(copy.savedAt)}` : 'מועד השמירה אינו זמין'}</strong>
      {copy.snapshot !== null ? <>
        <p className="muted small-copy">{copy.patientCount} תיקים · {copy.sessionCount} פגישות</p>
        <button className="secondary small" onClick={() => download(copy)}><Download size={16} />הורדת עותק לשחזור</button>
      </> : <p className="error-copy">לא ניתן לקרוא עותק זה. הוא נשאר באחסון ולא נמחק.</p>}
    </article>)}
  </Modal>;
}

import { useState, type FormEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Modal } from './ui';

export interface NewPatientDetails {
  name: string;
  schedule?: { dayOfWeek?: number; time?: string };
}

const days = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת'];

export function scheduleLabel(schedule?: NewPatientDetails['schedule']) {
  if (!schedule || (schedule.dayOfWeek === undefined && !schedule.time)) return '';
  return [schedule.dayOfWeek === undefined ? '' : days[schedule.dayOfWeek], schedule.time].filter(Boolean).join(' · ');
}

export default function NewPatient({ onCreate, onClose }: { onCreate: (details: NewPatientDetails) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      onCreate({ name: name.trim(), ...((day !== '' || time) ? { schedule: { ...(day !== '' ? { dayOfWeek: Number(day) } : {}), ...(time ? { time } : {}) } } : {}) });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'התיק לא נפתח. אפשר לבדוק את הפרטים ולנסות שוב.');
    }
  }

  return <Modal title="פתיחת תיק חדש" onClose={onClose}>
    <p>מתחילים מפגישה 1. בכל פעם שחוזרים לתיק אפשר להמשיך לפגישה הבאה.</p>
    <form className="new-patient-form" onSubmit={submit}>
      <label htmlFor="new-patient-name">שם לתצוגה או קוד<input id="new-patient-name" value={name} onChange={event => setName(event.target.value)} maxLength={200} autoComplete="off" placeholder="למשל: דמות לדוגמה 01" required autoFocus /></label>
      <fieldset className="meeting-schedule"><legend>מועד פגישה קבוע <span>(לא חובה)</span></legend>
        <div className="schedule-fields">
          <label htmlFor="new-patient-day">יום<select id="new-patient-day" value={day} onChange={event => setDay(event.target.value)}><option value="">ללא יום קבוע</option>{days.map((label, index) => <option key={index} value={index}>{label}</option>)}</select></label>
          <label htmlFor="new-patient-time">שעה<input id="new-patient-time" type="time" value={time} onChange={event => setTime(event.target.value)} /></label>
        </div>
      </fieldset>
      <p className="muted small-copy">בדמו משתמשים בשם ובפרטים מומצאים בלבד. מצב השמירה מופיע בראש המסך; כשהמאגר מחובר, התיק נשמר בו אוטומטית.</p>
      {error && <p className="error-copy" role="alert">{error}</p>}
      <div className="button-row"><button className="primary" disabled={!name.trim()}>פתיחת התיק ופגישה 1<ArrowLeft size={17} /></button><button className="text-button" type="button" onClick={onClose}>ביטול</button></div>
    </form>
  </Modal>;
}

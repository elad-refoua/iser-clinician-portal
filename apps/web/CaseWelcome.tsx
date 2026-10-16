import { useState } from 'react';
import { ArrowLeft, BookOpen, CalendarDays, Check, FilePlus2 } from 'lucide-react';
import type { PortalState } from '../../packages/contracts';
import { caseOverview } from './experience-model';
import { scheduleLabel } from './NewPatient';
import { dateLabel, Modal } from './ui';
import './experience.css';

interface CaseWelcomeProps {
  state: PortalState;
  selectedPatientId: string;
  onSelect: (patientId: string) => void;
  onClose: () => void;
  onNewPatient: () => void;
}

export default function CaseWelcome({ state, selectedPatientId, onSelect, onClose, onNewPatient }: CaseWelcomeProps) {
  const [pickedId, setPickedId] = useState(selectedPatientId);
  const cases = state.patients.map(patient => caseOverview(state, patient.id)).filter(item => item !== undefined);
  const selected = cases.find(item => item.patient.id === pickedId) ?? cases[0];

  return <Modal title="מכירים את התיק, ואז מתחילים" onClose={onClose} wide>
    <div className="case-welcome">
      <p className="welcome-intro">בוחרים דמות, קוראים מה כבר קרה, ואז כותבים על הפגישה שזה עתה הסתיימה. העוזר יגיב לדברים שתכתבו בעזרת ההקשר שכבר נצבר בתיק.</p>
      <p className="welcome-fiction">כל הדמויות והפגישות כאן בדיוניות. פגישות העבר נכתבו לצורך ההדגמה; התגובות החדשות נוצרות במודל שפה מתוך הדברים שתכתבו.</p>
      <div className="welcome-layout">
        <div className="welcome-patients" role="group" aria-label="בחירת תיק להיכרות">
          {cases.map(item => <button className={`welcome-case ${item.patient.id === selected?.patient.id ? 'selected' : ''}`} key={item.patient.id} onClick={() => setPickedId(item.patient.id)} aria-pressed={item.patient.id === selected?.patient.id}>
            <span className="welcome-case-name">{item.patient.name}</span>
            <span className="welcome-case-description">{item.patient.description || 'תיק חדש שנפתח להדגמה.'}</span>
            <span className="welcome-case-status">{item.timeline.length ? `${item.timeline.length} פגישות עם תוכן שמור` : 'עדיין אין תוכן מפגישות'}{item.patient.id === selected?.patient.id && <Check size={15} aria-hidden="true" />}</span>
          </button>)}
          <button className="welcome-new text-button" onClick={onNewPatient}><FilePlus2 size={17} />פתיחת דמות חדשה מאפס</button>
        </div>
        {selected && <section className="welcome-detail" aria-label={`היכרות עם ${selected.patient.name}`}>
          <header className="welcome-detail-heading"><h3>{selected.patient.name}</h3>{selected.patient.age !== undefined && <span>גיל {selected.patient.age}</span>}</header>
          {selected.patient.description && <p>{selected.patient.description}</p>}
          {selected.patient.schedule && <p className="welcome-schedule"><CalendarDays size={15} />מועד מתוכנן: {scheduleLabel(selected.patient.schedule)}</p>}
          <div className="welcome-materials">
            <h4><BookOpen size={17} />מה כבר נמצא בתיק</h4>
            <ul>{selected.materials.map(material => <li key={material.kind} className={material.present ? 'available' : ''}><span>{material.label}</span><span>{material.present ? material.kind === 'note' ? `${selected.timeline.filter(item => item.note).length} רשומות` : 'קיים תוכן' : 'עדיין אין תוכן'}</span></li>)}</ul>
            {selected.materials.find(item => item.kind === 'intake')?.present && <p className="welcome-small">באינטייק: {selected.documentedFields} שדות תועדו ו־{selected.partialFields} תועדו חלקית. שאר מצבי המידע נשארים גלויים במסמך.</p>}
          </div>
          <div className="welcome-history"><h4>מה קרה בפגישות הקודמות</h4>
            {selected.timeline.length ? <ol>{selected.timeline.map(item => <li key={item.session.id}><div><strong>פגישה {item.session.number}</strong><time dateTime={item.session.startedAt}>{dateLabel(item.session.startedAt)}</time></div><p>{item.excerpt}</p></li>)}</ol> : <p className="welcome-small">התיק מתחיל נקי. אחרי שתתארו את הפגישה הראשונה, יתחילו להצטבר בו רשומה וחומרים להמשך.</p>}
          </div>
          <div className="welcome-start"><h4>מאיפה מתחילים עכשיו</h4><p>{selected.hasOpenSession ? `פגישה ${selected.nextNumber} פתוחה לתיעוד. אפשר להמשיך מהמקום שבו נעצרתם.` : `פגישה ${selected.nextNumber} תיפתח לתיעוד חדש, על בסיס החומר שכבר קיים.`} כתבו מה היה בפגישה במילים שלכם; לצד התגובה תוכלו לראות איזה הקשר נמסר לעוזר ומה הוא החזיר.</p><button className="primary" onClick={() => onSelect(selected.patient.id)}>{selected.hasOpenSession ? `להמשך פגישה ${selected.nextNumber}` : `פתיחת פגישה ${selected.nextNumber} לתיעוד`}<ArrowLeft size={17} /></button></div>
        </section>}
      </div>
    </div>
  </Modal>;
}

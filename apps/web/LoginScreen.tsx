import { useState, type FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff, Leaf, LoaderCircle } from 'lucide-react';
import './login.css';

export interface LoginScreenProps {
  username: string;
  onUsernameChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export default function LoginScreen({ username, onUsernameChange, password, onPasswordChange, busy, error, onSubmit }: LoginScreenProps) {
  const [showPassword, setShowPassword] = useState(false);

  return <main className="login-page" dir="rtl">
    <div className="login-layout">
      <section className="login-intro" aria-labelledby="login-brand">
        <span className="login-brand-symbol" aria-hidden="true"><Leaf size={31} strokeWidth={1.4} /></span>
        <h1 id="login-brand">מרווח</h1>
        <p className="login-tagline">מקום למחשבה אחרי הפגישה</p>
        <p className="login-welcome">אחרי הכניסה אפשר לבחור תיק קיים עם סיפור ופגישות קודמות, או לפתוח תיק חדש ולהתחיל מפגישה ראשונה.</p>
        <div className="login-experience-note">
          <span className="login-live-dot" aria-hidden="true" />
          <p>כל השאלות והטיוטות החדשות נוצרות בבינה מלאכותית, מתוך מה שנכתב וההקשר של התיק.</p>
        </div>
      </section>

      <section className="login-card" aria-labelledby="login-title">
        <h2 id="login-title">כניסה למערכת</h2>
        <p className="login-card-intro">התיקים והשיחות מחכים בפנים.</p>
        <form onSubmit={onSubmit} aria-busy={busy} aria-describedby="login-fictional-notice">
          <label htmlFor="login-username">שם משתמש
            <input id="login-username" name="username" value={username} onChange={event => onUsernameChange(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={200} required autoFocus disabled={busy} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} dir="ltr" />
          </label>
          <div className="login-password-group">
            <label htmlFor="login-password">סיסמה</label>
            <span className="login-password-field">
              <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => onPasswordChange(event.target.value)} autoComplete="current-password" maxLength={256} required disabled={busy} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} dir="ltr" />
              <button type="button" className="login-password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'} aria-pressed={showPassword} disabled={busy}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
            </span>
          </div>
          {error && <p id="login-error" className="login-error" role="alert">{error}</p>}
          <button className="primary login-submit" type="submit" disabled={busy || !username.trim() || !password}>
            {busy ? <><LoaderCircle className="spin" size={18} aria-hidden="true" />מתחברים למערכת…</> : <>כניסה למערכת<ArrowLeft size={18} aria-hidden="true" /></>}
          </button>
        </form>
        <p id="login-fictional-notice" className="login-fictional-notice">הגרסה הזו מיועדת לחומרים בדיוניים בלבד.</p>
      </section>
    </div>
  </main>;
}

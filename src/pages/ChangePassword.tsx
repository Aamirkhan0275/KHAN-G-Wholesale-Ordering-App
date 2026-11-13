import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useI18n } from '../i18n';
import { api, ApiFailure } from '../lib/api';
import { Icon } from '../components/Icon';
import { useToast } from '../components/ui';

export default function ChangePassword() {
  const { me, refresh, logout } = useSession();
  const { t, te } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return <Navigate to="/login" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 6) { setError('password_too_short'); return; }
    setBusy(true);
    try {
      await api('/auth/change-password', { body: { current, next } });
      await refresh();
      toast(t('common.saved'));
      nav(me.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) { setError(err instanceof ApiFailure ? err.code : 'network'); }
    finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={submit}>
        <h2>{t('auth.changeTitle')}</h2>
        {me.must_change_password && <div className="info-box"><Icon name="alert" />{t('auth.changeHint')}</div>}
        <label className="field"><span>{t('auth.current')}</span>
          <input className="input ltr" dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} name="current" /></label>
        <label className="field"><span>{t('auth.new')}</span>
          <input className="input ltr" dir="ltr" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} name="next" minLength={6} /></label>
        {error && <div className="error-box" role="alert"><Icon name="alert" />{te(error, ['auth.err'])}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{t('auth.changeBtn')}</button>
        {me.must_change_password
          ? <button type="button" className="btn btn-ghost" onClick={() => void logout()}>{t('auth.signOut')}</button>
          : <button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>{t('common.back')}</button>}
      </form>
    </div>
  );
}

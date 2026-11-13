import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useI18n } from '../i18n';
import { api, ApiFailure } from '../lib/api';
import { normalizePhone } from '../../shared/phone';
import { HeaderControls } from '../components/Layout';
import { Icon } from '../components/Icon';

export default function Login() {
  const { me, login, lang } = useSession();
  const { t, te } = useI18n();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biz, setBiz] = useState<{ business_name: string; business_name_ur: string | null } | null>(null);

  useEffect(() => { api('/public/settings').then(setBiz).catch(() => {}); }, []);
  useEffect(() => {
    if (me) nav(me.must_change_password ? '/change-password' : me.role === 'admin' ? '/admin' : loc.state?.from ?? '/', { replace: true });
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const p = normalizePhone(phone);
    if (!p.ok) { setError('invalid_phone'); return; }
    if (!password) { setError('wrong_credentials'); return; }
    setBusy(true);
    try { await login(phone, password); }
    catch (err) { setError(err instanceof ApiFailure ? err.code : 'network'); }
    finally { setBusy(false); }
  };
  const name = lang === 'ur' && biz?.business_name_ur ? biz.business_name_ur : biz?.business_name ?? t('app.name');

  return (
    <div className="login-wrap">
      <div className="login-top" style={{ color: 'var(--text)' }}><HeaderControls /></div>
      <img src="/icons/icon-192.png" alt="" className="login-logo" />
      <div className="center"><h1 style={{ marginBottom: 0 }}>{name}</h1><div className="muted">{t('app.tagline')}</div></div>
      <form className="card login-card stack" onSubmit={submit} noValidate>
        <h2>{t('auth.title')}</h2>
        <label className="field">
          <span>{t('auth.phone')}</span>
          <input className="input ltr" type="tel" inputMode="tel" autoComplete="username" placeholder={t('auth.phoneHint')} value={phone}
            onChange={(e) => setPhone(e.target.value)} aria-invalid={error === 'invalid_phone'} name="phone" required dir="ltr" />
        </label>
        <label className="field">
          <span>{t('auth.password')}</span>
          <input className="input ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} name="password" required dir="ltr" />
        </label>
        {error && <div className="error-box" role="alert"><Icon name="alert" />{te(error, ['auth.err'])}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">{busy ? t('auth.signingIn') : t('auth.signIn')}</button>
        <p className="muted small center" style={{ margin: 0 }}>{t('auth.noAccount')}</p>
      </form>
      <Link to="/install" className="btn btn-ghost"><Icon name="install" />{t('auth.installApp')}</Link>
    </div>
  );
}

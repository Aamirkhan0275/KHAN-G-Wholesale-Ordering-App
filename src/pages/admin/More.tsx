import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useSession } from '../../lib/session';
import { ADMIN_LINKS } from '../../components/Layout';
import { Icon } from '../../components/Icon';
import { InstallGuide } from '../Install';

export default function More() {
  const { t } = useI18n();
  const s = useSession();
  return (
    <main className="page narrow">
      <h1>{t('nav.more')}</h1>
      <div className="list">
        {ADMIN_LINKS.map((l) => <Link key={l.to} to={l.to} className="list-item"><Icon name={l.icon} /><span className="grow title">{t(l.key)}</span><Icon name="chev" className="chev" /></Link>)}
      </div>
      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="row between wrap"><span style={{ fontWeight: 700 }}>{t('theme.label')}</span>
          <div className="segmented">{(['system', 'light', 'dark'] as const).map((th) => <button key={th} aria-pressed={s.theme === th} onClick={() => s.setTheme(th)}>{t(`theme.${th}`)}</button>)}</div></div>
        <Link to="/change-password" className="btn">{t('acc.changePassword')}</Link>
        <button className="btn btn-danger" onClick={() => void s.logout()} data-testid="logout"><Icon name="logout" />{t('auth.signOut')}</button>
      </div>
      <h2 style={{ marginTop: 18 }}>{t('install.title')}</h2>
      <InstallGuide />
    </main>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useSession } from '../lib/session';
import { canPromptInstall, isIOS, isStandalone, onInstallChange, promptInstall } from '../lib/pwa';
import { Icon } from '../components/Icon';
import type { MessageKey } from '../i18n/en';

export function InstallGuide() {
  const { t } = useI18n();
  const [, force] = useState(0);
  useEffect(() => onInstallChange(() => force((x) => x + 1)), []);
  const ios = isIOS();
  const sections: [MessageKey, MessageKey, string][] = [
    ['install.android', 'install.android.steps', 'android'],
    ['install.iphone', 'install.iphone.steps', 'ios'],
    ['install.windows', 'install.windows.steps', 'windows'],
  ];
  if (ios) sections.unshift(sections.splice(1, 1)[0]);
  return (
    <div className="stack">
      <p>{t('install.intro')}</p>
      {isStandalone() ? <div className="ok-box"><Icon name="check" />{t('install.installed')}</div>
        : canPromptInstall() && <button className="btn btn-primary btn-lg" onClick={() => void promptInstall()} data-testid="install-btn"><Icon name="install" />{t('install.button')}</button>}
      {sections.map(([title, steps, id]) => (
        <div className="card flat" key={id} data-platform={id}>
          <h3>{t(title)}</h3>
          <ol style={{ margin: 0, paddingInlineStart: 22 }}>{t(steps).split('|').map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      ))}
      <div className="warn-box"><Icon name="alert" />{t('install.offline')}</div>
    </div>
  );
}

export default function Install() {
  const { t } = useI18n();
  const { me } = useSession();
  return (
    <main className="page narrow" style={{ paddingBottom: 40 }}>
      <div className="page-title"><Link to={me ? (me.role === 'admin' ? '/admin' : '/account') : '/login'} className="btn btn-ghost" aria-label={t('common.back')}><Icon name="back" className="flip-rtl" /></Link><h1>{t('install.title')}</h1></div>
      <InstallGuide />
    </main>
  );
}

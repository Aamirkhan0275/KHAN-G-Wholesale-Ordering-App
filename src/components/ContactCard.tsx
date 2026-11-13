import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { formatPhone } from '../../shared/phone';
import { whatsAppDigits } from '../../shared/whatsapp';

/** The business contact (set by the owner in Settings) shown to shopkeepers. */
export function ContactCard({ name, whatsapp, phone, compact }: { name?: string | null; whatsapp?: string | null; phone?: string | null; compact?: boolean }) {
  const { t } = useI18n();
  const wa = whatsAppDigits(whatsapp ?? null);
  const tel = (phone || whatsapp || '').replace(/[^\d+]/g, '');
  return (
    <div className={`card stack-sm ${compact ? 'flat' : ''}`} data-testid="contact-card">
      <div className="row"><Icon name="store" /><b className="grow">{t('contact.title')}{name ? ` · ${name}` : ''}</b></div>
      {!wa && !tel ? <p className="muted" style={{ margin: 0 }}>{t('contact.notSet')}</p> : (
        <>
          {whatsapp && <div className="ltr num" style={{ fontSize: '1.2rem', fontWeight: 800 }} data-testid="contact-whatsapp">{formatPhone(whatsapp)}</div>}
          {phone && phone !== whatsapp && <div className="ltr num muted" data-testid="contact-phone">{phone}</div>}
          <div className="row wrap">
            {wa && <a className="btn btn-wa grow" href={`https://wa.me/${wa}`} target="_blank" rel="noopener"><Icon name="whatsapp" />{t('contact.whatsapp')}</a>}
            {tel && <a className="btn grow" href={`tel:${tel}`}><Icon name="phone" />{t('contact.call')}</a>}
          </div>
        </>
      )}
    </div>
  );
}

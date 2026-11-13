import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { formatPhone } from '../../../shared/phone';
import { Icon } from '../../components/Icon';
import { ErrorBox, Spinner, Switch, useToast } from '../../components/ui';
import type { MessageKey } from '../../i18n/en';
import { ContactCard } from '../../components/ContactCard';

export function LedgerTable({ entries, money, date, t }: any) {
  return (
    <div className="table-wrap">
      <table className="table stack-mobile" data-testid="ledger">
        <thead><tr><th>{t('common.date')}</th><th>{t('common.note')}</th><th className="num">{t('ledger.debit')}</th><th className="num">{t('ledger.credit')}</th><th className="num">{t('ledger.balance')}</th></tr></thead>
        <tbody>
          {entries.map((e: any) => (
            <tr key={e.id}>
              <td className="num">{date(e.entry_date)}</td>
              <td>{t(`ledger.${e.kind}` as MessageKey)}{e.invoice_no ? <> · <span className="mono">{e.invoice_no}</span></> : ''}{e.reference && !e.invoice_no ? <> · <span className="mono">{e.reference}</span></> : ''}{e.note ? <div className="muted small">{e.note}</div> : null}</td>
              <td className="num">{e.debit ? money(e.debit) : ''}</td>
              <td className="num">{e.credit ? money(e.credit) : ''}</td>
              <td className="num"><b>{money(e.running_balance)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Account() {
  const { t, date, money } = useI18n();
  const s = useSession();
  const toast = useToast();
  const ledger = useApi<{ balance: number; entries: any[] }>('/shop/ledger');
  const invoices = useApi<{ invoices: any[] }>('/shop/invoices');
  const profile = useApi<{ profile: any }>('/shop/profile');
  const [showAll, setShowAll] = useState(false);
  const me = s.me!;
  const bal = ledger.data?.balance ?? 0;
  return (
    <main className="page narrow">
      <h1>{t('acc.title')}</h1>
      <div className="card stack-sm">
        <div className="row"><Icon name="store" /><div className="grow"><div style={{ fontWeight: 800 }}>{me.shop_name}</div><div className="muted small">{me.full_name} · <span className="ltr num">{formatPhone(me.phone)}</span></div></div></div>
      </div>

      <div style={{ marginTop: 12 }}><ContactCard name={s.lang === 'ur' && s.settings?.business_name_ur ? s.settings.business_name_ur : s.settings?.business_name}
        whatsapp={s.settings?.business_whatsapp} phone={s.settings?.business_phone} /></div>

      <div className="card stack-sm" style={{ marginTop: 12 }}>
        <div className="muted" style={{ fontWeight: 700 }}>{bal < 0 ? t('acc.credit') : t('acc.balance')}</div>
        {ledger.loading && !ledger.data ? <Spinner /> : <div style={{ fontSize: '2rem', fontWeight: 900 }} className="num" data-testid="balance">{bal === 0 ? t('acc.balanceZero') : money(Math.abs(bal))}</div>}
        <ErrorBox error={ledger.error} onRetry={ledger.reload} />
      </div>

      <h2 style={{ marginTop: 18 }}>{t('acc.invoices')}</h2>
      {invoices.data && invoices.data.invoices.length === 0 && <p className="muted">{t('acc.noInvoices')}</p>}
      {invoices.data && invoices.data.invoices.length > 0 && (
        <div className="list">
          {invoices.data.invoices.slice(0, showAll ? 200 : 5).map((i) => (
            <Link to={`/invoices/${i.id}`} className="list-item" key={i.id}>
              <Icon name="file" />
              <div className="grow"><div className="title mono">{i.invoice_no}</div><div className="sub">{date(i.issue_date)} · <span className="mono">{i.order_ref}</span></div></div>
              <div className="num" style={{ fontWeight: 800 }}>{money(i.total)}</div>
              {i.status === 'void' && <span className="badge badge-bad">{t('ai.void')}</span>}
            </Link>
          ))}
        </div>
      )}
      {invoices.data && invoices.data.invoices.length > 5 && !showAll && <button className="btn btn-block" style={{ marginTop: 8 }} onClick={() => setShowAll(true)}>{t('common.more')}</button>}

      <h2 style={{ marginTop: 18 }}>{t('acc.ledger')}</h2>
      {ledger.data && ledger.data.entries.length === 0 && <p className="muted">{t('acc.noLedger')}</p>}
      {ledger.data && ledger.data.entries.length > 0 && <LedgerTable entries={ledger.data.entries.slice(0, 30)} money={money} date={date} t={t} />}
      <p className="muted small" style={{ marginTop: 6 }}>{t('ledger.disclaimer')}</p>

      {profile.data && <MyDetails p={profile.data.profile} />}

      <h2 style={{ marginTop: 18 }}>{t('nav.settings')}</h2>
      <div className="card stack">
        <div className="row between wrap"><span style={{ fontWeight: 700 }}>{t('acc.language')}</span>
          <div className="segmented">
            <button aria-pressed={s.lang === 'ur'} onClick={() => s.setLang('ur')} data-testid="lang-ur">اردو</button>
            <button aria-pressed={s.lang === 'en'} onClick={() => s.setLang('en')} data-testid="lang-en">English</button>
          </div>
        </div>
        <div className="row between wrap"><span style={{ fontWeight: 700 }}>{t('theme.label')}</span>
          <div className="segmented">
            {(['system', 'light', 'dark'] as const).map((th) => <button key={th} aria-pressed={s.theme === th} onClick={() => s.setTheme(th)} data-testid={`theme-${th}`}>{t(`theme.${th}`)}</button>)}
          </div>
        </div>
        <div className="row between">
          <div><div style={{ fontWeight: 700 }}>{t('acc.reminders')}</div><div className="muted small">{t('acc.remindersHint')}</div></div>
          <Switch checked={!me.reminders_opt_out} label={t('acc.reminders')} onChange={async (v) => {
            try { await s.setRemindersOptOut(!v); toast(t('common.saved')); } catch { toast(t('common.error'), 'bad'); }
          }} />
        </div>
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        <Link to="/install" className="btn btn-block"><Icon name="install" />{t('acc.install')}</Link>
        <Link to="/change-password" className="btn btn-block">{t('acc.changePassword')}</Link>
        <button className="btn btn-danger btn-block" onClick={() => void s.logout()} data-testid="logout"><Icon name="logout" />{t('auth.signOut')}</button>
      </div>
    </main>
  );
}

function MyDetails({ p }: { p: any }) {
  const { t, date } = useI18n();
  const rows: [string, any, boolean?][] = [
    [t('as.shopName'), p.shop_name], [t('as.ownerName'), p.full_name], [t('auth.phone'), formatPhone(p.phone), true],
    [t('cust.whatsapp'), p.whatsapp_phone && formatPhone(p.whatsapp_phone), true], [t('cust.altPhone'), p.alternate_phone && formatPhone(p.alternate_phone), true],
    [t('as.address'), p.address], [t('cust.area'), p.area], [t('cust.city'), p.city], [t('as.locationNote'), p.location_note],
    [t('cust.shopType'), p.shop_type], [t('cust.email'), p.email, true], [t('cust.cnic'), p.cnic, true], [t('cust.ntn'), p.ntn, true],
    [t('cust.since'), date(p.created_at)],
  ];
  return (
    <>
      <h2 style={{ marginTop: 18 }}>{t('cust.myDetails')}</h2>
      <div className="card" data-testid="my-details">
        <dl className="details">
          {rows.filter(([, v]) => v).map(([k, v, ltr]) => <div key={k}><dt>{k}</dt><dd className={ltr ? 'ltr' : ''}>{v}</dd></div>)}
        </dl>
        <p className="muted small" style={{ margin: '8px 0 0' }}>{t('cust.readOnly')}</p>
      </div>
    </>
  );
}

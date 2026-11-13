import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { Icon } from '../components/Icon';
import { ErrorBox, Spinner } from '../components/ui';

/** Printable invoice (shows Urdu names correctly) + private PDF download. */
export default function InvoiceView() {
  const { id } = useParams();
  const { t, money, date, num } = useI18n();
  const { me } = useSession();
  const { data, error, loading, reload } = useApi<{ invoice: any }>(`/invoices/${id}`);
  const back = me?.role === 'admin' ? '/admin/invoices' : '/account';
  if (loading && !data) return <main className="page"><Spinner /></main>;
  if (error) return <main className="page narrow"><ErrorBox error={error} onRetry={reload} /><Link to={back} className="btn">{t('common.back')}</Link></main>;
  const inv = data!.invoice;
  const biz = inv.business_snapshot ?? {};
  const shop = inv.shop_snapshot ?? {};
  const cur = inv.currency;
  return (
    <main className="page" style={{ maxWidth: 860 }}>
      <div className="row wrap no-print" style={{ marginBottom: 12 }}>
        <Link to={back} className="btn btn-ghost" aria-label={t('common.back')}><Icon name="back" className="flip-rtl" /></Link>
        <div className="grow" />
        <a className="btn btn-primary" href={`/api/invoices/${inv.id}/pdf`} data-testid="invoice-pdf"><Icon name="download" />PDF {t('common.download')}</a>
        <button className="btn" onClick={() => window.print()}><Icon name="file" />{t('common.print')}</button>
      </div>
      <article className="invoice-sheet" data-testid="invoice-sheet">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ color: '#0f6b4a', margin: 0 }}>{biz.name}</h1>
            {biz.name_ur && <div style={{ fontFamily: 'var(--font-ur)' }}>{biz.name_ur}</div>}
            <div style={{ color: '#555', fontSize: '.9rem' }}>{biz.address}{biz.phone ? ` · ${biz.phone}` : ''}{biz.whatsapp ? ` · WhatsApp ${biz.whatsapp}` : ''}</div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <h2 style={{ margin: 0 }}>{t('orders.invoice')}{inv.status === 'void' ? ` (${t('ai.void')})` : ''}</h2>
            <div className="mono">{inv.invoice_no}</div>
            <div>{date(inv.issue_date)}</div>
            <div className="mono" style={{ color: '#555' }}>{inv.order_ref}</div>
          </div>
        </div>
        <hr className="divider" />
        <div style={{ marginBottom: 12 }}><b>{shop.name}</b><div style={{ color: '#555' }}>{shop.full_name} · <span className="ltr">{shop.phone}</span>{shop.address ? ` · ${shop.address}` : ''}</div></div>
        <table>
          <thead><tr><th>#</th><th>{t('common.items')}</th><th className="num">{t('common.qty')}</th><th className="num">{t('ao.unitPrice')}</th><th className="num">{t('common.amount')}</th></tr></thead>
          <tbody>
            {inv.items.map((i: any) => (
              <tr key={i.line_no}><td>{i.line_no}</td><td>{i.name_en}{i.name_ur && <div style={{ fontFamily: 'var(--font-ur)', color: '#555' }}>{i.name_ur}</div>}<div className="mono" style={{ color: '#777', fontSize: '.8rem' }}>{i.sku}</div></td>
                <td className="num">{num(i.qty)} {i.unit_label}</td><td className="num">{money(i.unit_price, cur)}</td><td className="num">{money(i.line_total, cur)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="totals" style={{ maxWidth: 360, marginInlineStart: 'auto', marginTop: 14 }}>
          <span className="strong">{t('common.total')}</span><span className="strong num">{money(inv.total, cur)}</span>
          <span>{t('inv.previous')}</span><span className="num">{money(inv.balance_before, cur)}</span>
          <span className="strong">{t('inv.after')}</span><span className="strong num">{money(inv.balance_after, cur)}</span>
        </div>
        {biz.footer && <p style={{ color: '#555', marginTop: 16 }}>{biz.footer}</p>}
        <p style={{ color: '#777', fontSize: '.8rem' }}>{t('ledger.disclaimer')}</p>
      </article>
    </main>
  );
}

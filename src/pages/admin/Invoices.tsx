import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { Empty, ErrorBox, Spinner } from '../../components/ui';
import { Icon } from '../../components/Icon';

export default function Invoices() {
  const { t, money, date } = useI18n();
  const { data, error, loading, reload } = useApi<{ invoices: any[] }>('/admin/invoices');
  return (
    <main className="page">
      <h1>{t('nav.invoices')}</h1>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && data.invoices.length === 0 && <Empty icon="file">{t('ai.empty')}</Empty>}
      {data && data.invoices.length > 0 && (
        <div className="table-wrap">
          <table className="table stack-mobile" data-testid="invoices-table">
            <thead><tr><th>#</th><th>{t('acc.shop')}</th><th>{t('done.ref')}</th><th>{t('common.date')}</th><th className="num">{t('common.total')}</th><th>{t('common.status')}</th><th></th></tr></thead>
            <tbody>{data.invoices.map((i) => (
              <tr key={i.id}><td><Link to={`/admin/invoices/${i.id}`} className="mono">{i.invoice_no}</Link></td><td>{i.shop}</td><td><Link to={`/admin/orders/${i.order_id}`} className="mono">{i.order_ref}</Link></td>
                <td>{date(i.issue_date)}</td><td className="num">{money(i.total, i.currency)}</td>
                <td>{i.status === 'void' ? <span className="badge badge-bad"><Icon name="x" />{t('ai.void')}</span> : <span className="badge badge-ok"><Icon name="check" />{t('ai.issued')}</span>}</td>
                <td><a className="btn btn-sm" href={`/api/invoices/${i.id}/pdf`}><Icon name="download" size={18} />PDF</a></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}

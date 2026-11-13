import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { ErrorBox, Spinner, Switch, useConfirm, useToast } from '../../components/ui';

export default function Categories() {
  const { t, te, num } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi<{ categories: any[] }>('/admin/categories');
  const [nameEn, setNameEn] = useState('');
  const [nameUr, setNameUr] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); toast(t('common.saved')); await reload(); } catch (e) { setErr(e instanceof ApiFailure ? e.code : 'network'); }
  };
  return (
    <main className="page narrow">
      <h1>{t('nav.categories')}</h1>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); void run(() => api('/admin/categories', { body: { name_en: nameEn, name_ur: nameUr || null, sort_order: (data?.categories.length ?? 0) * 10 } })).then(() => { setNameEn(''); setNameUr(''); }); }}>
        <div className="form-grid">
          <input className="input" required placeholder={t('ap.nameEn')} value={nameEn} onChange={(e) => setNameEn(e.target.value)} aria-label={t('ap.nameEn')} />
          <input className="input" placeholder={t('ap.nameUr')} dir="rtl" value={nameUr} onChange={(e) => setNameUr(e.target.value)} aria-label={t('ap.nameUr')} />
        </div>
        <button className="btn btn-primary"><Icon name="plus" />{t('ac.add')}</button>
      </form>
      {err && <div className="error-box" style={{ marginTop: 10 }}>{te(err, ['ac.err'])}</div>}
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      <div className="list" style={{ marginTop: 12 }}>
        {data?.categories.map((c) => (
          <div className="list-item" key={c.id}>
            <div className="grow"><div className="title">{c.name_en} {c.name_ur && <span className="muted" dir="rtl">· {c.name_ur}</span>}</div><div className="sub">{t('ac.products', { n: num(c.product_count) })}</div></div>
            <Switch checked={c.is_active} label={c.name_en} onChange={(v) => void run(() => api(`/admin/categories/${c.id}`, { method: 'PATCH', body: { is_active: v } }))} />
            <button className="btn btn-sm btn-ghost" aria-label={t('common.edit')} onClick={async () => {
              const en = window.prompt(t('ap.nameEn'), c.name_en); if (en === null) return;
              const urName = window.prompt(t('ap.nameUr'), c.name_ur ?? ''); if (urName === null) return;
              await run(() => api(`/admin/categories/${c.id}`, { method: 'PATCH', body: { name_en: en, name_ur: urName || null } }));
            }}><Icon name="edit" size={18} /></button>
            <button className="btn btn-sm btn-ghost" aria-label={t('common.delete')} onClick={async () => {
              if (await confirm({ message: `${t('common.delete')}: ${c.name_en}?`, danger: true })) await run(() => api(`/admin/categories/${c.id}`, { method: 'DELETE' }));
            }}><Icon name="trash" size={18} /></button>
          </div>
        ))}
      </div>
    </main>
  );
}

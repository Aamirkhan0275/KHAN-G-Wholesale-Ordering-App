import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { MAX_LINE_QTY } from '../../shared/cart';

export function Spinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return <div role="status" aria-live="polite"><div className="spinner" /><span className="sr-only">{label ?? t('common.loading')}</span></div>;
}

export function Empty({ icon = 'box', children, action }: { icon?: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><Icon name={icon} /><div>{children}</div>{action}</div>;
}

export function ErrorBox({ error, onRetry, prefixes }: { error: { code: string } | null | undefined; onRetry?: () => void; prefixes?: string[] }) {
  const { t, te } = useI18n();
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" />
      <div className="grow">{te(error.code, prefixes)}</div>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = MAX_LINE_QTY, label, disabled }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label: string; disabled?: boolean;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Math.floor(Number(raw.replace(/[^\d]/g, '') || '0'));
    const v = Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
    setText(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="minus" aria-label={`${t('qty.decrease')} – ${label}`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <input inputMode="numeric" pattern="[0-9]*" aria-label={`${t('qty.label')} – ${label}`} value={text} disabled={disabled}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />
      <button type="button" className="plus" aria-label={`${t('qty.increase')} – ${label}`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" /><span className="thumb" />
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>;
}

const STATUS_STYLE: Record<string, { cls: string; icon: string }> = {
  submitted: { cls: 'badge-info', icon: 'clock' },
  checking: { cls: 'badge-warn', icon: 'search' },
  needs_confirmation: { cls: 'badge-warn', icon: 'alert' },
  confirmed: { cls: 'badge-ok', icon: 'check' },
  ready: { cls: 'badge-ok', icon: 'truck' },
  delivered: { cls: 'badge-ok', icon: 'check' },
  cancelled: { cls: 'badge-bad', icon: 'x' },
};

/** Status is shown with text + icon (never colour alone). */
export function StatusBadge({ status, admin }: { status: string; admin?: boolean }) {
  const { t } = useI18n();
  const s = STATUS_STYLE[status] ?? { cls: 'badge-muted', icon: 'clock' };
  const adminKey = `status.admin.${status}` as MessageKey;
  const label = admin && ['submitted', 'checking', 'needs_confirmation'].includes(status) ? t(adminKey) : t(`status.${status}` as MessageKey);
  return <span className={`badge ${s.cls}`} data-status={status}><Icon name={s.icon} />{label}</span>;
}

const LINE_STYLE: Record<string, { cls: string; icon: string }> = {
  pending: { cls: 'badge-muted', icon: 'clock' },
  available: { cls: 'badge-ok', icon: 'check' },
  partial: { cls: 'badge-warn', icon: 'alert' },
  unavailable: { cls: 'badge-bad', icon: 'ban' },
  substituted: { cls: 'badge-warn', icon: 'repeat' },
  added: { cls: 'badge-info', icon: 'plus' },
};
export function LineBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const s = LINE_STYLE[status] ?? LINE_STYLE.pending;
  return <span className={`badge ${s.cls}`}><Icon name={s.icon} />{t(`line.${status}` as MessageKey)}</span>;
}

export function AvailabilityBadge({ availability }: { availability: 'in' | 'low' | 'out' }) {
  const { t } = useI18n();
  if (availability === 'out') return <span className="badge badge-bad"><Icon name="ban" />{t('cat.outOfStock')}</span>;
  if (availability === 'low') return <span className="badge badge-warn"><Icon name="alert" />{t('cat.lowStock')}</span>;
  return <span className="badge badge-ok"><Icon name="check" />{t('cat.inStock')}</span>;
}

// ------------------------------------------------------------------ dialogs
interface ConfirmOpts { message: string; confirmLabel?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'bad') => void>(() => {});

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: 'ok' | 'bad' }[]>([]);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const toast = useCallback((msg: string, kind: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 3800);
  }, []);
  const close = (v: boolean) => { confirm?.resolve(v); setConfirm(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      <ToastCtx.Provider value={toast}>
        {children}
        <div className="toast-wrap" aria-live="polite">
          {toasts.map((x) => <div key={x.id} className={`toast ${x.kind === 'bad' ? 'bad' : ''}`} role="status"><Icon name={x.kind === 'bad' ? 'alert' : 'check'} />{x.msg}</div>)}
        </div>
        {confirm && (
          <Modal title={t('common.confirm')} onClose={() => close(false)}>
            <p>{confirm.message}</p>
            <div className="actions">
              <button className="btn" onClick={() => close(false)}>{t('common.no')}</button>
              <button className={`btn ${confirm.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} data-testid="confirm-yes">{confirm.confirmLabel ?? t('common.yes')}</button>
            </div>
          </Modal>
        )}
      </ToastCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);
export const useToast = () => useContext(ToastCtx);

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleAlert, AudioLines, Info, X } from 'lucide-react';
import type { EChartsOption, EChartsType } from 'echarts';
import { effectiveTheme, usePreferences } from './state';
export function PageHead({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Alert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'warn' | 'info';
}) {
  return (
    <div className={`alert ${tone === 'error' ? '' : tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'info' ? <Info size={18} /> : <CircleAlert size={18} />}
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <AudioLines size={28} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Metric({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}
export function StartLink() {
  return (
    <Link className="button primary" to="/studio">
      Nueva práctica <ArrowUpRight size={18} />
    </Link>
  );
}
export function Confirm({
  title,
  children,
  onCancel,
  onConfirm,
  confirmLabel = 'Confirmar eliminación',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  busy = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`confirm${wide ? ' wide' : ''}`}
      aria-labelledby="confirm-title"
      onCancel={(e) => (busy ? e.preventDefault() : onCancel())}
    >
      <button className="icon-button close" aria-label="Cerrar" onClick={onCancel} disabled={busy}>
        <X size={18} />
      </button>
      <h2 id="confirm-title">{title}</h2>
      <div className="confirm-body">{children}</div>
      <div className="actions">
        <button className="button secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button className={`button ${tone}`} onClick={onConfirm} disabled={busy} aria-busy={busy}>
          {busy ? 'Procesando…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
export function Chart({
  option,
  label,
  onPointClick,
}: {
  option: EChartsOption;
  label: string;
  /** Recibe el valor del eje X del punto pulsado. */
  onPointClick?: (x: number) => void;
}) {
  const click = useRef(onPointClick);
  click.current = onPointClick;
  const ref = useRef<HTMLDivElement>(null),
    chart = useRef<EChartsType | null>(null),
    theme = effectiveTheme(usePreferences((s) => s.theme));
  useEffect(() => {
    let disposed = false;
    const element = ref.current;
    const resize = new ResizeObserver(() => chart.current?.resize());
    if (element) resize.observe(element);
    void import('./echarts').then((echarts) => {
      if (disposed || !element) return;
      chart.current = echarts.init(element, undefined, { renderer: 'canvas' });
      chart.current.setOption({
        ...option,
        backgroundColor: 'transparent',
        textStyle: { color: theme === 'dark' ? '#c9cee3' : '#4b5470', fontFamily: 'system-ui' },
        color:
          theme === 'dark'
            ? ['#a3a8ff', '#c7a6ff', '#74dca6', '#f2c76d']
            : ['#3a3dd6', '#6d3fd6', '#12704a', '#8a5300'],
        animation: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
      chart.current.getZr().on('click', (e) => {
        if (!chart.current || !click.current) return;
        const point = chart.current.convertFromPixel({ seriesIndex: 0 }, [e.offsetX, e.offsetY]) as
          number[] | undefined;
        if (point && Number.isFinite(point[0])) click.current(point[0]!);
      });
    });
    return () => {
      disposed = true;
      resize.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, [option, theme]);
  return <div ref={ref} className="chart" role="img" aria-label={label} />;
}
export function AudioPlayer({
  blob,
  playerRef,
}: {
  blob: Blob;
  playerRef?: React.RefObject<HTMLAudioElement | null>;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob),
      element = playerRef?.current ?? ref.current;
    if (element) element.src = url;
    return () => {
      element?.pause();
      element?.removeAttribute('src');
      element?.load();
      URL.revokeObjectURL(url);
    };
  }, [blob, playerRef]);
  return <audio ref={playerRef ?? ref} controls preload="metadata" aria-label="Reproducir grabación" />;
}
export function Toggle({
  checked,
  onChange,
  title,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-field${disabled ? ' disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        {children && <small>{children}</small>}
      </span>
    </label>
  );
}

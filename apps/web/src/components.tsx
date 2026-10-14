import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleAlert, AudioLines, X } from 'lucide-react';
import type { EChartsOption, EChartsType } from 'echarts';
import { usePreferences } from './state';
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
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      <CircleAlert size={18} />
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
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="confirm" aria-labelledby="confirm-title" onCancel={onCancel}>
      <button className="icon-button close" aria-label="Cerrar confirmación" onClick={onCancel}>
        <X size={18} />
      </button>
      <h2 id="confirm-title">{title}</h2>
      <p>{children}</p>
      <div className="actions">
        <button className="button secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button className="button danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
export function Chart({ option, label }: { option: EChartsOption; label: string }) {
  const ref = useRef<HTMLDivElement>(null),
    chart = useRef<EChartsType | null>(null),
    theme = usePreferences((s) => s.theme);
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
        textStyle: { color: theme === 'dark' ? '#cbd5d8' : '#556570', fontFamily: 'system-ui' },
        animation: !matchMedia('(prefers-reduced-motion: reduce)').matches,
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

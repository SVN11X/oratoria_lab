import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import {
  AudioLines,
  Home as HomeIcon,
  BookOpen,
  History,
  TrendingUp,
  Settings,
  Sun,
  Moon,
  Menu,
  X,
  ArrowUpRight,
  ShieldCheck,
} from 'lucide-react';
import { usePreferences, useSessions, effectiveTheme } from './state';
import { Alert } from './components';
import { useAi } from './ai/settings';
import { useAiStatus } from './ai/status';

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const Practices = lazy(() => import('./pages/Practices').then((m) => ({ default: m.Practices })));
const PracticeFlow = lazy(() => import('./pages/Practices').then((m) => ({ default: m.PracticeFlow })));
const SavedReport = lazy(() => import('./pages/Practices').then((m) => ({ default: m.SavedReport })));
const FreePractice = lazy(() => import('./pages/FreePractice').then((m) => ({ default: m.FreePractice })));
const HistoryPage = lazy(() => import('./pages/History').then((m) => ({ default: m.History })));
const SessionPage = lazy(() => import('./pages/Session').then((m) => ({ default: m.SessionPage })));
const ProgressPage = lazy(() => import('./pages/Progress').then((m) => ({ default: m.Progress })));
const SettingsPage = lazy(() => import('./pages/settings/Settings').then((m) => ({ default: m.Settings })));

const links = [
  { path: '/', name: 'Inicio', icon: HomeIcon },
  { path: '/practice', name: 'Prácticas guiadas', icon: BookOpen },
  { path: '/history', name: 'Historial', icon: History },
  { path: '/progress', name: 'Mi progreso', icon: TrendingUp },
  { path: '/settings', name: 'Configuración', icon: Settings },
];
const NAMES: [RegExp, string][] = [
  [/^\/practice\/libre/, 'Práctica libre'],
  [/^\/practice\/analizar/, 'Analizar grabación'],
  [/^\/practice\/record/, 'Informe de práctica'],
  [/^\/practice/, 'Prácticas guiadas'],
  [/^\/history/, 'Historial'],
  [/^\/session/, 'Análisis de grabación'],
  [/^\/progress/, 'Mi progreso'],
  [/^\/settings/, 'Configuración'],
  [/^\/$/, 'Inicio'],
];

function Shell() {
  const [open, setOpen] = useState(false),
    { theme, update, fontSize, reducedMotion } = usePreferences(),
    reload = useSessions((s) => s.reload),
    location = useLocation();
  const useLlm = useAi((s) => s.useLlm);
  const status = useAiStatus();
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const shown = theme === 'system' ? (systemDark ? 'dark' : 'light') : effectiveTheme(theme);
  useEffect(() => {
    document.documentElement.dataset.theme = shown;
    document.documentElement.style.fontSize = `${fontSize}px`;
    if (reducedMotion) document.documentElement.dataset.motion = 'reduce';
    else delete document.documentElement.dataset.motion;
  }, [shown, fontSize, reducedMotion]);
  const pageName = NAMES.find(([rx]) => rx.test(location.pathname))?.[1] ?? 'Oratoria Lab';
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Ir al contenido
      </a>
      <aside id="sidebar" className={`sidebar ${open ? 'open' : ''}`}>
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">
            <AudioLines size={24} />
          </span>
          <span>
            Oratoria Lab
            <small>ENTRENAMIENTO LOCAL</small>
          </span>
        </Link>
        <button
          className="mobile-close icon-button"
          aria-label="Cerrar navegación"
          onClick={() => setOpen(false)}
        >
          <X size={22} />
        </button>
        <nav aria-label="Navegación principal">
          {links.map((l) => (
            <NavLink
              key={l.path}
              to={l.path}
              end={l.path === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <l.icon size={19} />
              <span>{l.name}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link to="/settings/models" className="ai-status" onClick={() => setOpen(false)}>
            <strong>Estado de la IA</strong>
            <span className="row">
              <span className={`dot ${status.llm === 'ok' ? 'on' : status.llm === 'off' ? '' : 'warn'}`} />
              {status.llmText}
            </span>
            <span className="row">
              <span className={`dot ${status.stt === 'local' ? 'on' : 'warn'}`} />
              {status.sttText}
            </span>
          </Link>
          <p>
            <ShieldCheck size={14} style={{ verticalAlign: '-2px' }} /> Sin cuentas ni telemetría.{' '}
            {useLlm ? 'Modelos en tu equipo.' : 'Procesamiento local.'} v0.2.0
          </p>
        </div>
      </aside>
      {open && <button className="nav-backdrop" aria-label="Cerrar menú" onClick={() => setOpen(false)} />}
      <div className="workspace">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              aria-label="Abrir navegación"
              aria-expanded={open}
              aria-controls="sidebar"
              onClick={() => setOpen(!open)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              Oratoria Lab / <strong>{pageName}</strong>
            </span>
          </div>
          <div className="topbar-right row-wrap">
            <span className="local-status">
              <span className={`dot ${status.llm === 'ok' ? 'on' : ''}`} />{' '}
              {status.llm === 'ok' ? 'IA local conectada' : 'Procesamiento local'}
            </span>
            <button
              className="icon-button"
              onClick={() => update({ theme: shown === 'light' ? 'dark' : 'light' })}
              aria-label={shown === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
            >
              {shown === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Suspense
            fallback={
              <div className="page-loading" role="status">
                <span className="spinner" />
                Abriendo…
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/practice" element={<Practices />} />
              <Route path="/practice/libre" element={<FreePractice mode="record" />} />
              <Route path="/practice/analizar" element={<FreePractice mode="import" />} />
              <Route path="/practice/record/:id" element={<SavedReport />} />
              <Route path="/practice/:scenario" element={<PracticeFlow />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/session/:id" element={<SessionPage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/settings" element={<Navigate to="/settings/models" replace />} />
              <Route path="/settings/:section" element={<SettingsPage />} />
              {/* Rutas anteriores */}
              <Route path="/defense" element={<Navigate to="/practice/tesis" replace />} />
              <Route path="/studio" element={<Navigate to="/practice/libre" replace />} />
              <Route path="/models" element={<Navigate to="/settings/models" replace />} />
              <Route path="/rubrics" element={<Navigate to="/practice" replace />} />
              <Route
                path="*"
                element={
                  <>
                    <h1>Esta página no existe.</h1>
                    <Link to="/" className="button primary" style={{ marginTop: 16 }}>
                      Volver al inicio <ArrowUpRight size={17} />
                    </Link>
                  </>
                }
              />
            </Routes>
          </Suspense>
          <footer className="footer">
            <span>Oratoria Lab · entrenamiento local, privado y gratuito.</span>
            <span>Las evaluaciones automáticas orientan; no reemplazan a tus profesores.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="fatal-error">
        <h1>No se pudo mostrar esta pantalla.</h1>
        <Alert>
          Tus sesiones guardadas permanecen en el almacenamiento local. Recarga para intentarlo de nuevo.
        </Alert>
        <button className="button primary" onClick={() => window.location.reload()}>
          Recargar
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ErrorBoundary>
  );
}

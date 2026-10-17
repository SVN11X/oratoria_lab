import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation, Link } from 'react-router-dom';
import {
  AudioLines,
  LayoutDashboard,
  Mic,
  History,
  BookOpen,
  ListChecks,
  Cpu,
  Settings,
  ShieldCheck,
  Sun,
  Moon,
  Menu,
  X,
  ArrowUpRight,
  Presentation,
} from 'lucide-react';
import { usePreferences, useSessions } from './state';
import { Alert } from './components';
const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const Studio = lazy(() => import('./pages/Studio').then((m) => ({ default: m.Studio })));
const HistoryPage = lazy(() => import('./pages/History').then((m) => ({ default: m.History })));
const SessionPage = lazy(() => import('./pages/Session').then((m) => ({ default: m.SessionPage })));
const Practice = lazy(() => import('./pages/Practice').then((m) => ({ default: m.Practice })));
const DefensePage = lazy(() => import('./pages/Defense').then((m) => ({ default: m.Defense })));
const Rubrics = lazy(() => import('./pages/Rubrics').then((m) => ({ default: m.Rubrics })));
const Models = lazy(() => import('./pages/Models').then((m) => ({ default: m.Models })));
const Preferences = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const links = [
  { path: '/', name: 'Resumen', icon: LayoutDashboard },
  { path: '/studio', name: 'Estudio de grabación', icon: Mic },
  { path: '/history', name: 'Mis sesiones', icon: History },
  { path: '/practice', name: 'Prácticas guiadas', icon: BookOpen },
  { path: '/defense', name: 'Simulador de defensa', icon: Presentation },
  { path: '/rubrics', name: 'Rúbricas', icon: ListChecks },
  { path: '/models', name: 'Modelos locales', icon: Cpu },
  { path: '/settings', name: 'Preferencias', icon: Settings },
];
function Shell() {
  const [open, setOpen] = useState(false),
    { theme, update } = usePreferences(),
    reload = useSessions((s) => s.reload),
    location = useLocation();
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const pageName = links.find((l) => l.path === location.pathname)?.name ?? 'Análisis de sesión';
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
            <AudioLines size={27} />
          </span>
          <span>
            oratoria<span className="brand-lab">lab</span>
            <small>UN ESPACIO PARA TU VOZ</small>
          </span>
        </Link>
        <button
          className="mobile-close icon-button"
          aria-label="Cerrar navegación"
          onClick={() => setOpen(false)}
        >
          <X size={22} />
        </button>
        <span className="nav-label">TU LABORATORIO</span>
        <nav aria-label="Navegación principal">
          {links.map((l) => (
            <NavLink
              key={l.path}
              to={l.path}
              end={l.path === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `${isActive ? 'active ' : ''}${l.path === '/models' ? 'nav-divider' : ''}`
              }
            >
              <l.icon size={19} />
              <span>{l.name}</span>
              {l.path === '/studio' && <span className="nav-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-stamp">
            <ShieldCheck size={23} />
            <div>
              <strong>Tu práctica es local</strong>
              <small>Sin cuentas. Tú decides qué exportar.</small>
            </div>
          </div>
          <p>
            Oratoria Lab <span>v0.1.0</span>
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
              Mi laboratorio <span>/</span> <strong>{pageName}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-status">
              <span className="dot" /> Procesamiento local
            </span>
            <button
              className="icon-button"
              onClick={() => update({ theme: theme === 'light' ? 'dark' : 'light' })}
              aria-label={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
            >
              {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Suspense
            fallback={
              <div className="page-loading" role="status">
                <span className="spinner" />
                Abriendo tu laboratorio…
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/session/:id" element={<SessionPage />} />
              <Route path="/practice" element={<Practice />} />
              <Route path="/defense" element={<DefensePage />} />
              <Route path="/rubrics" element={<Rubrics />} />
              <Route path="/models" element={<Models />} />
              <Route path="/settings" element={<Preferences />} />
              <Route
                path="*"
                element={
                  <>
                    <h1>Esta página no existe.</h1>
                    <Link to="/" className="button primary">
                      Volver al resumen <ArrowUpRight size={17} />
                    </Link>
                  </>
                }
              />
            </Routes>
          </Suspense>
          <footer className="footer">
            <span>Práctica real. Datos explicables.</span>
            <span>Diseñado para aprender a tu ritmo.</span>
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

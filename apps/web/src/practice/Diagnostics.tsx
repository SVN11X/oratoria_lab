import { TIMING_LABELS, type DiagnosticReport, type TimingKey } from '@oratoria/conversation';

export function Diagnostics({ report }: { report: DiagnosticReport }) {
  const latest = report.turns.at(-1);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oratoria-diagnostico-turnos.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <details className="panel">
      <summary>Diagnóstico avanzado</summary>
      <p className="caption">
        {latest?.id ?? 'Sin turnos'} · {latest?.provider ?? '—'} · {latest?.model ?? 'Reglas'}
      </p>
      <p className="caption">
        Tiempos en ms; velocidad en tokens/s. Una celda vacía indica que no se midió. p50/p95 usan los turnos
        medidos de esta sesión.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th scope="col">Medición</th>
              <th scope="col">Último</th>
              <th scope="col">p50</th>
              <th scope="col">p95</th>
              <th scope="col">n</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(TIMING_LABELS) as TimingKey[]).map((key) => {
              const p = report.percentiles[key];
              const show = (n: number | undefined) =>
                n === undefined ? '—' : n.toLocaleString('es-CL', { maximumFractionDigits: 1 });
              return (
                <tr key={key}>
                  <th scope="row">{TIMING_LABELS[key]}</th>
                  <td>{show(latest?.timings[key])}</td>
                  <td>{show(p?.p50)}</td>
                  <td>{show(p?.p95)}</td>
                  <td>{p?.n ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="caption">
        La exportación incluye solo modelo, proveedor, identificadores y mediciones. No incluye tesis,
        transcripciones ni direcciones del servidor. RAM/VRAM se consultan en Configuración cuando la
        plataforma permite medirlas.
      </p>
      <button className="button secondary small" onClick={download} disabled={!latest}>
        Exportar diagnóstico sin contenido
      </button>
    </details>
  );
}

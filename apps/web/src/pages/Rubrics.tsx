import { useEffect, useState } from 'react';
import { Save, Copy, Plus, Trash2 } from 'lucide-react';
import { type Rubric, RubricSchema, errorMessage } from '@oratoria/core';
import { INITIAL_RUBRICS } from '@oratoria/evaluation';
import { rubricStore } from '@oratoria/storage';
import { PageHead, Alert } from '../components';
export function Rubrics() {
  const [all, setAll] = useState<Rubric[]>(INITIAL_RUBRICS),
    [rubric, setRubric] = useState<Rubric>(structuredClone(INITIAL_RUBRICS[0]!)),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  useEffect(() => {
    void rubricStore
      .list()
      .then((saved) => setAll([...INITIAL_RUBRICS, ...saved]))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  async function save() {
    setError('');
    setStatus('');
    try {
      const custom = rubric.id.startsWith('custom-'),
        versions = all.filter((r) => r.id === rubric.id).map((r) => r.version);
      const next = RubricSchema.parse({
        ...rubric,
        id: custom ? rubric.id : 'custom-' + crypto.randomUUID(),
        version: custom ? Math.max(...versions, rubric.version) + 1 : 1,
      });
      await rubricStore.save(next);
      const saved = await rubricStore.list();
      setAll([...INITIAL_RUBRICS, ...saved]);
      setRubric(next);
      setStatus(`Guardada ${next.name} v${next.version}. Las versiones anteriores se conservaron.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <>
      <PageHead
        eyebrow="RÚBRICAS"
        title="Define lo que quieres observar."
        description="Edita indicadores, descriptores y pesos. Cada guardado crea una versión; las sesiones conservan una copia de la rúbrica aplicada."
      />
      {error && <Alert>{error}</Alert>}
      {status && (
        <p role="status" className="status-line">
          {status}
        </p>
      )}
      <section className="panel">
        <div className="form-grid">
          <label className="field">
            Partir de una rúbrica
            <select
              value={`${rubric.id}@${rubric.version}`}
              onChange={(e) => {
                const chosen = all.find((r) => `${r.id}@${r.version}` === e.target.value);
                if (chosen) setRubric(structuredClone(chosen));
              }}
            >
              {all.map((r) => (
                <option key={`${r.id}@${r.version}`} value={`${r.id}@${r.version}`}>
                  {r.name} · v{r.version}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Nombre
            <input
              value={rubric.name}
              maxLength={100}
              onChange={(e) => setRubric({ ...rubric, name: e.target.value })}
            />
          </label>
        </div>
        <p className="caption">
          Los pesos se normalizan sobre los criterios evaluados. «No evaluable» no equivale a cero. Los
          descriptores iniciales son plantillas que puedes precisar para tu tarea.
        </p>
        {rubric.criteria.map((c, i) => (
          <div className="rubric-editor" key={c.id}>
            <div className="section-heading">
              <h3>Criterio {i + 1}</h3>
              <button
                className="icon-button"
                aria-label={`Quitar criterio ${i + 1}`}
                disabled={rubric.criteria.length <= 1}
                onClick={() =>
                  setRubric({ ...rubric, criteria: rubric.criteria.filter((x) => x.id !== c.id) })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="form-grid">
              <label className="field">
                Nombre del criterio
                <input
                  value={c.name}
                  maxLength={100}
                  onChange={(e) =>
                    setRubric({
                      ...rubric,
                      criteria: rubric.criteria.map((x) =>
                        x.id === c.id ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                Peso relativo
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={c.weight}
                  onChange={(e) =>
                    setRubric({
                      ...rubric,
                      criteria: rubric.criteria.map((x) =>
                        x.id === c.id ? { ...x, weight: Number(e.target.value) } : x,
                      ),
                    })
                  }
                />
              </label>
            </div>
            <label className="field">
              Indicador observable
              <textarea
                rows={2}
                value={c.indicator}
                maxLength={500}
                onChange={(e) =>
                  setRubric({
                    ...rubric,
                    criteria: rubric.criteria.map((x) =>
                      x.id === c.id ? { ...x, indicator: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
            <div className="form-grid">
              {c.descriptors.map((d, n) => (
                <label key={n} className="field">
                  Descriptor nivel {n}
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={d}
                    onChange={(e) =>
                      setRubric({
                        ...rubric,
                        criteria: rubric.criteria.map((x) => {
                          if (x.id !== c.id) return x;
                          const descriptors = [...x.descriptors] as typeof x.descriptors;
                          descriptors[n] = e.target.value;
                          return { ...x, descriptors };
                        }),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="actions">
          <button
            className="button secondary"
            disabled={rubric.criteria.length >= 20}
            onClick={() =>
              setRubric({
                ...rubric,
                criteria: [
                  ...rubric.criteria,
                  {
                    id: crypto.randomUUID(),
                    name: 'Nuevo criterio',
                    indicator: 'Describe una conducta verificable en el texto.',
                    weight: 25,
                    descriptors: ['', '', '', ''],
                  },
                ],
              })
            }
          >
            <Plus size={16} /> Añadir criterio
          </button>
          <button className="button primary" onClick={save}>
            <Save size={17} /> Guardar nueva versión
          </button>
          <button
            className="button quiet"
            onClick={() => {
              setRubric({
                ...rubric,
                id: 'custom-' + crypto.randomUUID(),
                version: 0,
                name: `${rubric.name} (copia)`.slice(0, 100),
              });
            }}
          >
            <Copy size={16} /> Crear otra copia
          </button>
        </div>
      </section>
    </>
  );
}

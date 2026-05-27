import type * as React from 'react';
import { ColorKey, COLOR_PALETTE, type Report } from '@astrolens/schema';
import type { Action } from './state.js';
import { useUi } from './i18n.js';

interface Props {
  report: Report;
  imageName: string;
  selectedId: string | null;
  dirty: boolean;
  dispatch: React.Dispatch<Action>;
  onSave: () => void;
}

export function Sidebar({
  report,
  imageName,
  selectedId,
  dirty,
  dispatch,
  onSave,
}: Props): React.JSX.Element {
  const { t } = useUi();
  const obj = report.object;
  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div>
          <h1>{obj.name}</h1>
          <p className="muted">
            {obj.type}
            {obj.stage ? ` · ${t.stagePrefix} ${obj.stage}` : ''} · {imageName}
          </p>
        </div>
        <button className="save" onClick={onSave} disabled={!dirty}>
          {dirty ? t.save : t.saved}
        </button>
      </header>

      <section className="block">
        <label className="field-label">{t.narrative}</label>
        <textarea
          className="narrative"
          value={report.narrative}
          rows={5}
          onFocus={() => dispatch({ type: 'beginChange' })}
          onChange={(e) =>
            dispatch({ type: 'setNarrative', value: e.target.value, commit: false })
          }
        />
      </section>

      <section className="block">
        <div className="block-head">
          <label className="field-label">
            {t.featuresLabel} ({report.features.length})
          </label>
          <button onClick={() => dispatch({ type: 'addFeature' })}>{t.add}</button>
        </div>

        {report.features.map((f) => {
          const selected = f.id === selectedId;
          return (
            <div
              key={f.id}
              className={`feature-card${selected ? ' selected' : ''}`}
              onMouseDown={() => dispatch({ type: 'select', id: f.id })}
            >
              <div className="feature-row">
                <span className="badge-dot" style={{ background: COLOR_PALETTE[f.color_key].badge }}>
                  {f.badge.num}
                </span>
                <input
                  className="label-input"
                  value={f.label}
                  onFocus={() => dispatch({ type: 'beginChange' })}
                  onChange={(e) =>
                    dispatch({ type: 'setFeatureText', id: f.id, field: 'label', value: e.target.value, commit: false })
                  }
                />
                <button
                  className="delete"
                  title={t.deleteFeature}
                  onClick={() => dispatch({ type: 'deleteFeature', id: f.id })}
                >
                  ✕
                </button>
              </div>

              <div className="feature-row">
                <select
                  value={f.color_key}
                  onChange={(e) =>
                    dispatch({ type: 'setColor', id: f.id, color: e.target.value as ColorKey })
                  }
                >
                  {ColorKey.options.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <input
                  className="num-input"
                  value={f.badge.num}
                  title={t.badgeNum}
                  onFocus={() => dispatch({ type: 'beginChange' })}
                  onChange={(e) =>
                    dispatch({ type: 'setBadgeNum', id: f.id, num: e.target.value, commit: false })
                  }
                />
              </div>

              <textarea
                className="explanation"
                value={f.explanation}
                rows={3}
                placeholder={t.phExplanation}
                onFocus={() => dispatch({ type: 'beginChange' })}
                onChange={(e) =>
                  dispatch({ type: 'setFeatureText', id: f.id, field: 'explanation', value: e.target.value, commit: false })
                }
              />
              <textarea
                className="explanation"
                value={f.physics ?? ''}
                rows={2}
                placeholder={t.phPhysics}
                onFocus={() => dispatch({ type: 'beginChange' })}
                onChange={(e) =>
                  dispatch({ type: 'setFeatureText', id: f.id, field: 'physics', value: e.target.value, commit: false })
                }
              />
              <textarea
                className="explanation"
                value={f.interesting ?? ''}
                rows={2}
                placeholder={t.phInteresting}
                onFocus={() => dispatch({ type: 'beginChange' })}
                onChange={(e) =>
                  dispatch({ type: 'setFeatureText', id: f.id, field: 'interesting', value: e.target.value, commit: false })
                }
              />
            </div>
          );
        })}
      </section>
    </aside>
  );
}

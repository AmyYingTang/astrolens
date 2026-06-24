import type * as React from 'react';
import { useState } from 'react';
import {
  COLOR_PALETTE,
  otypeLabel,
  formatRaHms,
  formatDecDms,
  type FactSheet,
  type Reading,
} from '@astrolens/schema';
import { useUi } from './i18n.js';

export interface ReidentifyOptions {
  starMagMax?: number;
}

interface Props {
  reading: Reading;
  factsheet: FactSheet | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onReidentify: (opts: ReidentifyOptions) => void;
  reidentifying: boolean;
  style?: React.CSSProperties;
}

type FactObject = FactSheet['objects'][number];

function objectDetail(o: FactObject, lang: 'zh' | 'en'): string {
  // Show the raw SIMBAD/VizieR code with a plain-language gloss, e.g. "s*r (红超巨星)".
  const gloss = otypeLabel(o.type.otype);
  const code = gloss ? `${o.type.otype} (${gloss[lang]})` : o.type.otype;
  const parts: string[] = [code, `conf ${o.confidence.toFixed(2)}`];
  parts.push(`${formatRaHms(o.coord.ra_deg)} ${formatDecDms(o.coord.dec_deg)}`);
  if (o.size_arcmin) parts.push(`${o.size_arcmin[0]}′`);
  if (o.distance) parts.push(`${o.distance.value} ${o.distance.unit}`);
  const ids = Object.values(o.catalog_ids);
  if (ids.length) parts.push(ids.join(', '));
  return parts.join(' · ');
}

/** Title type label: stars get the specific gloss (s*r → 红超巨星) since their
 * category label is just "Star"; nebulae/galaxies keep their clean category label. */
function typeName(o: FactObject, lang: 'zh' | 'en'): string {
  if (o.category === 'star') return otypeLabel(o.type.otype)?.[lang] ?? o.type[lang];
  return o.type[lang];
}

type RFeature = Reading['features'][number];

/** Detail line for a Class-B feature: anchor direction + parent + confidence,
 * resolved from the grounding fact object. */
function bFeatureDetail(f: RFeature, byId: Map<string, FactObject>, lang: 'zh' | 'en'): string {
  const o = f.fact_ref ? byId.get(f.fact_ref.object_id) : undefined;
  const parent = o?.parent_object_id ? byId.get(o.parent_object_id) : undefined;
  const parts = [
    o ? `conf ${o.confidence.toFixed(2)}` : undefined,
    o?.localization?.direction,
    parent ? `↳ ${parent.names[0] ?? parent.type[lang]}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * Left panel: the full grounding fact sheet — solve geometry + a numbered legend
 * mapping each badge on the image to its object (color · number · name · type ·
 * RA/Dec · size · distance · catalog ids · confidence). Read-only; clicking a row
 * selects that annotation.
 */
export function FactsPanel({
  reading,
  factsheet,
  selectedId,
  onSelect,
  collapsed,
  onToggleCollapse,
  onReidentify,
  reidentifying,
  style,
}: Props): React.JSX.Element {
  const { t, lang } = useUi();
  const objById = new Map((factsheet?.objects ?? []).map((o) => [o.id, o]));
  // A-class (catalog) circles vs Class-B (inferred) shells/arrows — split so the
  // uncertain morphology stays visually separate from the grounded facts.
  const aFeatures = reading.features.filter((f) => f.shape === 'circle');
  const bFeatures = reading.features.filter((f) => f.shape !== 'circle');
  const s = factsheet?.solve;
  const [reidOpen, setReidOpen] = useState(false);
  const [starMag, setStarMag] = useState(4);

  if (collapsed) {
    return (
      <aside className="facts-panel collapsed">
        <button className="collapse-btn" onClick={onToggleCollapse} title={t.factsTitle}>
          ›
        </button>
      </aside>
    );
  }

  return (
    <aside className="facts-panel" style={style}>
      <button className="collapse-btn" onClick={onToggleCollapse} title="收起 / collapse">
        ‹
      </button>
      <div className="facts-body">
      <div className="facts-head">
        <h2>{t.factsTitle}</h2>
        <div className="reid">
          <button className="primary" onClick={() => setReidOpen((v) => !v)} disabled={reidentifying}>
            {reidentifying ? t.reidentifying : `${t.reidentify} ▾`}
          </button>
          {reidOpen && (
            <div className="reid-menu">
              <p className="reid-warn">⚠ {t.reidentifyConfirm}</p>
              <label className="reid-param">
                <span>{t.starMagLabel}</span>
                <input
                  type="number"
                  step="0.5"
                  value={starMag}
                  onChange={(e) => setStarMag(Number(e.target.value))}
                />
              </label>
              <div className="reid-actions">
                <button onClick={() => setReidOpen(false)}>{t.reidCancel}</button>
                <button
                  className="primary"
                  onClick={() => {
                    setReidOpen(false);
                    onReidentify({ starMagMax: starMag });
                  }}
                >
                  {t.reidConfirmBtn}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {s ? (
        <div className="facts-solve muted">
          <div>
            {t.factsSolve}: <b>{s.status}</b> · frame={s.frame}
          </div>
          {s.ra_deg != null && s.dec_deg != null && (
            <div title={`RA ${s.ra_deg.toFixed(4)}° · Dec ${s.dec_deg.toFixed(4)}°`}>
              中心 / center: RA {formatRaHms(s.ra_deg)} · Dec {formatDecDms(s.dec_deg)}
            </div>
          )}
          <div>
            {s.pixscale_arcsec != null ? `${s.pixscale_arcsec.toFixed(2)}″/px` : ''}
            {s.radius_deg != null ? ` · r=${s.radius_deg.toFixed(2)}°` : ''}
            {s.orientation_deg != null ? ` · orient ${s.orientation_deg.toFixed(1)}°` : ''}
          </div>
          {s.nova_job_id && <div>nova job {s.nova_job_id}</div>}
        </div>
      ) : (
        <p className="muted">{t.factsNoneYet}</p>
      )}

      {factsheet?.warnings.map((w, i) => (
        <p key={i} className="facts-warn">
          ⚠ {w}
        </p>
      ))}

      <h3>
        {t.factsObjects} ({aFeatures.length})
      </h3>
      <ul className="legend">
        {aFeatures.map((f) => {
          const o = f.fact_ref ? objById.get(f.fact_ref.object_id) : undefined;
          return (
            <li
              key={f.id}
              className={`legend-row${selectedId === f.id ? ' sel' : ''}`}
              onClick={() => onSelect(f.id)}
            >
              <span className="legend-dot" style={{ background: COLOR_PALETTE[f.color_key].badge }}>
                {f.badge.num}
              </span>
              <span className="legend-text">
                <span className="legend-name">
                  {f.label[lang]}
                  {o && typeName(o, lang) !== f.label[lang] ? ` — ${typeName(o, lang)}` : ''}
                  {f.needs_human_review ? ' ⚠' : ''}
                </span>
                {o && (
                  <span
                    className="muted"
                    title={`RA ${o.coord.ra_deg.toFixed(4)}° Dec ${o.coord.dec_deg.toFixed(4)}°`}
                  >
                    {objectDetail(o, lang)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {bFeatures.length > 0 && (
        <>
          <h3>
            {t.factsFeaturesB} ({bFeatures.length})
          </h3>
          <ul className="legend">
            {bFeatures.map((f) => (
              <li
                key={f.id}
                className={`legend-row b-feature${selectedId === f.id ? ' sel' : ''}`}
                onClick={() => onSelect(f.id)}
              >
                <span className="legend-dot" style={{ background: COLOR_PALETTE[f.color_key].badge }}>
                  {f.badge.num}
                </span>
                <span className="legend-text">
                  <span className="legend-name">
                    {f.label[lang]}
                    {f.needs_human_review ? ' ⚠' : ''}
                  </span>
                  <span className="muted">{bFeatureDetail(f, objById, lang)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      </div>
    </aside>
  );
}

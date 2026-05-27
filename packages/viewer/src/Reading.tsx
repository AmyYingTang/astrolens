import type * as React from 'react';
import { useState } from 'react';
import { COLOR_PALETTE, type Feature, type Report } from '@astrolens/schema';

export interface ReadingProps {
  report: Report;
  imageSrc: string;
  language?: 'zh' | 'en';
  onFeatureClick?: (feature: Feature) => void;
  className?: string;
}

export function Reading(props: ReadingProps): React.JSX.Element {
  const { report, imageSrc, onFeatureClick, className } = props;
  const [active, setActive] = useState<string | null>(null);
  const { width, height } = report.image;
  const strokeW = Math.max(2, Math.round(Math.min(width, height) / 400));
  const o = report.object;

  const meta = [o.type, o.stage ? `Stage ${o.stage}` : null, o.constellation]
    .filter(Boolean)
    .join(' · ');

  const select = (f: Feature): void => {
    setActive((prev) => (prev === f.id ? null : f.id));
    onFeatureClick?.(f);
  };

  return (
    <div className={`astrolens-reading${className ? ` ${className}` : ''}`}>
      <div className="ar-stage">
        <img src={imageSrc} alt={o.name} onClick={() => setActive(null)} />
        <svg className="ar-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {report.features.map((f) => {
            const c = COLOR_PALETTE[f.color_key];
            const { cx, cy, r } = f.circle;
            const bx = cx + r * 0.7071 + f.badge.offset_x;
            const by = cy - r * 0.7071 + f.badge.offset_y;
            return (
              <g
                key={f.id}
                className={`ar-feat${active === f.id ? ' active' : ''}`}
                onMouseEnter={() => setActive(f.id)}
                onClick={() => select(f)}
              >
                <circle
                  className="ar-circle"
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={c.stroke}
                  strokeWidth={strokeW}
                />
                <circle cx={bx} cy={by} r={f.badge.bubble_r} fill={c.badge} stroke="#0b0e14" strokeWidth={strokeW / 2} />
                <text
                  x={bx}
                  y={by}
                  fontSize={f.badge.bubble_r * 1.1}
                  fontWeight={700}
                  fill="#0b0e14"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {f.badge.num}
                </text>
              </g>
            );
          })}
        </svg>
        {report.features.map((f) =>
          active === f.id ? (
            <div
              key={f.id}
              className="ar-tip"
              style={{
                left: `${(f.circle.cx / width) * 100}%`,
                top: `${(f.circle.cy / height) * 100}%`,
              }}
            >
              <b>
                {f.badge.num}. {f.label}
              </b>
              <p>{f.explanation}</p>
            </div>
          ) : null,
        )}
      </div>

      <div className="ar-panel">
        <h3>{o.name}</h3>
        <div className="ar-meta">{meta}</div>
        <p className="ar-narr">{report.narrative}</p>
        {report.features.map((f) => (
          <div
            key={f.id}
            className={`ar-feature${active === f.id ? ' active' : ''}`}
            onClick={() => select(f)}
          >
            <span className="ar-dot" style={{ background: COLOR_PALETTE[f.color_key].badge }}>
              {f.badge.num}
            </span>
            <div>
              <b>{f.label}</b>
              <p>{f.explanation}</p>
              {f.physics ? <p>{f.physics}</p> : null}
              {f.interesting ? <p>{f.interesting}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

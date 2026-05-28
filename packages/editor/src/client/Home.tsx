import type * as React from 'react';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '../shared.js';
import { createProject, imageUrl, listProjects } from './api.js';
import { LangToggle, useUi } from './i18n.js';
import { PRESETS } from './presets.js';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export function Home(): React.JSX.Element {
  const { t, lang: uiLang } = useUi();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [hint, setHint] = useState('');
  const [lang, setLang] = useState<'zh' | 'en'>(uiLang);
  const [presetIds, setPresetIds] = useState<Set<string>>(new Set());
  const [styleFree, setStyleFree] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const togglePreset = (id: string): void => {
    setPresetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildStyle = (): string => {
    const parts = PRESETS.filter((p) => presetIds.has(p.id)).map((p) =>
      lang === 'en' ? p.textEn : p.textZh,
    );
    if (styleFree.trim()) parts.push(styleFree.trim());
    return parts.join('\n');
  };

  const generate = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      const style = buildStyle();
      const slug = await createProject({
        imageBase64: dataUrl,
        filename: file.name,
        hint: hint || undefined,
        lang,
        style: style || undefined,
      });
      location.hash = `#/p/${encodeURIComponent(slug)}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <div className="home-header">
        <h1 className="home-title">astrolens</h1>
        <LangToggle />
      </div>

      <section className="home-card">
        <h2>{t.newReading}</h2>
        <p className="muted">{t.newReadingDesc}</p>
        <label className="file-pick">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span>{file ? file.name : t.pickImage}</span>
        </label>
        <div className="row">
          <input placeholder={t.hintPlaceholder} value={hint} onChange={(e) => setHint(e.target.value)} />
          <select value={lang} onChange={(e) => setLang(e.target.value as 'zh' | 'en')}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="style-block">
          <span className="field-label">{t.styleLabel}</span>
          {(['audience', 'focus'] as const).map((group) => (
            <div className="chip-group" key={group}>
              <span className="chip-group-label">
                {group === 'audience' ? t.audienceLabel : t.focusLabel}
              </span>
              {PRESETS.filter((p) => p.group === group).map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`chip${presetIds.has(p.id) ? ' active' : ''}`}
                  onClick={() => togglePreset(p.id)}
                >
                  {uiLang === 'zh' ? p.labelZh : p.labelEn}
                </button>
              ))}
            </div>
          ))}
          <input
            className="style-free"
            placeholder={t.styleFreePlaceholder}
            value={styleFree}
            onChange={(e) => setStyleFree(e.target.value)}
          />
        </div>

        <button className="primary" disabled={!file || busy} onClick={() => void generate()}>
          {busy ? t.generating : t.generate}
        </button>
        {error && <p className="err">{error}</p>}
      </section>

      <section className="home-card">
        <h2>{t.openExisting}</h2>
        {projects === null && <p className="muted">{t.loading}</p>}
        {projects?.length === 0 && <p className="muted">{t.emptyWorkspace}</p>}
        <div className="project-grid">
          {projects?.map((p) => (
            <a key={p.slug} className="project-card" href={`#/p/${encodeURIComponent(p.slug)}`}>
              <img src={imageUrl(p.slug)} alt={p.name} loading="lazy" />
              <div className="project-meta">
                <b>{p.name}</b>
                <span className="muted">
                  {p.type}
                  {p.stage ? ` · ${t.stagePrefix} ${p.stage}` : ''} · {p.features} {t.featuresSuffix}
                </span>
              </div>
            </a>
          ))}
        </div>
      </section>

      {busy && (
        <div className="overlay">
          <div className="overlay-box">
            {t.overlayTitle}
            <p className="muted">{t.overlaySub}</p>
          </div>
        </div>
      )}
    </div>
  );
}

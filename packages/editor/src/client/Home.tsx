import type * as React from 'react';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '../shared.js';
import { createProject, imageUrl, listProjects } from './api.js';
import { LangToggle, useUi } from './i18n.js';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const generate = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      const slug = await createProject({ imageBase64: dataUrl, filename: file.name, hint: hint || undefined, lang });
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

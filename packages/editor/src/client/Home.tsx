import type * as React from 'react';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '../shared.js';
import { createProject, imageUrl, listProjects } from './api.js';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export function Home(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [hint, setHint] = useState('');
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
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
      <h1 className="home-title">astrolens</h1>

      <section className="home-card">
        <h2>新读图</h2>
        <p className="muted">选一张深空摄影图,astrolens 会识别天体并自动标注,然后进入微调页面。</p>
        <label className="file-pick">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span>{file ? file.name : '选择图片…'}</span>
        </label>
        <div className="row">
          <input
            placeholder='对象名提示(可选),如 "Sh2-308"'
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
          <select value={lang} onChange={(e) => setLang(e.target.value as 'zh' | 'en')}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
        <button className="primary" disabled={!file || busy} onClick={() => void generate()}>
          {busy ? '识别中…' : '生成读图'}
        </button>
        {error && <p className="err">{error}</p>}
      </section>

      <section className="home-card">
        <h2>打开已有作品</h2>
        {projects === null && <p className="muted">加载中…</p>}
        {projects?.length === 0 && <p className="muted">工作区还没有作品。先做一个新读图吧。</p>}
        <div className="project-grid">
          {projects?.map((p) => (
            <a key={p.slug} className="project-card" href={`#/p/${encodeURIComponent(p.slug)}`}>
              <img src={imageUrl(p.slug)} alt={p.name} loading="lazy" />
              <div className="project-meta">
                <b>{p.name}</b>
                <span className="muted">
                  {p.type}
                  {p.stage ? ` · Stage ${p.stage}` : ''} · {p.features} 标注
                </span>
              </div>
            </a>
          ))}
        </div>
      </section>

      {busy && (
        <div className="overlay">
          <div className="overlay-box">
            正在识别和标注…
            <p className="muted">调用 claude 看图,可能需要 1 分钟左右。</p>
          </div>
        </div>
      )}
    </div>
  );
}

import type * as React from 'react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Report } from '@astrolens/schema';
import type { ExportFormat } from '../shared.js';
import { exportProject, fetchReport, fileUrl, imageUrl, saveReport } from './api.js';
import { initState, reducer } from './state.js';
import { Canvas } from './Canvas.js';
import { Sidebar } from './Sidebar.js';

const EXPORT_FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'annotated', label: 'Annotated JPG' },
  { format: 'embed', label: 'Embed HTML' },
  { format: 'poster', label: 'Poster PNG' },
  { format: 'all', label: '全部' },
];

export function EditorPage({ slug }: { slug: string }): React.JSX.Element {
  const [data, setData] = useState<{ report: Report; imageName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetchReport(slug)
      .then((r) => setData({ report: r.report, imageName: r.imageName }))
      .catch((e: unknown) => setError((e as Error).message));
  }, [slug]);

  if (error)
    return (
      <div className="status">
        加载失败: {error} · <a href="#/">返回作品库</a>
      </div>
    );
  if (!data) return <div className="status">加载中…</div>;
  return <Editor key={slug} slug={slug} initial={data.report} imageName={data.imageName} />;
}

function Editor({
  slug,
  initial,
  imageName,
}: {
  slug: string;
  initial: Report;
  imageName: string;
}): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initial, initState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exported, setExported] = useState<string[] | null>(null);

  const doSave = useCallback(async () => {
    try {
      await saveReport(slug, stateRef.current.report);
      dispatch({ type: 'markSaved' });
      setSaveError(null);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    if (!state.dirty) return;
    const t = setTimeout(() => void doSave(), 2000);
    return () => clearTimeout(t);
  }, [state.report, state.dirty, doSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const editable =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        void doSave();
        return;
      }
      if (mod && key === 'z') {
        if (editable) return;
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (mod && key === 'y') {
        if (editable) return;
        e.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (!editable && e.key.startsWith('Arrow')) {
        const sel = stateRef.current.selectedId;
        if (!sel) return;
        const step = e.shiftKey ? 10 : 1;
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const d = delta[e.key];
        if (d) {
          e.preventDefault();
          dispatch({ type: 'nudge', id: sel, dx: d[0], dy: d[1] });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doSave]);

  const runExport = async (format: ExportFormat): Promise<void> => {
    setMenuOpen(false);
    setExported(null);
    setExporting(format);
    try {
      // Persist any pending edits first so the export reflects them.
      if (stateRef.current.dirty) await doSave();
      const files = await exportProject(slug, format);
      setExported(files);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="editor-page">
      <header className="toolbar">
        <a className="home-link" href="#/">
          ← 作品库
        </a>
        <span className="toolbar-title">{state.report.object.name}</span>
        <div className="export">
          <button onClick={() => setMenuOpen((v) => !v)} disabled={exporting !== null}>
            {exporting ? `导出中… (${exporting})` : '导出 ▾'}
          </button>
          {menuOpen && (
            <div className="export-menu">
              {EXPORT_FORMATS.map((f) => (
                <button key={f.format} onClick={() => void runExport(f.format)}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="app">
        <Canvas
          report={state.report}
          selectedId={state.selectedId}
          dispatch={dispatch}
          imageUrl={imageUrl(slug)}
        />
        <Sidebar
          report={state.report}
          imageName={imageName}
          selectedId={state.selectedId}
          dirty={state.dirty}
          dispatch={dispatch}
          onSave={() => void doSave()}
        />
      </div>

      {exported && (
        <div className="export-result">
          已导出:
          {exported.map((name) => (
            <a key={name} href={fileUrl(slug, name)} target="_blank" rel="noreferrer">
              {name}
            </a>
          ))}
          <button className="dismiss" onClick={() => setExported(null)}>
            ✕
          </button>
        </div>
      )}
      {saveError && <div className="save-error">出错: {saveError}</div>}
    </div>
  );
}

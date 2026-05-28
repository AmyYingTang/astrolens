import type * as React from 'react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Report } from '@astrolens/schema';
import type { ExportFormat } from '../shared.js';
import { exportProject, fetchReport, imageUrl, saveReport } from './api.js';
import { initState, reducer } from './state.js';
import { Canvas } from './Canvas.js';
import { Sidebar } from './Sidebar.js';
import { LangToggle, useUi } from './i18n.js';

const EXPORT_ORDER: ExportFormat[] = ['annotated', 'embed', 'poster', 'all'];

export function EditorPage({ slug }: { slug: string }): React.JSX.Element {
  const { t } = useUi();
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
        {t.loadFailed}: {error} · <a href="#/">{t.backToLibrary}</a>
      </div>
    );
  if (!data) return <div className="status">{t.loading}</div>;
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
  const { t } = useUi();
  const exportLabels: Record<ExportFormat, string> = {
    annotated: t.fmtAnnotated,
    embed: t.fmtEmbed,
    poster: t.fmtPoster,
    all: t.fmtAll,
  };
  const [state, dispatch] = useReducer(reducer, initial, initState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exported, setExported] = useState<{ dir: string; files: string[] } | null>(null);

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
    type Picker = (options?: {
      mode?: 'read' | 'readwrite';
      startIn?: string;
      id?: string;
    }) => Promise<FileSystemDirectoryHandle>;
    const picker = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;
    if (!picker) {
      setSaveError(t.pickerUnsupported);
      return;
    }
    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await picker({ mode: 'readwrite', startIn: 'downloads', id: 'astrolens-export' });
    } catch {
      return; // user cancelled the picker
    }
    setExported(null);
    setExporting(format);
    try {
      if (stateRef.current.dirty) await doSave();
      const files = await exportProject(slug, format);
      const written: string[] = [];
      for (const f of files) {
        const fh = await dirHandle.getFileHandle(f.name, { create: true });
        const w = await fh.createWritable();
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await w.write(bytes);
        await w.close();
        written.push(f.name);
      }
      setExported({ dir: dirHandle.name, files: written });
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
          {t.backToLibrary}
        </a>
        <span className="toolbar-title">{state.report.object.name}</span>
        <LangToggle />
        <div className="export">
          <button onClick={() => setMenuOpen((v) => !v)} disabled={exporting !== null}>
            {exporting ? `${t.exporting} (${exporting})` : `${t.exportLabel} ▾`}
          </button>
          {menuOpen && (
            <div className="export-menu">
              {EXPORT_ORDER.map((format) => (
                <button key={format} onClick={() => void runExport(format)}>
                  {exportLabels[format]}
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
          <span>
            {t.savedTo} <b>{exported.dir}/</b>
          </span>
          {exported.files.map((name) => (
            <span key={name} className="exported-file">
              {name}
            </span>
          ))}
          <button className="dismiss" onClick={() => setExported(null)}>
            ✕
          </button>
        </div>
      )}
      {saveError && <div className="save-error">{t.errorLabel}: {saveError}</div>}
    </div>
  );
}

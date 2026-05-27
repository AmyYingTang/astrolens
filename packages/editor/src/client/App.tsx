import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Report } from '@astrolens/schema';
import { fetchReport, saveReport } from './api.js';
import { initState, reducer } from './state.js';
import { Canvas } from './Canvas.js';
import { Sidebar } from './Sidebar.js';

export function App(): React.JSX.Element {
  const [data, setData] = useState<{ report: Report; imageName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReport()
      .then((r) => setData({ report: r.report, imageName: r.imageName }))
      .catch((e: unknown) => setError((e as Error).message));
  }, []);

  if (error) return <div className="status">加载失败: {error}</div>;
  if (!data) return <div className="status">加载中…</div>;
  return <Editor initial={data.report} imageName={data.imageName} />;
}

function Editor({ initial, imageName }: { initial: Report; imageName: string }): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initial, initState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [saveError, setSaveError] = useState<string | null>(null);

  const doSave = useCallback(async () => {
    try {
      await saveReport(stateRef.current.report);
      dispatch({ type: 'markSaved' });
      setSaveError(null);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }, []);

  // Debounced auto-save 2s after the last edit.
  useEffect(() => {
    if (!state.dirty) return;
    const t = setTimeout(() => void doSave(), 2000);
    return () => clearTimeout(t);
  }, [state.report, state.dirty, doSave]);

  // Keyboard: arrows nudge, Cmd+Z/Y undo/redo, Cmd+S save.
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

  return (
    <div className="app">
      <Canvas report={state.report} selectedId={state.selectedId} dispatch={dispatch} />
      <Sidebar
        report={state.report}
        imageName={imageName}
        selectedId={state.selectedId}
        dirty={state.dirty}
        dispatch={dispatch}
        onSave={() => void doSave()}
      />
      {saveError && <div className="save-error">保存失败: {saveError}</div>}
    </div>
  );
}

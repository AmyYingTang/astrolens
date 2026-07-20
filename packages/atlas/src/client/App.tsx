import { useEffect, useMemo, useRef, useState } from 'react';
import { worldToPixel, pixelToWorld, type Wcs } from '@astrolens/schema';
import { Canvas, type Shape } from './Canvas.js';
import { useLang } from './i18n.js';
import { fetchFeatureTypes, uploadImage, pollJob, listObjects, getObject, saveObject } from './api.js';
import type { FeatureType, Geometry } from '../featureTypes.js';
import type { Annotation, AtlasEntry } from '../atlas.js';
import type { ObjectSummary } from '../shared.js';

interface Session {
  imageSrc: string;
  imageRef: string;
  wcs: Wcs;
  width: number;
  height: number;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}

export function App(): JSX.Element {
  const { t, lang, setLang } = useLang();
  const [types, setTypes] = useState<FeatureType[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const [primaryId, setPrimaryId] = useState('');
  const [aliasesText, setAliasesText] = useState('');
  const [typeKey, setTypeKey] = useState('pillar');
  const [mode, setMode] = useState<'pan' | 'draw'>('pan');
  const [draftPx, setDraftPx] = useState<[number, number][]>([]);
  const [labelZh, setLabelZh] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [objects, setObjects] = useState<ObjectSummary[]>([]);
  const [saveMsg, setSaveMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const curType = useMemo(() => types.find((x) => x.key === typeKey), [types, typeKey]);
  const geometry: Geometry = curType?.geometry ?? 'polygon';

  useEffect(() => {
    void fetchFeatureTypes().then((f) => {
      setTypes(f);
      const first = f.find((x) => x.defaultOn) ?? f[0];
      if (first) setTypeKey(first.key);
    });
    void refreshObjects();
  }, []);

  const refreshObjects = async (): Promise<void> => {
    const { objects } = await listObjects();
    setObjects(objects);
  };

  const onPickFile = async (file: File): Promise<void> => {
    setBusy(true);
    setStatus(t('storing'));
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const up = await uploadImage({ filename: file.name, imageBase64: dataUrl });
      if (!up.ok || !up.jobId) throw new Error(up.error ?? 'upload failed');
      const job = await pollJob(up.jobId, (j) => setStatus(j.stage === 'solving' ? t('solving') : t('storing')));
      if (job.state !== 'done' || !job.wcs || !job.imageRef) {
        setStatus(`${t('solveFailed')}: ${job.error ?? ''}`);
        return;
      }
      setSession({
        imageSrc: `/refimg/${job.imageRef}`,
        imageRef: job.imageRef,
        wcs: job.wcs,
        width: job.width ?? job.wcs.width,
        height: job.height ?? job.wcs.height,
      });
      setAnnotations([]);
      setStatus(t('solved'));
    } catch (e) {
      setStatus(`${t('solveFailed')}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onAddPoint = (x: number, y: number): void => {
    if (geometry === 'point') {
      setDraftPx([[x, y]]);
    } else {
      setDraftPx((d) => [...d, [x, y]]);
    }
  };

  const finishShape = (): void => {
    if (!session) return;
    const minPts = geometry === 'point' ? 1 : geometry === 'polygon' ? 3 : 2;
    if (draftPx.length < minPts) return;
    // px → ICRS via the reference image's WCS.
    const verts: [number, number][] = [];
    for (const [x, y] of draftPx) {
      const sky = pixelToWorld(session.wcs, x, y);
      verts.push([sky[0], sky[1]]);
    }
    const now = new Date().toISOString();
    const anno: Annotation = {
      id: `anno_${Date.now().toString(36)}`,
      feature_type: typeKey,
      geometry: { type: geometry, vertices: verts },
      label: { zh: labelZh, en: labelEn },
      status: 'draft',
      author: 'amy',
      created_at: now,
      updated_at: now,
    };
    setAnnotations((a) => [...a, anno]);
    setDraftPx([]);
    setLabelZh('');
    setLabelEn('');
  };

  const loadEntry = async (id: string): Promise<void> => {
    const { entry } = await getObject(id);
    if (!entry) return;
    setPrimaryId(entry.primary_id);
    setAliasesText(entry.aliases.join(', '));
    setAnnotations(entry.annotations);
    if (entry.reference) {
      setSession({
        imageSrc: `/refimg/${entry.reference.image_ref}`,
        imageRef: entry.reference.image_ref,
        wcs: entry.reference.wcs,
        width: entry.reference.width_px,
        height: entry.reference.height_px,
      });
      setStatus(t('solved'));
    }
  };

  const save = async (): Promise<void> => {
    if (!session || !primaryId.trim()) return;
    const entry: AtlasEntry = {
      primary_id: primaryId.trim(),
      aliases: aliasesText.split(',').map((s) => s.trim()).filter(Boolean),
      reference: {
        image_ref: session.imageRef,
        wcs: session.wcs,
        width_px: session.width,
        height_px: session.height,
      },
      annotations,
    };
    const r = await saveObject(entry.primary_id, { entry });
    setSaveMsg(r.ok ? t('saved') : `⚠ ${r.error ?? ''}`);
    if (r.ok) void refreshObjects();
    setTimeout(() => setSaveMsg(''), 2500);
  };

  // Render saved annotations onto the current image (sky → px).
  const shapes: Shape[] = useMemo(() => {
    if (!session) return [];
    const out: Shape[] = [];
    for (const a of annotations) {
      const px: [number, number][] = [];
      for (const [ra, dec] of a.geometry.vertices) {
        const p = worldToPixel(session.wcs, ra, dec);
        if (p) px.push([p[0], p[1]]);
      }
      if (px.length === 0) continue;
      out.push({
        type: a.geometry.type,
        verticesPx: px,
        color: types.find((x) => x.key === a.feature_type)?.hint ?? '#7aa2f7',
        closed: a.geometry.type === 'polygon',
      });
    }
    return out;
  }, [annotations, session, types]);

  const draft = session
    ? { verticesPx: draftPx, type: geometry, color: curType?.hint ?? '#7aa2f7' }
    : null;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <span className="brand">{t('title')}</span>
          <span className="sub">{t('subtitle')}</span>
        </div>
        <button className="lang" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
      </header>

      <div className="body">
        <aside className="sidebar">
          <section>
            <button
              className="primary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {t('upload')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickFile(f);
                e.target.value = '';
              }}
            />
            {status && <p className="status">{status}</p>}
          </section>

          <section>
            <h3>{t('identity')}</h3>
            <input
              placeholder={t('primaryId')}
              value={primaryId}
              onChange={(e) => setPrimaryId(e.target.value)}
            />
            <input
              placeholder={t('aliases')}
              value={aliasesText}
              onChange={(e) => setAliasesText(e.target.value)}
            />
          </section>

          <section>
            <h3>{t('featureType')}</h3>
            <select value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
              {types.map((ft) => (
                <option key={ft.key} value={ft.key}>
                  {ft.zh} · {ft.en} ({ft.geometry})
                </option>
              ))}
            </select>

            <div className="modes">
              <label>
                <input type="radio" checked={mode === 'pan'} onChange={() => setMode('pan')} />
                {t('pan')}
              </label>
              <label>
                <input type="radio" checked={mode === 'draw'} onChange={() => setMode('draw')} />
                {t('draw')}
              </label>
            </div>
            <p className="hint">{t('coarseHint')}</p>

            <input placeholder={t('labelZh')} value={labelZh} onChange={(e) => setLabelZh(e.target.value)} />
            <input placeholder={t('labelEn')} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
            <div className="row">
              <button disabled={draftPx.length === 0} onClick={() => setDraftPx((d) => d.slice(0, -1))}>
                {t('undo')}
              </button>
              <button disabled={draftPx.length === 0} onClick={finishShape}>
                {t('addAnno')}
              </button>
            </div>
          </section>

          <section>
            <h3>
              {t('annotations')} ({annotations.length})
            </h3>
            <ul className="annos">
              {annotations.map((a) => (
                <li key={a.id}>
                  <span className="dot" style={{ background: types.find((x) => x.key === a.feature_type)?.hint }} />
                  {a.label[lang] || a.feature_type}
                  <button className="x" onClick={() => setAnnotations((xs) => xs.filter((y) => y.id !== a.id))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button className="primary" disabled={!session || !primaryId.trim()} onClick={save}>
              {t('save')}
            </button>
            {saveMsg && <p className="status">{saveMsg}</p>}
          </section>

          {objects.length > 0 && (
            <section>
              <h3>Atlas ({objects.length})</h3>
              <ul className="annos">
                {objects.map((o) => (
                  <li key={o.primary_id}>
                    <button className="link" onClick={() => void loadEntry(o.primary_id)}>
                      {o.primary_id}
                    </button>
                    <span className="count">{o.annotations}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <main className="stage-area">
          {session ? (
            <Canvas
              imageSrc={session.imageSrc}
              imgWidth={session.width}
              imgHeight={session.height}
              mode={mode}
              shapes={shapes}
              draft={draft}
              onAddPoint={onAddPoint}
            />
          ) : (
            <div className="empty">{t('noImage')}</div>
          )}
        </main>
      </div>
    </div>
  );
}

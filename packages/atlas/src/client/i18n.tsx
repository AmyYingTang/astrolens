import { createContext, useContext, useState, type ReactNode } from 'react';

// Minimal bilingual layer — zh default, matches astrolens convention. UI strings
// are keyed; annotation labels are stored bilingually in the data, not here.

export type Lang = 'zh' | 'en';

const STRINGS = {
  title: { zh: '基准标注库', en: 'Feature Atlas' },
  subtitle: { zh: 'B 类形态特征基准标注', en: 'B-class morphology baseline annotations' },
  upload: { zh: '上传参考图', en: 'Upload reference image' },
  solving: { zh: '正在定位（plate-solve，可能要几分钟）…', en: 'Plate-solving (can take minutes)…' },
  storing: { zh: '正在保存图像…', en: 'Storing image…' },
  solveFailed: { zh: '定位失败', en: 'Solve failed' },
  solved: { zh: '已定位', en: 'Solved' },
  identity: { zh: '目标身份', en: 'Target identity' },
  primaryId: { zh: '主 ID（如 NGC 3372）', en: 'Primary ID (e.g. NGC 3372)' },
  aliases: { zh: '别名（逗号分隔）', en: 'Aliases (comma-separated)' },
  featureType: { zh: '特征类型', en: 'Feature type' },
  mode: { zh: '模式', en: 'Mode' },
  pan: { zh: '平移/缩放', en: 'Pan / zoom' },
  draw: { zh: '绘制', en: 'Draw' },
  finish: { zh: '完成这条', en: 'Finish shape' },
  undo: { zh: '撤销点', en: 'Undo point' },
  labelName: { zh: '特征名（可选）', en: 'Feature name (optional)' },
  labelHelp: {
    zh: '这条特征的专有名，如「神秘山」「锁孔」「创生之柱」。没有专名就留空 → 会用类型通用名（如「尘埃暗带」）。',
    en: 'The proper name of this feature, e.g. "Mystic Mountain", "Keyhole". Leave blank if it has none → the generic type name is used.',
  },
  labelZh: { zh: '专名（中文）', en: 'Name (zh)' },
  labelEn: { zh: '专名（English）', en: 'Name (en)' },
  addAnno: { zh: '添加标注', en: 'Add annotation' },
  annotations: { zh: '标注', en: 'Annotations' },
  save: { zh: '保存到库', en: 'Save to atlas' },
  saved: { zh: '已保存', en: 'Saved' },
  required: { zh: '必填', en: 'required' },
  needImage: { zh: '需先上传并定位一张参考图', en: 'Upload & solve a reference image first' },
  needId: { zh: '需先填「主 ID」才能保存', en: 'Enter a primary ID to save' },
  noImage: { zh: '先上传一张参考图开始', en: 'Upload a reference image to start' },
  coarseHint: {
    zh: '粗圈即可 — 读者会自行解读，不必贴边',
    en: 'Rough regions are fine — readers interpret; no pixel-hugging',
  },
} as const;

type Key = keyof typeof STRINGS;

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
}

const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lang, setLang] = useState<Lang>('zh');
  const t = (k: Key): string => STRINGS[k][lang];
  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error('useLang outside provider');
  return c;
}

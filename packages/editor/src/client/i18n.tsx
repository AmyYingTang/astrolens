import type * as React from 'react';
import { createContext, useCallback, useContext, useState } from 'react';

export type UiLang = 'zh' | 'en';

export interface Strings {
  newReading: string;
  newReadingDesc: string;
  pickImage: string;
  hintPlaceholder: string;
  generate: string;
  generating: string;
  openExisting: string;
  loading: string;
  emptyWorkspace: string;
  stagePrefix: string;
  featuresSuffix: string;
  overlayTitle: string;
  overlaySub: string;
  backToLibrary: string;
  exportLabel: string;
  exporting: string;
  exported: string;
  loadFailed: string;
  errorLabel: string;
  narrative: string;
  featuresLabel: string;
  add: string;
  save: string;
  saved: string;
  deleteFeature: string;
  badgeNum: string;
  phExplanation: string;
  phPhysics: string;
  phInteresting: string;
  fmtAnnotated: string;
  fmtEmbed: string;
  fmtPoster: string;
  fmtAll: string;
}

const STRINGS: Record<UiLang, Strings> = {
  zh: {
    newReading: '新读图',
    newReadingDesc: '选一张深空摄影图,astrolens 会识别天体并自动标注,然后进入微调页面。',
    pickImage: '选择图片…',
    hintPlaceholder: '对象名提示(可选),如 "Sh2-308"',
    generate: '生成读图',
    generating: '识别中…',
    openExisting: '打开已有作品',
    loading: '加载中…',
    emptyWorkspace: '工作区还没有作品。先做一个新读图吧。',
    stagePrefix: '阶段',
    featuresSuffix: '标注',
    overlayTitle: '正在识别和标注…',
    overlaySub: '调用 claude 看图,可能需要 1 分钟左右。',
    backToLibrary: '← 作品库',
    exportLabel: '导出',
    exporting: '导出中…',
    exported: '已导出:',
    loadFailed: '加载失败',
    errorLabel: '出错',
    narrative: '导读',
    featuresLabel: '标注',
    add: '+ 添加',
    save: '保存',
    saved: '已保存',
    deleteFeature: '删除标注',
    badgeNum: '编号',
    phExplanation: '说明',
    phPhysics: '物理机制(可选)',
    phInteresting: '冷知识(可选)',
    fmtAnnotated: '标注图 (JPG)',
    fmtEmbed: '互动网页 (HTML)',
    fmtPoster: '海报 (PNG)',
    fmtAll: '全部',
  },
  en: {
    newReading: 'New reading',
    newReadingDesc:
      'Pick a deep-sky photo — astrolens identifies the object, annotates it, then opens the editor.',
    pickImage: 'Choose image…',
    hintPlaceholder: 'Object hint (optional), e.g. "Sh2-308"',
    generate: 'Generate',
    generating: 'Reading…',
    openExisting: 'Open existing',
    loading: 'Loading…',
    emptyWorkspace: 'No readings yet. Start a new one above.',
    stagePrefix: 'Stage',
    featuresSuffix: 'features',
    overlayTitle: 'Identifying and annotating…',
    overlaySub: 'Calling claude to read the image — this can take about a minute.',
    backToLibrary: '← Library',
    exportLabel: 'Export',
    exporting: 'Exporting…',
    exported: 'Exported:',
    loadFailed: 'Failed to load',
    errorLabel: 'Error',
    narrative: 'Narrative',
    featuresLabel: 'Features',
    add: '+ Add',
    save: 'Save',
    saved: 'Saved',
    deleteFeature: 'Delete feature',
    badgeNum: 'Badge number',
    phExplanation: 'explanation',
    phPhysics: 'physics (optional)',
    phInteresting: 'interesting (optional)',
    fmtAnnotated: 'Annotated JPG',
    fmtEmbed: 'Embed HTML',
    fmtPoster: 'Poster PNG',
    fmtAll: 'All',
  },
};

interface LangCtx {
  lang: UiLang;
  setLang: (l: UiLang) => void;
}

const Ctx = createContext<LangCtx>({ lang: 'zh', setLang: () => {} });
const STORAGE_KEY = 'astrolens.uiLang';

export function LangProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [lang, setLangState] = useState<UiLang>(
    () => (localStorage.getItem(STORAGE_KEY) as UiLang | null) ?? 'zh',
  );
  const setLang = useCallback((l: UiLang) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useUi(): { lang: UiLang; setLang: (l: UiLang) => void; t: Strings } {
  const { lang, setLang } = useContext(Ctx);
  return { lang, setLang, t: STRINGS[lang] };
}

export function LangToggle(): React.JSX.Element {
  const { lang, setLang } = useUi();
  return (
    <button className="lang-toggle" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
      {lang === 'zh' ? 'EN' : '中文'}
    </button>
  );
}

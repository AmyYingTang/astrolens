import type { Circle, ColorKey, Feature, Report } from '@astrolens/schema';

export interface EditorState {
  report: Report;
  selectedId: string | null;
  past: Report[];
  future: Report[];
  dirty: boolean;
}

type TextField = 'label' | 'explanation' | 'physics' | 'interesting';

export type Action =
  | { type: 'select'; id: string | null }
  | { type: 'beginChange' } // snapshot current report for undo, before transient edits
  | { type: 'setCircle'; id: string; circle: Circle; commit?: boolean }
  | { type: 'setBadgeOffset'; id: string; offset_x: number; offset_y: number; commit?: boolean }
  | { type: 'nudge'; id: string; dx: number; dy: number }
  | { type: 'setFeatureText'; id: string; field: TextField; value: string; commit?: boolean }
  | { type: 'setFeatureBody'; id: string; value: string; commit?: boolean }
  | { type: 'setColor'; id: string; color: ColorKey }
  | { type: 'setBadgeNum'; id: string; num: string; commit?: boolean }
  | { type: 'setNarrative'; value: string; commit?: boolean }
  | { type: 'addFeature' }
  | { type: 'deleteFeature'; id: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'markSaved' };

export function initState(report: Report): EditorState {
  return { report, selectedId: report.features[0]?.id ?? null, past: [], future: [], dirty: false };
}

function mapFeature(report: Report, id: string, fn: (f: Feature) => Feature): Report {
  return { ...report, features: report.features.map((f) => (f.id === id ? fn(f) : f)) };
}

/** Apply a report mutation; when commit, snapshot the previous report for undo. */
function change(state: EditorState, next: Report, commit: boolean): EditorState {
  return {
    ...state,
    report: next,
    past: commit ? [...state.past, state.report] : state.past,
    future: commit ? [] : state.future,
    dirty: true,
  };
}

function nextFeatureId(report: Report): string {
  let n = report.features.length + 1;
  const ids = new Set(report.features.map((f) => f.id));
  while (ids.has(`f${n}`)) n += 1;
  return `f${n}`;
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'select':
      return { ...state, selectedId: action.id };

    case 'beginChange':
      return { ...state, past: [...state.past, state.report], future: [] };

    case 'setCircle':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({ ...f, circle: action.circle })),
        action.commit ?? true,
      );

    case 'setBadgeOffset':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          badge: { ...f.badge, offset_x: action.offset_x, offset_y: action.offset_y },
        })),
        action.commit ?? true,
      );

    case 'nudge':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          circle: { ...f.circle, cx: f.circle.cx + action.dx, cy: f.circle.cy + action.dy },
        })),
        true,
      );

    case 'setFeatureText':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({ ...f, [action.field]: action.value })),
        action.commit ?? true,
      );

    case 'setFeatureBody':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          explanation: action.value,
          physics: undefined,
          interesting: undefined,
        })),
        action.commit ?? true,
      );

    case 'setColor':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({ ...f, color_key: action.color })),
        true,
      );

    case 'setBadgeNum':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          badge: { ...f.badge, num: action.num },
        })),
        action.commit ?? true,
      );

    case 'setNarrative':
      return change(state, { ...state.report, narrative: action.value }, action.commit ?? true);

    case 'addFeature': {
      const { width, height } = state.report.image;
      const id = nextFeatureId(state.report);
      const feature: Feature = {
        id,
        label: '新标注',
        color_key: 'star',
        circle: { cx: Math.round(width / 2), cy: Math.round(height / 2), r: Math.round(Math.min(width, height) / 8) },
        badge: { num: String(state.report.features.length + 1), offset_x: 0, offset_y: 0, bubble_r: 30 },
        explanation: '',
      };
      return {
        ...change(state, { ...state.report, features: [...state.report.features, feature] }, true),
        selectedId: id,
      };
    }

    case 'deleteFeature': {
      const next = {
        ...state.report,
        features: state.report.features.filter((f) => f.id !== action.id),
      };
      const sel = state.selectedId === action.id ? (next.features[0]?.id ?? null) : state.selectedId;
      return { ...change(state, next, true), selectedId: sel };
    }

    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state,
        report: prev,
        past: state.past.slice(0, -1),
        future: [state.report, ...state.future],
        dirty: true,
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        report: next,
        past: [...state.past, state.report],
        future: state.future.slice(1),
        dirty: true,
      };
    }

    case 'markSaved':
      return { ...state, dirty: false };

    default:
      return state;
  }
}

import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Image as KImage, Circle as KCircle, Group, Text } from 'react-konva';
import type Konva from 'konva';
import { COLOR_PALETTE, type Report } from '@astrolens/schema';
import type { Action } from './state.js';

function useImage(src: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const image = new window.Image();
    image.onload = () => setImg(image);
    image.src = src;
    return () => {
      image.onload = null;
    };
  }, [src]);
  return img;
}

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0]!.contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const ANCHOR = 0.7071;

interface Props {
  report: Report;
  selectedId: string | null;
  dispatch: React.Dispatch<Action>;
}

export function Canvas({ report, selectedId, dispatch }: Props): React.JSX.Element {
  const img = useImage('/image');
  const [ref, containerW] = useWidth();
  const { width, height } = report.image;
  const scale = containerW / width;
  const px = (screen: number): number => screen / scale; // screen px -> image px

  return (
    <div className="canvas" ref={ref}>
      <Stage
        width={containerW}
        height={height * scale}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) dispatch({ type: 'select', id: null });
        }}
      >
        <Layer>{img && <KImage image={img} width={width} height={height} listening={false} />}</Layer>
        <Layer>
          {report.features.map((f) => {
            const color = COLOR_PALETTE[f.color_key];
            const { cx, cy, r } = f.circle;
            const selected = f.id === selectedId;
            const anchorX = cx + r * ANCHOR;
            const anchorY = cy - r * ANCHOR;
            const bx = anchorX + f.badge.offset_x;
            const by = anchorY + f.badge.offset_y;
            const fontSize = f.badge.bubble_r * 1.1;

            return (
              <Group key={f.id}>
                <KCircle
                  x={cx}
                  y={cy}
                  radius={r}
                  stroke={color.stroke}
                  strokeWidth={px(selected ? 3 : 2)}
                  opacity={selected ? 1 : 0.75}
                  draggable
                  onClick={() => dispatch({ type: 'select', id: f.id })}
                  onTap={() => dispatch({ type: 'select', id: f.id })}
                  onDragStart={() => {
                    dispatch({ type: 'select', id: f.id });
                    dispatch({ type: 'beginChange' });
                  }}
                  onDragMove={(e) =>
                    dispatch({
                      type: 'setCircle',
                      id: f.id,
                      circle: { cx: e.target.x(), cy: e.target.y(), r },
                      commit: false,
                    })
                  }
                />

                {selected && (
                  <KCircle
                    x={cx + r}
                    y={cy}
                    radius={px(6)}
                    fill={color.stroke}
                    stroke="#0b0e14"
                    strokeWidth={px(1)}
                    draggable
                    onDragStart={() => dispatch({ type: 'beginChange' })}
                    onDragMove={(e) => {
                      const nr = Math.max(4, Math.hypot(e.target.x() - cx, e.target.y() - cy));
                      dispatch({
                        type: 'setCircle',
                        id: f.id,
                        circle: { cx, cy, r: Math.round(nr) },
                        commit: false,
                      });
                    }}
                  />
                )}

                <Group
                  x={bx}
                  y={by}
                  draggable
                  onClick={() => dispatch({ type: 'select', id: f.id })}
                  onTap={() => dispatch({ type: 'select', id: f.id })}
                  onDragStart={() => {
                    dispatch({ type: 'select', id: f.id });
                    dispatch({ type: 'beginChange' });
                  }}
                  onDragMove={(e: Konva.KonvaEventObject<DragEvent>) =>
                    dispatch({
                      type: 'setBadgeOffset',
                      id: f.id,
                      offset_x: Math.round(e.target.x() - anchorX),
                      offset_y: Math.round(e.target.y() - anchorY),
                      commit: false,
                    })
                  }
                >
                  <KCircle
                    radius={f.badge.bubble_r}
                    fill={color.badge}
                    stroke="#0b0e14"
                    strokeWidth={px(selected ? 2 : 1)}
                  />
                  <Text
                    text={f.badge.num}
                    fontSize={fontSize}
                    fontStyle="700"
                    fill="#0b0e14"
                    width={f.badge.bubble_r * 2}
                    height={f.badge.bubble_r * 2}
                    x={-f.badge.bubble_r}
                    y={-f.badge.bubble_r}
                    align="center"
                    verticalAlign="middle"
                    listening={false}
                  />
                </Group>
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}

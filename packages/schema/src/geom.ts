/**
 * SVG/Konva path for a circular arc — used to draw a Class-B shell as a partial
 * dashed arc (rather than a full ring that would duplicate its parent nebula).
 * Screen coordinates (y down). Default: a 150° arc centred up-right, so it sits
 * near the badge anchor.
 */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  centerDeg = -45,
  spanDeg = 150,
): string {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const a0 = centerDeg - spanDeg / 2;
  const a1 = centerDeg + spanDeg / 2;
  const x0 = cx + r * Math.cos(rad(a0));
  const y0 = cy + r * Math.sin(rad(a0));
  const x1 = cx + r * Math.cos(rad(a1));
  const y1 = cy + r * Math.sin(rad(a1));
  const large = spanDeg > 180 ? 1 : 0;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

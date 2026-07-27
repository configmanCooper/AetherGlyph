export function guideTransform(width, height, guideScale = 1) {
  const pad = 0.16;
  const scale = Number.isFinite(Number(guideScale))
    ? Math.max(0.4, Math.min(1.5, Number(guideScale)))
    : 1;
  const size = Math.min(width, height) * (1 - 2 * pad) * scale;
  return {
    sx: (value) => width / 2 + (value / 100 - 0.5) * size,
    sy: (value) => height / 2 + (value / 100 - 0.5) * size,
  };
}

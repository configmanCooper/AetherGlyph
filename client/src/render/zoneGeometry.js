export function wizardInsideZone(wizard, zone) {
  if (!wizard || !zone) return false;
  const position = Number(wizard.arcPos);
  const center = Number(zone.center);
  const radius = Number(zone.radius ?? 0.55);
  return Number.isFinite(position) && Number.isFinite(center) && Number.isFinite(radius)
    && Math.abs(position - center) <= radius;
}

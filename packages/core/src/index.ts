export const HARD_FLOOR_GAP_SECONDS = 15;
export function clampGap(requestedSeconds: number): number {
  return Math.max(requestedSeconds, HARD_FLOOR_GAP_SECONDS);
}

export type VirtualRange = { start: number; end: number };

export function getVirtualRange(total: number, scrollTop: number, viewportHeight: number, rowHeight: number, overscan = 8): VirtualRange {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const safeTop = Math.max(0, scrollTop);
  const safeHeight = Math.max(rowHeight, viewportHeight);
  const start = Math.max(0, Math.floor(safeTop / rowHeight) - Math.max(0, overscan));
  const end = Math.min(total, Math.ceil((safeTop + safeHeight) / rowHeight) + Math.max(0, overscan));
  return { start, end };
}

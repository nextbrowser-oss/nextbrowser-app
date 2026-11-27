export type TooltipSide = "top" | "right" | "bottom" | "left";
export interface TooltipAnchor { getBoundingClientRect(): Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height"> }

export function tooltipPosition(anchor: ReturnType<TooltipAnchor["getBoundingClientRect"]>, size: { width: number; height: number }, viewport: { width: number; height: number }, preferred: TooltipSide) {
  const gap = 10;
  const margin = 8;
  const space = { top: anchor.top, bottom: viewport.height - anchor.bottom, left: anchor.left, right: viewport.width - anchor.right };
  const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" } as const;
  const fits = (side: TooltipSide) => space[side] >= (side === "left" || side === "right" ? size.width : size.height) + gap + margin;
  const side = fits(preferred) ? preferred : fits(opposite[preferred]) ? opposite[preferred]
    : (Object.keys(space) as TooltipSide[]).sort((a, b) => space[b] - space[a])[0];
  const centeredX = anchor.left + (anchor.width - size.width) / 2;
  const centeredY = anchor.top + (anchor.height - size.height) / 2;
  return {
    side,
    left: Math.max(margin, Math.min(side === "right" ? anchor.right + gap : side === "left" ? anchor.left - size.width - gap : centeredX, viewport.width - size.width - margin)),
    top: Math.max(margin, Math.min(side === "bottom" ? anchor.bottom + gap : side === "top" ? anchor.top - size.height - gap : centeredY, viewport.height - size.height - margin)),
  };
}

// The "Claude + X = $ a day" hook, drawn over a batch video's reaction:
//
//     [left logo]    +    [right logo]
//
//              $650 a day
//
// Two logos he uploads once for the batch, a plus between them, a blank
// line, and the money line each video gets on its own (batch.ts
// formulaLine) - no other headline. The reaction under it pushes in slowly
// on his face for its whole length (formulaPush).
//
// Layout and motion are worked out here, apart from the render, so they are
// tested on their own (formulaOverlay.test.ts) and the Batch tab's preview
// draws exactly what the video will.

import type { Framing } from './effects'
import type { Headline } from './look'
import { TIKTOK_ZONES, drawHeadline, drawLogo, layoutHeadline, type HeadlineLayout, type LogoLayout } from './overlay'
import { HEADLINE_FAMILY } from './headlineFont'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Each logo fits a square this share of the frame's width. */
const LOGO_SHARE = 0.3
/** The logos' centres, as a share of the width: a third in from each side,
 *  well clear of the edge TikTok keeps for its own buttons further down. */
const LEFT_X = 0.25
const RIGHT_X = 0.75
/** A little room under TikTok's own top bar. */
const TOP_GAP = 0.02
/** The money line, against the largest headline size. */
const MONEY_SCALE = 1.35

export interface FormulaLayout {
  left: LogoLayout | null
  right: LogoLayout | null
  plus: { x: number; y: number; font: string; fontPx: number }
  line: HeadlineLayout | null
}

/** A box of `size` holding an image of `w`x`h`, its shape kept, centred on
 *  (cx, cy). */
function fit(w: number, h: number, size: number, cx: number, cy: number): LogoLayout {
  const scale = Math.min(size / w, size / h)
  const width = w * scale
  const height = h * scale
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}

export function layoutFormula(
  ctx: Ctx,
  width: number,
  height: number,
  logos: { left: { width: number; height: number } | null; right: { width: number; height: number } | null },
  line: string,
  look: Pick<Headline, 'style' | 'outlineColor' | 'outlineWidth'>,
): FormulaLayout {
  // Sized off the shorter side, as the headline is, so a landscape frame
  // does not get logos taller than itself.
  const unit = Math.min(width, height * (9 / 16))
  const size = unit * LOGO_SHARE
  const top = height * (TIKTOK_ZONES.top + TOP_GAP)
  const cy = top + size / 2
  const left = logos.left ? fit(logos.left.width, logos.left.height, size, width * LEFT_X, cy) : null
  const right = logos.right ? fit(logos.right.width, logos.right.height, size, width * RIGHT_X, cy) : null
  const plusPx = Math.round(size * 0.8)
  // The money is the hook: a third bigger than the largest headline. Laid
  // out as if the frame were that much bigger, then centred on this one.
  const money = layoutHeadline(ctx, width * MONEY_SCALE, height * MONEY_SCALE, {
    text: line,
    position: 'top',
    style: look.style,
    size: 'large',
    outlineColor: look.outlineColor,
    outlineWidth: look.outlineWidth,
  })
  // One blank line between the logos and the money.
  const placed = money ? { ...money, centerX: width / 2, top: top + size + money.lineHeight } : null
  return {
    left,
    right,
    plus: { x: width / 2, y: cy, font: `800 ${plusPx}px ${HEADLINE_FAMILY}`, fontPx: plusPx },
    line: placed,
  }
}

export function drawFormula(
  ctx: Ctx,
  layout: FormulaLayout,
  images: { left: CanvasImageSource | null; right: CanvasImageSource | null },
): void {
  if (layout.left && images.left) drawLogo(ctx, images.left, layout.left)
  if (layout.right && images.right) drawLogo(ctx, images.right, layout.right)
  ctx.save()
  ctx.font = layout.plus.font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = layout.plus.fontPx * 0.12
  ctx.strokeStyle = '#000000'
  ctx.strokeText('+', layout.plus.x, layout.plus.y)
  ctx.fillStyle = '#ffffff'
  ctx.fillText('+', layout.plus.x, layout.plus.y)
  ctx.restore()
  if (layout.line) drawHeadline(ctx, layout.line)
}

/** How close the reaction ends up: a fifth bigger by the cut. */
export const PUSH_TO = 1.2
/** And how far its centre drifts sideways meanwhile, as a share of width. */
const DRIFT = 0.03

function easeInOut(x: number): number {
  const c = Math.min(1, Math.max(0, x))
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2
}

/** The reaction's slow push into his face: from the whole frame at the
 *  start to PUSH_TO at the cut, with a slight drift, `t` seconds into a
 *  clip `duration` long. */
export function formulaPush(t: number, duration: number): Framing {
  const k = duration > 0 ? easeInOut(t / duration) : 0
  return { scale: 1 + (PUSH_TO - 1) * k, dx: DRIFT * k }
}

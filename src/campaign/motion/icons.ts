// The drawings on the motion graphics board: simple line icons, drawn from
// code on a 24x24 grid with round ends - so there is nothing to load, they
// are sharp at any size, and they look the same on the phone and the Cutter
// server. His ask (2026-11-08): "make the white part on top less plain right
// now its just text could be nice if we had some drawings". Claude picks one
// per title, card, list row and number, and rows of big ones (the "icons"
// part); the names are in supabase/functions/postiz/motion.ts ICONS.
//
// Drawn by hand for this app, not copied from an icon set.

import type { Icon } from '../../../supabase/functions/postiz/motion.ts'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y)
  ctx.arc(x, y, r, 0, Math.PI * 2)
}

function lines(ctx: Ctx, ...points: [number, number][]): void {
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
}

function glyph(ctx: Ctx, text: string, x: number, y: number, px: number): void {
  ctx.font = `800 ${px}px -apple-system, "Helvetica Neue", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5)
}

/** Paths of one icon on the 24 grid; filled bits filled here. */
function paths(ctx: Ctx, name: Icon): void {
  switch (name) {
    case 'money':
      rr(ctx, 2, 6, 20, 12, 2)
      circle(ctx, 12, 12, 3)
      lines(ctx, [6, 9], [6, 9.01])
      ctx.moveTo(18, 15)
      ctx.lineTo(18, 15.01)
      return
    case 'coins':
      ctx.ellipse(9, 7, 6, 2.5, 0, 0, Math.PI * 2)
      ctx.moveTo(3, 7)
      ctx.lineTo(3, 15)
      ctx.ellipse(9, 15, 6, 2.5, 0, Math.PI, 0, true)
      ctx.moveTo(15, 7)
      ctx.lineTo(15, 11)
      ctx.moveTo(3, 11)
      ctx.ellipse(9, 11, 6, 2.5, 0, Math.PI, 0, true)
      ctx.moveTo(21, 13)
      ctx.ellipse(17, 13, 4, 2, 0, 0, Math.PI * 2)
      ctx.moveTo(13, 13)
      ctx.lineTo(13, 18)
      ctx.ellipse(17, 18, 4, 2, 0, Math.PI, 0, true)
      ctx.lineTo(21, 13)
      return
    case 'chart-up':
      lines(ctx, [3, 3], [3, 21], [21, 21])
      lines(ctx, [7, 16], [11, 12], [14, 14], [20, 7])
      lines(ctx, [15, 7], [20, 7], [20, 12])
      return
    case 'chart-down':
      lines(ctx, [3, 3], [3, 21], [21, 21])
      lines(ctx, [7, 8], [11, 12], [14, 10], [20, 17])
      lines(ctx, [15, 17], [20, 17], [20, 12])
      return
    case 'video':
      rr(ctx, 2, 6, 14, 12, 2.5)
      lines(ctx, [16, 10.5], [22, 7], [22, 17], [16, 13.5])
      return
    case 'camera':
      lines(ctx, [3, 8], [7, 8], [9, 5], [15, 5], [17, 8], [21, 8], [21, 19], [3, 19], [3, 8])
      circle(ctx, 12, 13, 3.5)
      return
    case 'phone':
      rr(ctx, 6, 2, 12, 20, 2.5)
      lines(ctx, [10.5, 18.5], [13.5, 18.5])
      return
    case 'eye':
      ctx.moveTo(2, 12)
      ctx.quadraticCurveTo(12, 2, 22, 12)
      ctx.quadraticCurveTo(12, 22, 2, 12)
      circle(ctx, 12, 12, 3)
      return
    case 'heart':
      ctx.moveTo(12, 20)
      ctx.bezierCurveTo(3, 14, 1, 8, 6, 5)
      ctx.bezierCurveTo(9, 3.5, 11, 5, 12, 7)
      ctx.bezierCurveTo(13, 5, 15, 3.5, 18, 5)
      ctx.bezierCurveTo(23, 8, 21, 14, 12, 20)
      ctx.closePath()
      return
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 10 : 4.4
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const x = 12 + r * Math.cos(a)
        const y = 12.5 + r * Math.sin(a)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      return
    }
    case 'fire':
      ctx.moveTo(12, 22)
      ctx.bezierCurveTo(6, 22, 4, 17, 6, 13)
      ctx.bezierCurveTo(7, 11, 8, 12, 8.5, 13.5)
      ctx.bezierCurveTo(8.5, 9, 11, 5, 13, 2)
      ctx.bezierCurveTo(15, 7, 20, 10, 18.5, 16.5)
      ctx.bezierCurveTo(17.8, 20, 15, 22, 12, 22)
      ctx.closePath()
      ctx.moveTo(12, 22)
      ctx.bezierCurveTo(10, 21, 9.5, 18, 12, 15)
      ctx.bezierCurveTo(14.5, 18, 14, 21, 12, 22)
      return
    case 'bolt':
      lines(ctx, [13, 2], [4, 14], [11, 14], [10, 22], [20, 9], [13, 9], [13, 2])
      return
    case 'clock':
      circle(ctx, 12, 12, 9.5)
      lines(ctx, [12, 6.5], [12, 12], [16, 14])
      return
    case 'calendar':
      rr(ctx, 3, 5, 18, 16, 2.5)
      lines(ctx, [3, 10], [21, 10])
      lines(ctx, [8, 3], [8, 7])
      ctx.moveTo(16, 3)
      ctx.lineTo(16, 7)
      return
    case 'user':
      circle(ctx, 12, 8, 4)
      ctx.moveTo(4, 21)
      ctx.bezierCurveTo(4, 15, 20, 15, 20, 21)
      return
    case 'users':
      circle(ctx, 9, 8, 3.5)
      ctx.moveTo(2, 20)
      ctx.bezierCurveTo(2, 14.5, 16, 14.5, 16, 20)
      ctx.moveTo(16, 4.6)
      ctx.arc(16, 8, 3.4, -Math.PI / 2, Math.PI / 2)
      ctx.moveTo(18, 14.4)
      ctx.bezierCurveTo(20.5, 15, 22, 17, 22, 20)
      return
    case 'target':
      circle(ctx, 12, 12, 9.5)
      circle(ctx, 12, 12, 5.5)
      circle(ctx, 12, 12, 1.5)
      return
    case 'bulb':
      ctx.moveTo(9, 16)
      ctx.bezierCurveTo(9, 13, 5, 12, 5, 8.5)
      ctx.arc(12, 8.5, 7, Math.PI, 0)
      ctx.bezierCurveTo(19, 12, 15, 13, 15, 16)
      ctx.closePath()
      lines(ctx, [9.5, 19], [14.5, 19])
      ctx.moveTo(10.5, 22)
      ctx.lineTo(13.5, 22)
      return
    case 'lock':
      rr(ctx, 4, 11, 16, 11, 2.5)
      ctx.moveTo(8, 11)
      ctx.lineTo(8, 7)
      ctx.arc(12, 7, 4, Math.PI, 0)
      ctx.lineTo(16, 11)
      ctx.moveTo(12, 15)
      ctx.lineTo(12, 18)
      return
    case 'gift':
      rr(ctx, 3, 8, 18, 5, 1.5)
      lines(ctx, [5, 13], [5, 21], [19, 21], [19, 13])
      lines(ctx, [12, 8], [12, 21])
      ctx.moveTo(12, 8)
      ctx.bezierCurveTo(10, 3, 5, 4, 7.5, 8)
      ctx.moveTo(12, 8)
      ctx.bezierCurveTo(14, 3, 19, 4, 16.5, 8)
      return
    case 'cart':
      lines(ctx, [2, 3], [5, 3], [7.5, 15], [19, 15], [21, 7], [6, 7])
      circle(ctx, 9, 19.5, 1.5)
      circle(ctx, 17, 19.5, 1.5)
      return
    case 'megaphone':
      lines(ctx, [3, 10], [3, 14], [7, 14], [17, 19], [17, 5], [7, 10], [3, 10])
      lines(ctx, [7, 14], [8.5, 20], [11, 20], [10, 15.5])
      ctx.moveTo(20, 9.5)
      ctx.quadraticCurveTo(22, 12, 20, 14.5)
      return
    case 'trophy':
      lines(ctx, [7, 3], [17, 3], [17, 9])
      ctx.arc(12, 9, 5, 0, Math.PI)
      lines(ctx, [7, 9], [7, 3])
      ctx.moveTo(7, 5)
      ctx.lineTo(3.5, 5)
      ctx.quadraticCurveTo(3.5, 10, 7.5, 11)
      ctx.moveTo(17, 5)
      ctx.lineTo(20.5, 5)
      ctx.quadraticCurveTo(20.5, 10, 16.5, 11)
      lines(ctx, [12, 14], [12, 18])
      lines(ctx, [8, 21], [16, 21], [15, 18], [9, 18], [8, 21])
      return
    case 'warning':
      lines(ctx, [12, 3], [22, 20], [2, 20], [12, 3])
      lines(ctx, [12, 9], [12, 14])
      ctx.moveTo(12, 17)
      ctx.lineTo(12, 17.01)
      return
    case 'question':
      circle(ctx, 12, 12, 9.5)
      ctx.moveTo(9.3, 9.5)
      ctx.bezierCurveTo(9.3, 6, 15, 6, 15, 9.5)
      ctx.bezierCurveTo(15, 12, 12, 11.5, 12, 14)
      ctx.moveTo(12, 17)
      ctx.lineTo(12, 17.01)
      return
    case 'chat':
      rr(ctx, 3, 4, 18, 13, 3)
      lines(ctx, [7, 17], [6, 21], [11, 17])
      lines(ctx, [8, 10.5], [8, 10.51])
      ctx.moveTo(12, 10.5)
      ctx.lineTo(12, 10.51)
      ctx.moveTo(16, 10.5)
      ctx.lineTo(16, 10.51)
      return
    case 'play':
      circle(ctx, 12, 12, 9.5)
      lines(ctx, [10, 8], [16, 12], [10, 16], [10, 8])
      return
    case 'globe':
      circle(ctx, 12, 12, 9.5)
      ctx.moveTo(2.5, 12)
      ctx.lineTo(21.5, 12)
      ctx.moveTo(12, 2.5)
      ctx.ellipse(12, 12, 4.2, 9.5, 0, -Math.PI / 2, Math.PI * 1.5)
      return
    case 'home':
      lines(ctx, [3, 11], [12, 3], [21, 11])
      lines(ctx, [5, 9.5], [5, 21], [19, 21], [19, 9.5])
      lines(ctx, [10, 21], [10, 15], [14, 15], [14, 21])
      return
    case 'rocket':
      ctx.moveTo(12, 2)
      ctx.bezierCurveTo(17, 6, 17, 12, 15, 16)
      ctx.lineTo(9, 16)
      ctx.bezierCurveTo(7, 12, 7, 6, 12, 2)
      ctx.closePath()
      circle(ctx, 12, 9, 1.8)
      lines(ctx, [8.5, 12], [5, 15], [6, 18], [9, 16])
      lines(ctx, [15.5, 12], [19, 15], [18, 18], [15, 16])
      lines(ctx, [10.5, 19], [10.5, 21])
      ctx.moveTo(13.5, 19)
      ctx.lineTo(13.5, 22)
      return
    case 'check':
      lines(ctx, [4, 12.5], [9.5, 18], [20, 6])
      return
    case 'cross':
      lines(ctx, [5, 5], [19, 19])
      ctx.moveTo(19, 5)
      ctx.lineTo(5, 19)
      return
    case 'arrow':
      lines(ctx, [3, 12], [20, 12])
      lines(ctx, [14, 6], [20, 12], [14, 18])
      return
    case 'hashtag':
      lines(ctx, [9, 3], [7, 21])
      lines(ctx, [17, 3], [15, 21])
      lines(ctx, [4, 9], [21, 9])
      ctx.moveTo(3, 15)
      ctx.lineTo(20, 15)
      return
    case 'brain':
      ctx.moveTo(12, 4)
      ctx.bezierCurveTo(10, 2, 6, 3, 6, 6)
      ctx.bezierCurveTo(3, 6.5, 2.5, 10, 4, 11.5)
      ctx.bezierCurveTo(2, 13, 3, 17, 6, 17)
      ctx.bezierCurveTo(6, 20, 10, 21.5, 12, 19.5)
      ctx.bezierCurveTo(14, 21.5, 18, 20, 18, 17)
      ctx.bezierCurveTo(21, 17, 22, 13, 20, 11.5)
      ctx.bezierCurveTo(21.5, 10, 21, 6.5, 18, 6)
      ctx.bezierCurveTo(18, 3, 14, 2, 12, 4)
      ctx.moveTo(12, 4)
      ctx.lineTo(12, 19.5)
      ctx.moveTo(8, 9)
      ctx.quadraticCurveTo(10, 10, 9, 13)
      ctx.moveTo(16, 9)
      ctx.quadraticCurveTo(14, 10, 15, 13)
      return
    case 'tools':
      lines(ctx, [14, 6], [18, 2], [22, 6], [18, 10], [14, 6])
      lines(ctx, [15.5, 8.5], [4, 20])
      lines(ctx, [4, 4], [8, 4], [20, 16], [20, 20], [16, 20], [4, 8], [4, 4])
      return
  }
}

/** How long a drawing takes to draw itself on, in seconds. */
export const DRAW_ON_SEC = 0.5

const clamp01 = (n: number) => (n <= 0 ? 0 : n >= 1 ? 1 : Number.isFinite(n) ? n : 1)

/** How a drawing keeps moving once it is drawn - his ask (2026-11-08): "What
 *  I meant is probably some animations". Each in its own way: the rocket
 *  shakes and lifts, the heart beats, money and gifts float, the clock and
 *  the megaphone wiggle, fire and bolts flicker; the rest breathe gently.
 *  `life`: seconds since it came up. Offsets in the icon's 24 grid. */
export function iconMotion(name: Icon, life: number): { dx: number; dy: number; turn: number; grow: number } {
  if (!Number.isFinite(life) || life <= 0) return { dx: 0, dy: 0, turn: 0, grow: 1 }
  // Comes in slowly after it is drawn, so the drawing on reads first.
  const k = clamp01((life - DRAW_ON_SEC * 0.6) / 0.6)
  const s = (speed: number, phase = 0) => Math.sin(life * speed + phase)
  switch (name) {
    case 'rocket':
      return { dx: 0.35 * s(47) * k, dy: (-1.2 + 1.2 * s(3.2)) * k, turn: 0, grow: 1 }
    case 'heart': {
      const beat = Math.max(0, s(7)) ** 6
      return { dx: 0, dy: 0, turn: 0, grow: 1 + 0.14 * beat * k }
    }
    case 'money':
    case 'coins':
    case 'gift':
    case 'trophy':
    case 'star':
      return { dx: 0, dy: 1.1 * s(3.4) * k, turn: name === 'star' ? 0.12 * s(2.2) * k : 0, grow: 1 }
    case 'clock':
    case 'megaphone':
    case 'warning':
    case 'phone':
      return { dx: 0, dy: 0, turn: 0.13 * s(9) * Math.max(0, s(1.6)) * k, grow: 1 }
    case 'fire':
    case 'bolt':
      return { dx: 0, dy: 0, turn: 0, grow: 1 + 0.06 * s(13) * s(5.3) * k }
    case 'chart-up':
      return { dx: 0, dy: -0.7 * (0.5 + 0.5 * s(3)) * k, turn: 0, grow: 1 }
    case 'chart-down':
      return { dx: 0, dy: 0.7 * (0.5 + 0.5 * s(3)) * k, turn: 0, grow: 1 }
    case 'arrow':
      return { dx: 1.2 * (0.5 + 0.5 * s(5)) * k, dy: 0, turn: 0, grow: 1 }
    case 'globe':
    case 'target':
      return { dx: 0, dy: 0, turn: 0.1 * s(2.4) * k, grow: 1 }
    default:
      return { dx: 0, dy: 0, turn: 0, grow: 1 + 0.035 * s(3) * k }
  }
}

/** Draws icon `name` centred on (cx, cy), `size` across, in `colour`.
 *  `life`, seconds since it came up: it draws itself on, line by line, then
 *  keeps moving (iconMotion); left out, it is drawn still and whole. */
export function drawIcon(ctx: Ctx, name: Icon, cx: number, cy: number, size: number, colour: string, life = Infinity): void {
  const drawn = clamp01(life / DRAW_ON_SEC)
  if (drawn <= 0) return
  const move = iconMotion(name, life)
  ctx.save()
  ctx.translate(cx, cy)
  if (move.turn) ctx.rotate(move.turn)
  ctx.scale((size / 24) * move.grow, (size / 24) * move.grow)
  ctx.translate(-12 + move.dx, -12 + move.dy)
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Drawn on: every line grows from its start at once (the dash starts again
  // on each line of the drawing).
  if (drawn < 1) ctx.setLineDash([64 * (1 - (1 - drawn) ** 2), 64])
  ctx.beginPath()
  paths(ctx, name)
  ctx.stroke()
  if (drawn < 1) ctx.setLineDash([])
  // A soft fill inside the closed shapes that read better solid.
  if (name === 'heart' || name === 'star' || name === 'bolt' || name === 'fire') {
    ctx.globalAlpha *= 0.18 * drawn
    ctx.fill()
  }
  if (name === 'money') {
    ctx.globalAlpha = drawn
    glyph(ctx, '$', 12, 12, 5)
  }
  ctx.restore()
}

/** An icon on a soft disc of its colour - how it sits on the board. */
export function drawIconBadge(ctx: Ctx, name: Icon, cx: number, cy: number, size: number, colour: string, life = Infinity): void {
  // The disc pops out a little past its size and back, then the drawing
  // draws itself on it.
  const p = clamp01(life / 0.3)
  const pop = p >= 1 ? 1 : 1 + 2.4 * (p - 1) ** 3 + 1.4 * (p - 1) ** 2
  if (pop > 0) {
    ctx.save()
    ctx.fillStyle = colour
    ctx.globalAlpha *= 0.13
    ctx.beginPath()
    ctx.arc(cx, cy, (size / 2) * pop, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  drawIcon(ctx, name, cx, cy, size * 0.58, colour, life - 0.12)
}

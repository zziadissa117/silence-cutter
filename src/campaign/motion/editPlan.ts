// Changing the plan by hand (2026-11-12, "a lot of things are missing"): a
// word wrong on a card, a graphic he doesn't want - fixed on the plan screen
// in a tap, without asking Claude and waiting. Every text a graphic shows is
// listed for its moment, under plain names; a moment can be taken out (the
// call to action stays - always one, his rule 2026-11-08).

import { MOTION_LIMITS as LIMITS, type Part, type Scene, type Storyboard } from '../../../supabase/functions/postiz/motion'

/** A moment of the plan, as the plan screen lists them. */
export type Spot = { kind: 'title' } | { kind: 'hook' } | { kind: 'end' } | { kind: 'scene'; index: number }

export interface Field {
  /** Where it is, from the moment: "parts.0.items.1.text". */
  key: string
  /** What he sees it called. */
  label: string
  value: string
  /** Shows nothing when empty: the graphic's main words can't be emptied. */
  optional: boolean
}

const field = (key: string, label: string, value: string | undefined, optional = false): Field => ({ key, label, value: value ?? '', optional })

function partFields(part: Part, at: string, many: boolean, n: number): Field[] {
  const name = (label: string) => (many ? `${n + 1}. ${label}` : label)
  switch (part.kind) {
    case 'title':
      return [field(`${at}.text`, name('Title'), part.text)]
    case 'note':
      return [field(`${at}.text`, name('Note'), part.text)]
    case 'pop':
      return [field(`${at}.text`, name('Card'), part.text)]
    case 'number':
      return [field(`${at}.text`, name('Number'), part.text), field(`${at}.label`, name('Line under it'), part.label, true)]
    case 'cards':
      return part.cards.flatMap((card, c) => [
        field(`${at}.cards.${c}.badge`, name(`Card ${c + 1} heading`), card.badge),
        ...card.lines.map((line, l) => field(`${at}.cards.${c}.lines.${l}.text`, name(`Card ${c + 1}, line ${l + 1}`), line.text)),
      ])
    case 'list':
      return part.items.map((item, i) => field(`${at}.items.${i}.text`, name(`Line ${i + 1}`), item.text))
    case 'icons':
      return part.items.map((item, i) => field(`${at}.items.${i}.text`, name(`Word ${i + 1}`), item.text))
    case 'tiles':
      return [field(`${at}.unit`, name('What the squares are'), part.unit, true), field(`${at}.window`, name('When'), part.window, true)]
    case 'phones':
      return [
        ...part.items.map((item, i) => field(`${at}.items.${i}.label`, name(`Phone ${i + 1} views`), item.label)),
        ...part.prices.map((price, i) => field(`${at}.prices.${i}.text`, name(`Price ${i + 1}`), price.text)),
      ]
    case 'math':
      return [
        ...part.lines.map((line, i) => field(`${at}.lines.${i}.text`, name(`Line ${i + 1}`), line.text)),
        field(`${at}.result.text`, name('Result'), part.result.text),
      ]
    case 'tag':
      return [field(`${at}.text`, name('Line'), part.text), field(`${at}.label`, name('Small line'), part.label, true), field(`${at}.mark`, name('Words in the orange pill'), part.mark, true)]
    case 'blocks':
      return [field(`${at}.title`, name('Title'), part.title), field(`${at}.tag`, name('Small line'), part.tag, true), ...(part.after ? [field(`${at}.after.text`, name('After the cut'), part.after.text)] : [])]
    case 'stat':
      return [field(`${at}.text`, name('Number'), part.text), field(`${at}.tag`, name('Small line'), part.tag, true), field(`${at}.sub`, name('Line under it'), part.sub, true)]
    case 'picture':
      return [field(`${at}.emoji`, name('Emoji'), part.emoji, true), field(`${at}.tag`, name('Line'), part.tag, true)]
    case 'steps':
      return [
        field(`${at}.tag`, name('Heading'), part.tag, true),
        ...part.items.flatMap((item, i) => [
          field(`${at}.items.${i}.text`, name(`Step ${i + 1}`), item.text),
          field(`${at}.items.${i}.note`, name(`Step ${i + 1}, small line`), item.note, true),
          ...(item.pill ? [field(`${at}.items.${i}.pill`, name(`Step ${i + 1}, pill`), item.pill, true)] : []),
        ]),
      ]
  }
}

/** Every text the moment shows, in the order they come up. */
export function fieldsOf(board: Storyboard, spot: Spot): Field[] {
  if (spot.kind === 'title') return board.title ? [field('text', 'Title', board.title.text)] : []
  if (spot.kind === 'hook') return board.hook ? [field('text', 'Number', board.hook.text), field('label', 'Line under it', board.hook.label, true)] : []
  if (spot.kind === 'end') return board.end ? [field('text', 'Call to action', board.end.text)] : []
  const scene = board.scenes[spot.index]
  if (!scene) return []
  const many = scene.parts.length > 1
  return scene.parts.flatMap((part, n) => partFields(part, `parts.${n}`, many, n))
}

function setAt(target: unknown, path: string[], value: string): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (Array.isArray(target)) {
    const i = Number(head)
    if (!Number.isInteger(i) || i < 0 || i >= target.length) return target
    const copy = target.slice()
    copy[i] = setAt(target[i], rest, value)
    return copy
  }
  if (target && typeof target === 'object' && head in target) {
    const was = (target as Record<string, unknown>)[head]
    // Only ever a text where a text was.
    if (rest.length === 0 && typeof was !== 'string') return target
    return { ...(target as Record<string, unknown>), [head]: setAt(was, rest, value) }
  }
  return target
}

/** One line for him of what a scene shows, from its own texts - so the list
 *  says what he changed it to, not what Claude first wrote. */
function saysOf(scene: Scene, board: Storyboard, index: number): string {
  const texts = fieldsOf(board, { kind: 'scene', index })
    .filter((f) => !f.optional && f.value.trim())
    .map((f) => f.value.trim())
  return texts.join(' · ').slice(0, LIMITS.says) || scene.says
}

/** The plan with one text changed. An empty main text, or a key that isn't
 *  one of the moment's texts, leaves it as it was. */
export function withField(board: Storyboard, spot: Spot, key: string, value: string): Storyboard {
  const known = fieldsOf(board, spot).find((f) => f.key === key)
  if (!known) return board
  const text = value.replace(/\s+/g, ' ').slice(0, LIMITS.chars)
  if (!known.optional && !text.trim()) return board
  const path = key.split('.')
  if (spot.kind === 'title' && board.title) return { ...board, title: setAt(board.title, path, text) as Storyboard['title'] }
  if (spot.kind === 'hook' && board.hook) return { ...board, hook: setAt(board.hook, path, text) as Storyboard['hook'] }
  if (spot.kind === 'end' && board.end) return { ...board, end: setAt(board.end, path, text) as Storyboard['end'] }
  if (spot.kind !== 'scene' || !board.scenes[spot.index]) return board
  const scenes = board.scenes.slice()
  const changed = setAt(scenes[spot.index], path, text) as Scene
  scenes[spot.index] = changed
  const next = { ...board, scenes }
  scenes[spot.index] = { ...changed, says: saysOf(changed, next, spot.index) }
  return next
}

/** Whether he can take the moment out: anything but the call to action. */
export const removable = (spot: Spot): boolean => spot.kind !== 'end'

/** The plan without the moment. */
export function withoutSpot(board: Storyboard, spot: Spot): Storyboard {
  if (spot.kind === 'title') return { ...board, title: null }
  if (spot.kind === 'hook') return { ...board, hook: null }
  if (spot.kind === 'scene') return { ...board, scenes: board.scenes.filter((_, i) => i !== spot.index) }
  return board
}

export const sameSpot = (a: Spot | null, b: Spot): boolean => !!a && a.kind === b.kind && (a.kind !== 'scene' || (b.kind === 'scene' && a.index === b.index))

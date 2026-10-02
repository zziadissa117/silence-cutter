// Asked each time captions are about to be checked: does the hook - the
// first seconds, while the headline is up - get captions too? It is a choice
// per video, by whoever is making it, so it is asked here rather than set
// once for everyone. The answer given last on this phone is the one offered
// first.

import { ChevronLeft } from './icons'

const LAST_KEY = 'campaign.hookCaptions'

/** What was chosen last on this phone; false (no hook captions) until then. */
export function lastHookChoice(): boolean {
  try {
    return localStorage.getItem(LAST_KEY) === 'true'
  } catch {
    return false
  }
}

function rememberHookChoice(on: boolean): void {
  try {
    localStorage.setItem(LAST_KEY, String(on))
  } catch {
    // Just offered the other way round next time.
  }
}

export function HookQuestion({
  count,
  onChoose,
  onCancel,
}: {
  /** How many videos are about to be checked. */
  count: number
  onChoose: (hookCaptions: boolean) => void
  onCancel: () => void
}) {
  const last = lastHookChoice()
  const choose = (on: boolean) => {
    rememberHookChoice(on)
    onChoose(on)
  }
  const options = [
    { on: false, label: 'No - start after the headline' },
    { on: true, label: 'Yes - caption the hook too' },
  ].sort((a, b) => Number(b.on === last) - Number(a.on === last))
  return (
    <section className="screen hook-question">
      <button type="button" className="back" onClick={onCancel}>
        <ChevronLeft /> Videos
      </button>
      <h2>Captions on the hook?</h2>
      <p className="lede">
        The hook is the start of the video, while the headline is up.
        {count > 1 ? ` This goes for all ${count} videos you're checking.` : ''}
      </p>
      {options.map(({ on, label }, i) => (
        <button key={label} type="button" className={`btn wide${i === 0 ? ' primary' : ''}`} onClick={() => choose(on)}>
          {label}
        </button>
      ))}
    </section>
  )
}

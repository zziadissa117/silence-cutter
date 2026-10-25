// The top of the Batch tab while a batch runs (batchNow.ts): what it is
// doing now, in one line he can read at a glance, and each of the next days
// - how many are ready in Posts, gone out, and still being made.

import { todayHere } from './batch'
import { timeAgo, type BatchState, type StatusDay } from './batchNow'

const WHERE = { phone: 'On this phone', server: 'On the server', engine: 'On the engine' } as const

function dayName(date: string): { name: string; num: string } {
  const d = new Date(`${date}T12:00:00`)
  return {
    name: date === todayHere() ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' }),
    num: String(d.getDate()),
  }
}

export function BatchStatus({
  state,
  where,
  days,
  making,
  waiting,
  failed,
  lastReady,
  heardAt,
  freeGB,
  sending,
  stop,
}: {
  state: BatchState
  where: keyof typeof WHERE
  days: readonly StatusDay[]
  /** The video being made right now, and how far it is (null when not said). */
  making: { name: string; progress: number | null } | null
  waiting: number
  /** Videos that couldn't be made: a line of its own while others are being made. */
  failed: number
  lastReady: string | null
  heardAt: string | null
  freeGB: number | null
  /** Clips going up to the server, when they are. */
  sending: string | null
  stop: { label: string; busy: boolean; run: () => void } | null
}) {
  const ahead = days.reduce((n, d) => n + d.target, 0)
  const ready = days.reduce((n, d) => n + Math.min(d.ready, d.target || d.ready), 0)
  const pct = (n: number, of: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, of)) * 100))}%`
  return (
    <div className={`group batch-status ${state.tone}`} aria-live="polite">
      <div className="status-head">
        <span className={`status-dot ${state.tone}`} aria-hidden="true" />
        <span className="status-title">{state.title}</span>
        <span className="status-where">{WHERE[where]}</span>
      </div>
      <p className="status-line">{state.line}</p>

      {making ? (
        <div className="status-now">
          <div className="status-now-row">
            <span className="status-now-label">Now</span>
            <span className="status-now-name">{making.name}</span>
            {making.progress !== null ? <span className="status-now-pct">{Math.round(making.progress * 100)}%</span> : null}
          </div>
          {making.progress !== null ? (
            <div className="bar">
              <div style={{ width: pct(making.progress, 1) }} />
            </div>
          ) : null}
        </div>
      ) : null}

      <ul className="status-facts">
        {waiting > 0 ? <li>{waiting} more waiting to be made</li> : null}
        <li>{lastReady ? `Last video ready ${timeAgo(lastReady)}` : 'No video ready in Posts yet'}</li>
        {failed > 0 && state.tone !== 'bad' ? (
          <li className="warn-text">
            {failed} couldn't be made - {where === 'phone' ? 'Try again below' : 'Start over makes them again'}
          </li>
        ) : null}
        {sending ? <li>{sending}</li> : null}
      </ul>

      <div className="status-days-head">
        <span>Next {days.length} days</span>
        <span>
          {ready} of {ahead} ready
        </span>
      </div>
      <ol className="status-days">
        {days.map((d) => {
          const { name, num } = dayName(d.date)
          const of = Math.max(d.target, d.planned, 1)
          return (
            <li key={d.date} className={d.target > 0 && d.ready >= d.target ? 'full' : ''}>
              <span className="day-name">{name}</span>
              <span className="day-num">{num}</span>
              <span className="day-count">
                {d.ready}
                {d.target > 0 ? <span className="day-of">/{d.target}</span> : null}
              </span>
              <span className="day-bar" aria-label={`${d.ready} of ${d.target} ready, ${d.out} gone out`}>
                <span className="out" style={{ width: pct(d.out, of) }} />
                <span className="ready" style={{ width: pct(d.ready - d.out, of) }} />
                <span className="planned" style={{ width: pct(d.planned - d.ready, of) }} />
              </span>
            </li>
          )
        })}
      </ol>
      <p className="status-legend">
        <span className="key out" /> gone out <span className="key ready" /> ready in Posts <span className="key planned" /> being made
      </p>

      {where === 'server' ? (
        <p className="status-foot">
          Server checked in {heardAt ? timeAgo(heardAt) : 'not yet'}
          {freeGB !== null ? ` · ${freeGB} GB free` : ''}
        </p>
      ) : null}
      {stop ? (
        <button type="button" className="btn small status-stop" disabled={stop.busy} onClick={stop.run}>
          {stop.label}
        </button>
      ) : null}
    </div>
  )
}

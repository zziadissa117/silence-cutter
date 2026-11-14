// The campaign tracker at the top of the Videos tab (his ask, 2026-11-14):
// "on top, the days: Monday, Tuesday ... On the left, it's the first letters
// or name of the campaigns ... Inside the box is a number ... how many posts
// are supposed to go out that day ... yellow for when the posts are
// scheduled. When they're posted, the box changes colors ... blue". So he
// sees at a glance which campaigns posted, which are covered, and where he
// needs to make videos. Each campaign keeps its badge (its logo, or its
// letter on a colour of its own) and its whole name, so Cantina and Coverd
// never look alike. Counting: trackerLines.ts (a separate name: a Mac's disk doesn't tell
// weekTracker.ts from WeekTracker.tsx) and the server's postiz/tracker.ts.

import { useEffect, useMemo, useState } from 'react'

import type { BatchBank } from './batch'
import { BrandBadge } from './HomeTop'
import { ChevronLeft, ChevronRight } from './icons'
import type { Campaign } from './look'
import { lastWeek, loadWeek, type TrackerWeek } from './posting'
import { BATCH_BANK_SAVED, loadBatchBank } from './store'
import { boxParts, boxTotal, boxInk, boxWords, dayTotals, trackerLines, weekRange, weekTitle, type BoxKind, type TrackerBox } from './trackerLines'

/** Read again this often while it is on screen: posts go out all day. */
const FRESH_MS = 5 * 60_000

const COLOUR: Record<BoxKind, string> = {
  posted: 'var(--track-posted)',
  failed: 'var(--track-failed)',
  waiting: 'var(--track-waiting)',
  scheduled: 'var(--track-scheduled)',
  coming: 'var(--track-coming)',
}

const LEGEND: { kind: BoxKind; label: string }[] = [
  { kind: 'scheduled', label: 'Scheduled' },
  { kind: 'coming', label: 'Batch makes it' },
  { kind: 'posted', label: 'Posted' },
  { kind: 'waiting', label: 'To approve' },
  { kind: 'failed', label: "Didn't go out" },
]

/** The box's colours, bottom up, each as tall as its share. */
function fill(b: TrackerBox): string | undefined {
  const parts = boxParts(b)
  if (parts.length === 0) return undefined
  if (parts.length === 1) return COLOUR[parts[0].kind]
  const stops = parts.map((p) => `${COLOUR[p.kind]} ${(p.from * 100).toFixed(1)}% ${(p.to * 100).toFixed(1)}%`)
  return `linear-gradient(to top, ${stops.join(', ')})`
}

const dayLetter = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
const dayNumber = (date: string) => Number(date.slice(8))
const dayLong = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

export function WeekTracker({ campaigns, refresh = 0 }: { campaigns: readonly Campaign[]; refresh?: number }) {
  const [weeks, setWeeks] = useState(0)
  /** The week shown, and which one it is - the last one stays, dimmed, while another comes. */
  const [got, setGot] = useState<{ weeks: number; week: TrackerWeek } | null>(() => {
    const week = lastWeek()
    return week ? { weeks: 0, week } : null
  })
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const [banks, setBanks] = useState<Map<string, BatchBank | null>>(() => new Map())
  const [picked, setPicked] = useState<{ id: string; day: number } | null>(null)

  useEffect(() => {
    let alive = true
    void loadWeek(weeks)
      .then((week) => {
        if (!alive) return
        setGot({ weeks, week })
        setFailed(false)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [weeks, refresh, tick])

  // Fresh again every few minutes, and when he comes back to the app.
  useEffect(() => {
    const again = () => document.visibilityState === 'visible' && setTick((n) => n + 1)
    const timer = window.setInterval(again, FRESH_MS)
    document.addEventListener('visibilitychange', again)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', again)
    }
  }, [])

  // Each campaign's batch, read again when one is saved.
  const ids = campaigns.map((c) => c.id).join(',')
  useEffect(() => {
    let alive = true
    const read = () =>
      void Promise.all(ids.split(',').filter(Boolean).map(async (id) => [id, await loadBatchBank(id).catch(() => null)] as const)).then((list) => {
        if (alive) setBanks(new Map(list))
      })
    read()
    window.addEventListener(BATCH_BANK_SAVED, read)
    return () => {
      alive = false
      window.removeEventListener(BATCH_BANK_SAVED, read)
    }
  }, [ids])

  const byId = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns])
  const names = useMemo(() => new Map(campaigns.map((c) => [c.id, c.name || 'Campaign'])), [campaigns])
  const week = got?.week ?? null
  const lines = useMemo(() => (week ? trackerLines(week, banks, names) : []), [week, banks, names])

  // A server from before the tracker, or nothing read yet: nothing to show.
  if (!week) return null
  const loading = got!.weeks !== weeks && !failed
  const totals = dayTotals(lines, week.days.length)
  const pickedLine = picked ? lines.find((l) => l.id === picked.id) : null
  const go = (by: number) => {
    setPicked(null)
    setFailed(false)
    setWeeks((w) => w + by)
  }

  return (
    <section className="home-section tracker">
      <div className="section-head">
        <h2 className="section-title">{weekTitle(got!.weeks, week.days)}</h2>
        <span className="tracker-nav">
          <button type="button" aria-label="The week before" onClick={() => go(-1)}>
            <ChevronLeft />
          </button>
          <span className="tracker-range">{weekRange(week.days)}</span>
          <button type="button" aria-label="The week after" onClick={() => go(1)}>
            <ChevronRight />
          </button>
        </span>
      </div>
      <div className={`tracker-card${loading ? ' loading' : ''}`}>
        {lines.length === 0 ? (
          <p className="hint tracker-empty">Nothing posted or set to go out this week.</p>
        ) : (
          <div className="tracker-grid">
            <span className="tracker-corner" aria-hidden />
            {week.days.map((d) => (
              <span key={d} className={`tracker-day${d === week.today ? ' today' : ''}`}>
                <span>{dayLetter(d)}</span>
                <b>{dayNumber(d)}</b>
              </span>
            ))}
            {lines.map((line) => {
              const campaign = byId.get(line.id)
              return (
                <div key={line.id} className={`tracker-line${line.quiet ? ' quiet' : ''}`}>
                  <span className="tracker-name">
                    <BrandBadge campaign={campaign ?? { name: line.name, logo: null }} />
                    <span className="tracker-label">{line.name}</span>
                  </span>
                  {line.boxes.map((b, i) => {
                    const total = boxTotal(b)
                    const future = week.days[i] >= week.today
                    const on = picked?.id === line.id && picked.day === i
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`tracker-box${total === 0 ? (future ? ' open' : ' none') : ''}${on ? ' picked' : ''}${week.days[i] === week.today ? ' today' : ''}`}
                        data-ink={boxInk(b) ?? undefined}
                        style={{ background: fill(b) }}
                        aria-label={`${line.name}, ${dayLong(week.days[i])}: ${boxWords(b, future)}`}
                        aria-pressed={on}
                        onClick={() => setPicked(on ? null : { id: line.id, day: i })}
                      >
                        {total > 0 ? total : ''}
                      </button>
                    )
                  })}
                </div>
              )
            })}
            <span className="tracker-name all">All</span>
            {totals.map((n, i) => (
              <span key={i} className={`tracker-total${week.days[i] === week.today ? ' today' : ''}`}>
                {n > 0 ? n : '–'}
              </span>
            ))}
          </div>
        )}
        {pickedLine && picked ? (
          <p className="tracker-picked">
            <b>{pickedLine.name}</b> · {dayLong(week.days[picked.day])}
            <br />
            {boxWords(pickedLine.boxes[picked.day], week.days[picked.day] >= week.today)}
          </p>
        ) : null}
        <div className="tracker-legend" aria-hidden>
          {LEGEND.map((l) => (
            <span key={l.kind}>
              <span className="tracker-swatch" style={{ background: COLOUR[l.kind] }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

// The video bank, in the Bank tab: clips that pop up over him when he says
// their words, muted, playing to their end - see videoBank.ts and
// popVideo.ts. How big and where are set per video on the caption check.

import { useEffect, useState } from 'react'

import { formatTime } from './jobs'
import { parseWordList } from './look'
import { TrackName } from './TrackPlayer'
import { addVideos, posterOf, removeVideo, updateVideo, useVideoBank, videoFile, type BankVideo } from './videoBank'

export function VideoBankView() {
  const bank = useVideoBank()
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const add = async (files: File[]) => {
    setNotice(null)
    setProblem(null)
    setBusy('Checking it…')
    try {
      const { added, skipped, failed } = await addVideos(files, setBusy)
      if (skipped.length > 0) setNotice(`${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} in the bank already.`)
      if (failed.length > 0) setProblem(`Couldn't keep ${failed.join('; ')}.`)
      if (added.length > 0 && failed.length === 0 && skipped.length === 0) setNotice('Added. Type the words that bring it up.')
    } finally {
      setBusy(null)
    }
  }

  const needsWords = bank.filter((v) => v.words.length === 0).length

  return (
    <section className="screen" aria-label="Video bank">
      <div className="screen-head">
        <h1>Videos</h1>
        <div className="btn small primary picker">
          {busy ? 'Adding…' : 'Add videos'}
          <input
            type="file"
            accept="video/*,.mp4,.mov"
            multiple
            disabled={busy !== null}
            aria-label="Add videos"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (picked.length > 0) void add(picked)
            }}
          />
        </div>
      </div>
      <p className="lede">
        Each pops up over you when you say its words - muted, in a big box, playing to its end. Set how big and where on
        each video's caption check. Used by angles that use the bank, like General.
      </p>
      {busy ? <p className="hint">{busy}</p> : null}
      {notice ? <p className="hint">{notice}</p> : null}
      {problem ? <div className="error">{problem}</div> : null}
      {needsWords > 0 ? (
        <p className="hint warn-text">
          {needsWords} video{needsWords === 1 ? ' needs' : 's need'} words before it can come up.
        </p>
      ) : null}
      {bank.length === 0 ? <p className="empty">No videos yet.</p> : null}
      <div className="bank">
        {bank.map((video) => (
          <VideoRow key={video.id} video={video} />
        ))}
      </div>
    </section>
  )
}

function VideoRow({ video }: { video: BankVideo }) {
  const [still, setStill] = useState<string | null>(null)
  const [watching, setWatching] = useState<string | null>(null)
  const [words, setWords] = useState(video.words.join(', '))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let url: string | null = null
    let alive = true
    void posterOf(video).then((blob) => {
      if (!alive || !blob) return
      url = URL.createObjectURL(blob)
      setStill(url)
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [video])

  useEffect(() => () => void (watching && URL.revokeObjectURL(watching)), [watching])

  const watch = async () => {
    if (watching) {
      setWatching(null)
      return
    }
    setError(null)
    const file = await videoFile(video).catch(() => null)
    if (!file) setError('This video is no longer on the phone.')
    else setWatching(URL.createObjectURL(file))
  }

  return (
    <div className="bank-row video-row">
      {watching ? (
        <video className="thumb" src={watching} autoPlay muted playsInline onEnded={() => setWatching(null)} />
      ) : still ? (
        <img className="thumb" src={still} alt={video.name} />
      ) : (
        <span className="thumb" />
      )}
      <div className="video-row-main">
        <div className="music-pick">
          <button type="button" className="btn small icon-btn" aria-label={watching ? `Stop ${video.name}` : `Watch ${video.name}`} onClick={() => void watch()}>
            {watching ? '■' : '▶'}
          </button>
          <TrackName name={video.name} onRename={(name) => void updateVideo(video.id, { name })} />
          <span className="hint">{formatTime(video.seconds)}</span>
        </div>
        <input
          type="text"
          value={words}
          placeholder="Comes up when I say…"
          autoCapitalize="off"
          aria-label={`Words that bring up ${video.name}`}
          className={video.words.length === 0 ? 'needs' : ''}
          onChange={(e) => setWords(e.target.value)}
          onBlur={() => void updateVideo(video.id, { words: parseWordList(words) })}
        />
        {error ? <span className="hint warn-text">{error}</span> : null}
      </div>
      <button
        type="button"
        className="linkbtn"
        aria-label={`Remove ${video.name}`}
        onClick={() => {
          if (window.confirm(`Take ${video.name} out of the video bank? Videos already made keep it.`)) void removeVideo(video.id)
        }}
      >
        Remove
      </button>
    </div>
  )
}

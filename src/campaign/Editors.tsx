// Setting up a campaign (the brand: name, logo, the name as he says it) and
// each of its angles (the format: headline, where the logo sits, sounds).
//
// This is the "lock" step: nothing is used until it is saved, and it cannot
// be saved while anything about it is wrong.

import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  LIMITS,
  angleProblems,
  blankPicture,
  campaignProblems,
  parseWordList,
  videoLook,
  isReaction,
  type Angle,
  type AngleSound,
  type BuiltInSound,
  type Campaign,
  type CampaignFormat,
  type HeadlinePosition,
  type HeadlineSize,
  type HeadlineStyle,
  type LogoPosition,
  type PictureCue,
} from './look'
import { ClipRow } from './ClipRow'
import { CLIP_PLACES, type AngleClips, type ClipInfo } from './clips'
import { EffectsSection } from './EffectsSection'
import { PictureRow, shrinkPicture } from './PictureRow'
import { LookPreview } from './Preview'
import { MusicRow } from './MusicRow'
import { SoundRow } from './SoundRow'

const POSITIONS: { value: HeadlinePosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
]
const STYLES: { value: HeadlineStyle; label: string }[] = [
  { value: 'box', label: 'White box' },
  { value: 'outline', label: 'Outline' },
]
const SIZES: { value: HeadlineSize; label: string }[] = [
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
]
const FORMATS: { value: CampaignFormat; label: string }[] = [
  { value: 'talking', label: 'Talking head' },
  { value: 'reaction', label: 'Reaction + product' },
]
const SWITCH_SOUNDS: { value: BuiltInSound | 'none'; label: string }[] = [
  { value: 'whoosh', label: 'Whoosh' },
  { value: 'pop', label: 'Pop' },
  { value: 'ding', label: 'Ding' },
  { value: 'none', label: 'None' },
]
const LOGO_POSITIONS: { value: LogoPosition; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]

export function EditorFrame({
  title,
  onCancel,
  problems,
  saving,
  saveLabel,
  onSave,
  deleteLabel,
  onDelete,
  children,
}: {
  title: string
  onCancel: () => void
  problems: string[]
  saving: boolean
  saveLabel: string
  onSave: () => void
  deleteLabel?: string
  onDelete?: () => void
  children: ReactNode
}) {
  return (
    <section className="editor">
      <div className="editor-head">
        <h2>{title}</h2>
        <button type="button" className="linkbtn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {children}
      {onDelete && deleteLabel ? (
        // Down here, away from Save, so it is never hit by mistake.
        <button type="button" className="linkbtn danger delete" onClick={onDelete}>
          {deleteLabel}
        </button>
      ) : null}
      <div className="editor-foot sticky">
        {problems.length > 0 ? (
          <div className="error">
            {problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        ) : null}
        <button type="button" className="btn primary wide" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </section>
  )
}

/** Runs a save, and says so in the form if the device would not keep it. */
export function useSaver(): [boolean, string[], (problems: string[], save: () => Promise<void>) => Promise<void>] {
  const [saving, setSaving] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const run = async (found: string[], save: () => Promise<void>) => {
    setProblems(found)
    if (found.length > 0) return
    setSaving(true)
    try {
      await save()
    } catch (error) {
      setProblems([
        `It couldn't be saved on this device (${error instanceof Error ? error.message : String(error)}). If this is a private window, try a normal one.`,
      ])
    } finally {
      setSaving(false)
    }
  }
  return [saving, problems, run]
}

// --- The campaign -------------------------------------------------------------

export function CampaignEditor({
  initial,
  isNew,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: Campaign
  isNew: boolean
  onSave: (campaign: Campaign) => Promise<void>
  onCancel: () => void
  onDelete: () => void
}) {
  const [campaign, setCampaign] = useState(initial)
  const [brandText, setBrandText] = useState(initial.brandWords.join(', '))
  const [saving, problems, run] = useSaver()
  const logoPicker = useRef<HTMLInputElement>(null)
  const logoUrl = useObjectUrl(campaign.logo)

  return (
    <EditorFrame
      title={isNew ? 'New campaign' : `Edit ${initial.name}`}
      onCancel={onCancel}
      problems={problems}
      saving={saving}
      saveLabel="Save campaign"
      onSave={() => void run(campaignProblems(campaign), () => onSave(campaign))}
      deleteLabel={isNew ? undefined : 'Delete campaign'}
      onDelete={
        isNew
          ? undefined
          : () => {
              if (window.confirm(`Delete ${initial.name} and all its angles? Videos already made are not affected.`)) onDelete()
            }
      }
    >
      <div className="hint">
        The brand - shared by every angle. Videos that fit no angle of their own go to its General angle.
      </div>
      <label className="field">
        <span className="label">Campaign name</span>
        <input
          type="text"
          value={campaign.name}
          placeholder="e.g. Vertus"
          onChange={(e) => setCampaign((c) => ({ ...c, name: e.target.value }))}
        />
      </label>

      <div className="group">
        <div className="group-title">Its videos</div>
        <div className="seg full" role="radiogroup" aria-label="Its videos">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={(campaign.format ?? 'talking') === f.value}
              className={(campaign.format ?? 'talking') === f.value ? 'active' : ''}
              onClick={() => setCampaign((c) => ({ ...c, format: f.value }))}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="hint">
          {isReaction(campaign)
            ? 'A clip of you reacting with the headline over it, then a clip of the product. Add them with "Choose the campaign myself" on Videos.'
            : 'You talking to camera: the pauses are cut, and each video is sorted by what you say.'}
        </div>
        {isReaction(campaign) ? (
          <>
            <div className="label">Sound between the two</div>
            <div className="seg full" role="radiogroup" aria-label="Sound between the two">
              {SWITCH_SOUNDS.map((sound) => (
                <button
                  key={sound.value}
                  type="button"
                  role="radio"
                  aria-checked={(campaign.switchSound ?? 'whoosh') === sound.value}
                  className={(campaign.switchSound ?? 'whoosh') === sound.value ? 'active' : ''}
                  onClick={() => setCampaign((c) => ({ ...c, switchSound: sound.value }))}
                >
                  {sound.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="group">
        <div className="group-title">Brand name, as you say it</div>
        <label className="field">
          <input
            type="text"
            value={brandText}
            placeholder="e.g. Vertus"
            autoCapitalize="off"
            aria-label="Brand name, as you say it"
            onChange={(e) => {
              setBrandText(e.target.value)
              setCampaign((c) => ({ ...c, brandWords: parseWordList(e.target.value) }))
            }}
          />
          <span className="hint">
            Brings the logo up when you say it. The speech model is told this name before it listens, and a word that
            sounds like it counts too - so one spelling is enough.
          </span>
        </label>
      </div>

      <div className="group">
        <div className="group-title">Logo</div>
        <input
          ref={logoPicker}
          type="file"
          accept="image/png,image/webp,image/jpeg,image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) setCampaign((c) => ({ ...c, logo: file }))
            e.target.value = ''
          }}
        />
        <div className="row">
          {logoUrl ? <img className="thumb" src={logoUrl} alt="The campaign's logo" /> : <span className="hint">A PNG with a clear background looks best.</span>}
          <div className="actions">
            {campaign.logo ? (
              <button type="button" className="linkbtn" onClick={() => setCampaign((c) => ({ ...c, logo: null }))}>
                Remove
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => logoPicker.current?.click()}>
              {campaign.logo ? 'Change image' : 'Choose image'}
            </button>
          </div>
        </div>
      </div>
    </EditorFrame>
  )
}

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}

// --- An angle -----------------------------------------------------------------

type Part = 'look' | 'pictures' | 'sounds' | 'effects' | 'clips'

/** An angle has a lot to it, so it is in parts, one on screen at a time,
 *  with the preview above them all. Clips - videos joined on before and
 *  after him - only for talking-head campaigns. */
const PARTS: { value: Part; label: string }[] = [
  { value: 'look', label: 'Look' },
  { value: 'pictures', label: 'Pictures' },
  { value: 'sounds', label: 'Sound' },
  { value: 'effects', label: 'Effects' },
  { value: 'clips', label: 'Clips' },
]

export function AngleEditor({
  campaign,
  initial,
  isNew,
  copiedFrom,
  clips: initialClips = {},
  clipList = [],
  onAddClip,
  onSave,
  onCancel,
  onDelete,
}: {
  campaign: Campaign
  initial: Angle
  isNew: boolean
  /** The angle a new one was copied from, to say so. */
  copiedFrom?: string
  /** Its videos before and after, on this phone. */
  clips?: AngleClips
  /** Every clip on this phone. */
  clipList?: ClipInfo[]
  /** Keeps a clip from the phone; absent where clips aren't offered. */
  onAddClip?: (file: File) => Promise<ClipInfo>
  onSave: (angle: Angle, clips: AngleClips) => Promise<void>
  onCancel: () => void
  onDelete?: () => void
}) {
  const [angle, setAngle] = useState<Angle>(initial)
  const [clips, setClips] = useState<AngleClips>(initialClips)
  const [soundWordsText, setSoundWordsText] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.sounds.map((s) => [s.id, s.trigger.kind === 'words' ? s.trigger.words.join(', ') : ''])),
  )
  const [saving, problems, run] = useSaver()
  const [part, setPart] = useState<Part>('look')
  const [pictureError, setPictureError] = useState<string | null>(null)
  const [recognizeText, setRecognizeText] = useState(initial.recognize.join(', '))
  const pictureWords = angle.pictures.flatMap((p) => p.words)
  const picturePicker = useRef<HTMLInputElement>(null)
  const hasLogo = campaign.logo !== null
  const hasBrand = campaign.brandWords.length > 0

  const setHeadline = (fields: Partial<Angle['headline']>) => setAngle((a) => ({ ...a, headline: { ...a.headline, ...fields } }))
  const setLogo = (fields: Partial<Angle['logo']>) => setAngle((a) => ({ ...a, logo: { ...a.logo, ...fields } }))
  const setPicture = (id: string, fields: Partial<PictureCue>) =>
    setAngle((a) => ({ ...a, pictures: a.pictures.map((p) => (p.id === id ? { ...p, ...fields } : p)) }))
  const setSound = (id: string, fields: Partial<AngleSound>) =>
    setAngle((a) => ({ ...a, sounds: a.sounds.map((s) => (s.id === id ? { ...s, ...fields } : s)) }))

  const addSound = () =>
    setAngle((a) => ({
      ...a,
      sounds: [
        ...a.sounds,
        // A whoosh as the video opens is the sound almost every format has.
        // A style, not campaign content, so it may be offered.
        { id: crypto.randomUUID(), source: { kind: 'built-in', name: 'whoosh' }, trigger: { kind: 'start' }, volumeDb: -6 },
      ],
    }))

  const look = videoLook(campaign, angle)
  const listens =
    (hasLogo && angle.logo.show) ||
    angle.effects.brandHit !== 'off' ||
    angle.pictures.length > 0 ||
    angle.bank.use ||
    angle.sounds.some((s) => s.trigger.kind !== 'start')

  return (
    <EditorFrame
      title={isNew ? `New angle for ${campaign.name}` : `${campaign.name} · ${initial.name}`}
      onCancel={onCancel}
      problems={problems}
      saving={saving}
      saveLabel="Save angle"
      onSave={() => void run(angleProblems(campaign, angle), () => onSave(angle, clips))}
      deleteLabel={onDelete ? 'Delete angle' : undefined}
      onDelete={
        onDelete
          ? () => {
              if (window.confirm(`Delete the ${initial.name} angle? Videos already made are not affected.`)) onDelete()
            }
          : undefined
      }
    >
      {copiedFrom ? <div className="hint">Starts as a copy of {copiedFrom} - change what's different.</div> : null}
      {part === 'effects' || part === 'clips' ? null : <LookPreview look={look} compact />}

      <div className="seg parts" role="tablist" aria-label="Parts of the angle">
        {PARTS.filter((p) => p.value !== 'clips' || onAddClip).map((p) => (
          <button
            key={p.value}
            type="button"
            role="tab"
            aria-selected={part === p.value}
            className={part === p.value ? 'active' : ''}
            onClick={() => setPart(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {part === 'look' ? (
        <>
          <label className="field">
            <span className="label">Angle name</span>
            <input
              type="text"
              value={angle.name}
              placeholder="e.g. Sydney Sweeney"
              onChange={(e) => setAngle((a) => ({ ...a, name: e.target.value }))}
            />
          </label>

          {!campaign.general ? (
            <label className="field">
              <span className="label">Recognise it by</span>
              <input
                type="text"
                value={recognizeText}
                placeholder={
                  pictureWords.length > 0 ? `Same as its pictures: ${pictureWords.join(', ')}` : 'e.g. Sydney Sweeney'
                }
                autoCapitalize="off"
                onChange={(e) => {
                  setRecognizeText(e.target.value)
                  setAngle((a) => ({ ...a, recognize: parseWordList(e.target.value) }))
                }}
              />
              <span className="hint">Say these in a video and Sort the day puts it here.</span>
            </label>
          ) : null}

          <div className="group">
            <div className="group-title">Headline</div>
            <label className="field">
              <span className="hint">Shown for the first few seconds. Empty for none.</span>
              {!angle.headline.fromFirstLine ? (
                <textarea
                  rows={2}
                  maxLength={LIMITS.headlineChars}
                  value={angle.headline.text}
                  placeholder="Your headline, exactly as it should read"
                  onChange={(e) => setHeadline({ text: e.target.value })}
                />
              ) : null}
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={Boolean(angle.headline.fromFirstLine)}
                onChange={(e) => setHeadline({ fromFirstLine: e.target.checked })}
              />
              <span>
                <span className="label">Make it from my first line</span>
                <span className="hint" style={{ display: 'block' }}>
                  Each video's headline is the first thing you say in it, up to eight words. You see it and can change it
                  before the video is made.
                </span>
              </span>
            </label>
            <Choice label="Where" options={POSITIONS} value={angle.headline.position} onChange={(position) => setHeadline({ position })} />
            <Choice label="Style" options={STYLES} value={angle.headline.style} onChange={(style) => setHeadline({ style })} />
            <Choice label="Size" options={SIZES} value={angle.headline.size} onChange={(size) => setHeadline({ size })} />
            <Slider
              label="On screen for"
              value={angle.headline.seconds}
              {...LIMITS.headlineSeconds}
              step={0.5}
              format={(v) => `${v.toFixed(1)} s`}
              onChange={(seconds) => setHeadline({ seconds })}
            />
          </div>

          <div className="group">
            <div className="group-title">Logo</div>
            {!hasLogo ? (
              <div className="hint">This campaign has no logo. Add one in the campaign's own settings.</div>
            ) : (
              <>
                <label className="toggle">
                  <input type="checkbox" checked={angle.logo.show} onChange={(e) => setLogo({ show: e.target.checked })} />
                  <span>
                    <span className="label">Show the logo when I say {hasBrand ? `"${campaign.brandWords[0]}"` : 'the brand'}</span>
                  </span>
                </label>
                {angle.logo.show ? (
                  <>
                    <label className="field">
                      <span className="label">Where</span>
                      <select value={angle.logo.position} onChange={(e) => setLogo({ position: e.target.value as LogoPosition })}>
                        {LOGO_POSITIONS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Slider
                      label="Width"
                      value={angle.logo.widthPct}
                      {...LIMITS.logoWidthPct}
                      step={1}
                      format={(v) => `${v}%`}
                      onChange={(widthPct) => setLogo({ widthPct })}
                    />
                    <Slider
                      label="On screen for"
                      value={angle.logo.seconds}
                      {...LIMITS.logoSeconds}
                      step={0.5}
                      format={(v) => `${v.toFixed(1)} s`}
                      onChange={(seconds) => setLogo({ seconds })}
                    />
                  </>
                ) : null}
              </>
            )}
          </div>

          {listens ? (
            <div className="group">
              <Choice
                label="When a word is said more than once"
                options={[
                  { value: 'first', label: 'First time only' },
                  { value: 'every', label: 'Every time' },
                ]}
                value={angle.mentions}
                onChange={(mentions) => setAngle((a) => ({ ...a, mentions }))}
              />
            </div>
          ) : null}
        </>
      ) : part === 'pictures' ? (
        <>
          <div className="group">
            <div className="group-title">Pictures on words</div>
            <div className="hint">
              A picture that comes up when you say something - her photo when you say "Sydney Sweeney".
            </div>
            <input
              ref={picturePicker}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setPictureError(null)
                shrinkPicture(file)
                  .then((image) => setAngle((a) => ({ ...a, pictures: [...a.pictures, blankPicture(crypto.randomUUID(), image)] })))
                  .catch(() => setPictureError("That picture couldn't be opened. Try another."))
              }}
            />
            {angle.pictures.map((picture, i) => (
              <PictureRow
                key={picture.id}
                index={i}
                picture={picture}
                onChange={(fields) => setPicture(picture.id, fields)}
                onRemove={() => setAngle((a) => ({ ...a, pictures: a.pictures.filter((p) => p.id !== picture.id) }))}
              />
            ))}
            {angle.pictures.length < LIMITS.pictures ? (
              <div>
                <button type="button" className="btn" onClick={() => picturePicker.current?.click()}>
                  Add a picture
                </button>
              </div>
            ) : null}
            {pictureError ? <div className="error">{pictureError}</div> : null}
          </div>

          <div className="group">
            <div className="group-title">Picture bank</div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={angle.bank.use}
                onChange={(e) => setAngle((a) => ({ ...a, bank: { ...a.bank, use: e.target.checked } }))}
              />
              <span>
                <span className="label">Use the picture bank</span>
                <span className="hint" style={{ display: 'block' }}>
                  Any bank picture whose words you say comes up - one at a time, in this spot.
                </span>
              </span>
            </label>
            {angle.bank.use ? (
              <>
                <label className="field">
                  <span className="label">Where</span>
                  <select
                    value={angle.bank.position}
                    onChange={(e) => setAngle((a) => ({ ...a, bank: { ...a.bank, position: e.target.value as LogoPosition } }))}
                  >
                    {[{ value: 'top' as LogoPosition, label: 'Top' }, ...LOGO_POSITIONS].map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Slider
                  label="Width"
                  value={angle.bank.widthPct}
                  {...LIMITS.pictureWidthPct}
                  step={1}
                  format={(v) => `${v}%`}
                  onChange={(widthPct) => setAngle((a) => ({ ...a, bank: { ...a.bank, widthPct } }))}
                />
                <Slider
                  label="On screen for"
                  value={angle.bank.seconds}
                  {...LIMITS.pictureSeconds}
                  step={0.5}
                  format={(v) => `${v.toFixed(1)} s`}
                  onChange={(seconds) => setAngle((a) => ({ ...a, bank: { ...a.bank, seconds } }))}
                />
              </>
            ) : null}
          </div>
        </>
      ) : part === 'sounds' ? (
        <>
          <MusicRow music={angle.music ?? null} onChange={(music) => setAngle((a) => ({ ...a, music }))} />
          <div className="group">
            <div className="group-title">Sounds</div>
            {angle.sounds.length === 0 ? <div className="hint">No sounds. Whooshes, dings and pops go here.</div> : null}
            {angle.sounds.map((sound, i) => (
              <SoundRow
                key={sound.id}
                index={i}
                sound={sound}
                hasBrand={hasBrand}
                wordsText={soundWordsText[sound.id] ?? ''}
                onWordsText={(text) => {
                  setSoundWordsText((t) => ({ ...t, [sound.id]: text }))
                  setSound(sound.id, { trigger: { kind: 'words', words: parseWordList(text) } })
                }}
                onChange={(fields) => setSound(sound.id, fields)}
                onRemove={() => setAngle((a) => ({ ...a, sounds: a.sounds.filter((s) => s.id !== sound.id) }))}
              />
            ))}
            {angle.sounds.length < LIMITS.sounds ? (
              <div>
                <button type="button" className="btn" onClick={addSound}>
                  Add a sound
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : part === 'clips' && onAddClip ? (
        <>
          <div className="hint">
            Kept on this phone only - your friend's phone doesn't get them. Each video can change them before it's made.
          </div>
          {CLIP_PLACES.map((place) => (
            <ClipRow
              key={place}
              place={place}
              clipId={clips[place]}
              all={clipList}
              onChange={(id) => setClips((c) => ({ ...c, [place]: id ?? undefined }))}
              onAdd={onAddClip}
            />
          ))}
        </>
      ) : (
        <EffectsSection look={look} hasBrand={hasBrand} onChange={(effects) => setAngle((a) => ({ ...a, effects }))} />
      )}
    </EditorFrame>
  )
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="row">
      <span className="label">{label}</span>
      <div className="seg">
        {options.map((o) => (
          <button key={o.value} type="button" className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{format(value)}</output>
    </label>
  )
}

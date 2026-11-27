// The picture bank: pictures kept in the cutter for every campaign, each with
// the words that bring it up - a Claude logo on "Claude", ChatGPT's on
// "ChatGPT, chat GPT". Any angle can use the bank; the General angle does
// from the start.
//
// Pictures are added from his phone, several at once, and brought down to
// video size as they come in. Changes save as he makes them.

import { useEffect, useMemo, useRef, useState } from 'react'

import { squash } from './keywords'
import { PICTURE_SPOTS, parseWordList, type BankPicture, type LogoPosition } from './look'
import { shrinkPicture } from './PictureRow'
import { deleteBankPicture, saveBankPicture } from './store'

export function BankView({
  bank: all,
  onChange: onAll,
  campaigns = [],
}: {
  /** Every picture: the shared bank's and each campaign's own (campaignBank.ts). */
  bank: BankPicture[]
  onChange: (bank: BankPicture[]) => void
  /** The campaigns a picture can be moved to. */
  campaigns?: readonly { id: string; name: string }[]
}) {
  // The shared bank is this screen's list; a campaign's own pictures are on
  // its page - except any still without a name, which wait on top here.
  const bank = all.filter((p) => !p.campaignId)
  const onChange = (shared: BankPicture[]) => onAll([...shared, ...all.filter((p) => p.campaignId)])
  const unnamed = all.filter((p) => p.words.length === 0)
  const updateAny = (id: string, fields: Partial<BankPicture>) => onAll(all.map((p) => (p.id === id ? { ...p, ...fields } : p)))
  const removeAny = (id: string) => {
    void deleteBankPicture(id)
    onAll(all.filter((p) => p.id !== id))
  }
  const picker = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    setAdding(files.length)
    const added: BankPicture[] = []
    let failed = 0
    for (const file of Array.from(files)) {
      try {
        const picture: BankPicture = {
          id: crypto.randomUUID(),
          image: await shrinkPicture(file),
          // Words are his to set, beside each picture.
          words: [],
          addedAt: Date.now() + added.length,
        }
        await saveBankPicture(picture)
        added.push(picture)
      } catch {
        failed++
      }
      setAdding((n) => n - 1)
    }
    onChange([...bank, ...added])
    if (failed > 0) setError(`${failed} picture${failed === 1 ? '' : 's'} couldn't be opened.`)
  }

  const update = (id: string, fields: Partial<BankPicture>) =>
    onChange(bank.map((p) => (p.id === id ? { ...p, ...fields } : p)))

  const remove = (id: string) => {
    void deleteBankPicture(id)
    onChange(bank.filter((p) => p.id !== id))
  }

  const shown = useMemo(() => {
    const key = squash(filter)
    return key ? bank.filter((p) => p.words.some((w) => squash(w).includes(key))) : bank
  }, [bank, filter])

  return (
    <section className="screen">
      <div className="screen-head">
        <h2>Pictures</h2>
        <button type="button" className="btn small primary" disabled={adding > 0} onClick={() => picker.current?.click()}>
          {adding > 0 ? `Adding ${adding}…` : 'Add pictures'}
        </button>
      </div>
      <p className="lede tip">
        Each comes up when you say its words - a Claude logo on "Claude". Used by angles that use the bank, like
        General.
      </p>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void add(e.target.files)
          e.target.value = ''
        }}
      />
      {unnamed.length > 0 ? (
        <div className="group name-these">
          <div className="group-title warn-text">
            Name these <span className="bank-count">{unnamed.length}</span>
          </div>
          <p className="hint">
            Pictures you put on videos from your phone are kept here. Give each a name - it pops up when you say it - or put it in a campaign&rsquo;s own bank.
          </p>
          <div className="bank">
            {unnamed.map((picture) => (
              <BankRow key={picture.id} picture={picture} campaigns={campaigns} onChange={(fields) => updateAny(picture.id, fields)} onRemove={() => removeAny(picture.id)} />
            ))}
          </div>
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}
      {bank.length > 6 ? (
        <input
          type="search"
          className="find"
          value={filter}
          placeholder="Find by word"
          aria-label="Find by word"
          autoCapitalize="off"
          onChange={(e) => setFilter(e.target.value)}
        />
      ) : null}
      {bank.length === 0 ? <p className="empty">No pictures yet. Save the logos you use to your phone, then add them here.</p> : null}
      <div className="bank">
        {shown
          .filter((p) => p.words.length > 0)
          .map((picture) => (
            <BankRow key={picture.id} picture={picture} campaigns={campaigns} onChange={(fields) => update(picture.id, fields)} onRemove={() => remove(picture.id)} />
          ))}
      </div>
    </section>
  )
}

export function BankRow({
  picture,
  onChange,
  onRemove,
  campaigns,
}: {
  /** With campaigns: which bank it belongs to, the shared one or a campaign's. */
  campaigns?: readonly { id: string; name: string }[]
  picture: BankPicture
  onChange: (fields: Partial<BankPicture>) => void
  onRemove: () => void
}) {
  const [text, setText] = useState(picture.words.join(', '))
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const next = URL.createObjectURL(picture.image)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [picture.image])

  const save = () => {
    const words = parseWordList(text)
    const next = { ...picture, words }
    onChange({ words })
    void saveBankPicture(next)
  }

  return (
    <div className="bank-row">
      {url ? <img className="thumb" src={url} alt={picture.words[0] ?? 'Bank picture'} /> : <span className="thumb" />}
      <input
        type="text"
        value={text}
        placeholder="Its name - it pops up when you say it"
        autoCapitalize="off"
        aria-label="Words that bring it up"
        className={picture.words.length === 0 ? 'needs' : ''}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
      />
      {/* Its own spot, or the campaign's (Picture bank -> Where). */}
      <select
        value={picture.position ?? ''}
        aria-label="Where it comes up"
        onChange={(e) => {
          const position = (e.target.value || undefined) as LogoPosition | undefined
          const { position: _old, ...rest } = picture
          void _old
          const next: BankPicture = position ? { ...rest, position } : rest
          onChange({ position })
          void saveBankPicture(next)
        }}
      >
        <option value="">Campaign&rsquo;s spot</option>
        {[{ value: 'top' as LogoPosition, label: 'Top' }, ...PICTURE_SPOTS].map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {campaigns && campaigns.length > 0 ? (
        <select
          value={picture.campaignId ?? ''}
          aria-label="Which bank it is in"
          onChange={(e) => {
            const campaignId = e.target.value || undefined
            const { campaignId: _old, ...rest } = picture
            void _old
            const next: BankPicture = campaignId ? { ...rest, campaignId } : rest
            onChange({ campaignId })
            void saveBankPicture(next)
          }}
        >
          <option value="">Every campaign</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}&rsquo;s own
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        className="linkbtn"
        aria-label="Remove this picture"
        onClick={() => {
          if (window.confirm('Take this picture out of the bank? Videos already made keep it.')) onRemove()
        }}
      >
        Remove
      </button>
    </div>
  )
}

// The picture bank: pictures kept in the cutter for every campaign, each with
// the words that bring it up - a Claude logo on "Claude", ChatGPT's on
// "ChatGPT, chat GPT". Any angle can use the bank; the General angle does
// from the start.
//
// Pictures are added from his phone, several at once, and brought down to
// video size as they come in. Changes save as he makes them.

import { useEffect, useMemo, useRef, useState } from 'react'

import { squash } from './keywords'
import { parseWordList, type BankPicture } from './look'
import { shrinkPicture } from './PictureRow'
import { deleteBankPicture, saveBankPicture } from './store'

export function BankView({ bank, onChange }: { bank: BankPicture[]; onChange: (bank: BankPicture[]) => void }) {
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
  const missingWords = bank.filter((p) => p.words.length === 0).length

  return (
    <section className="screen">
      <div className="screen-head">
        <h1>Pictures</h1>
        <button type="button" className="btn small primary" disabled={adding > 0} onClick={() => picker.current?.click()}>
          {adding > 0 ? `Adding ${adding}…` : 'Add pictures'}
        </button>
      </div>
      <p className="lede">
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
      {missingWords > 0 ? (
        <p className="hint warn-text">
          {missingWords} picture{missingWords === 1 ? ' needs' : 's need'} words before it can come up.
        </p>
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
        {shown.map((picture) => (
          <BankRow key={picture.id} picture={picture} onChange={(fields) => update(picture.id, fields)} onRemove={() => remove(picture.id)} />
        ))}
      </div>
    </section>
  )
}

function BankRow({
  picture,
  onChange,
  onRemove,
}: {
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
        placeholder="Words that bring it up"
        autoCapitalize="off"
        aria-label="Words that bring it up"
        className={picture.words.length === 0 ? 'needs' : ''}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
      />
      <button type="button" className="linkbtn" aria-label="Remove this picture" onClick={onRemove}>
        Remove
      </button>
    </div>
  )
}

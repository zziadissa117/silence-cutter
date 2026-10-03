// Shown when a video he dropped in is not 9:16: cut it like the others, or
// only make it 9:16 and leave every moment in? Videos that are already 9:16
// never get here - those are always cut.

export function WideAsk({
  names,
  total,
  onCut,
  onOnly916,
  onCancel,
}: {
  /** The not-9:16 files. */
  names: string[]
  /** All the files dropped in, so he can see how many are not asked about. */
  total: number
  onCut: () => void
  onOnly916: () => void
  onCancel: () => void
}) {
  const one = names.length === 1
  return (
    <section className="screen" aria-label="Not 9:16">
      <h1>{one ? "This video isn't 9:16" : `${names.length} videos aren't 9:16`}</h1>
      <ul className="hint">
        {names.slice(0, 6).map((n) => (
          <li key={n}>{n}</li>
        ))}
        {names.length > 6 ? <li>and {names.length - 6} more</li> : null}
      </ul>
      <p className="lede">
        Cut {one ? 'it' : 'them'} like the others, or only make {one ? 'it' : 'them'} 9:16 and leave every moment in?
        {total > names.length ? ' The ones that are already 9:16 are cut as usual.' : ''}
      </p>
      <button type="button" className="btn primary wide" onClick={onCut}>
        Cut {one ? 'it' : 'them'} and make 9:16
      </button>
      <button type="button" className="btn wide" onClick={onOnly916}>
        Only make 9:16 - don't cut
      </button>
      <button type="button" className="linkbtn" onClick={onCancel}>
        Don't add {one ? 'it' : 'them'}
      </button>
    </section>
  )
}

// A campaign's posting: where its videos go and when (his own accounts and
// times, in his own Postiz), and the brand's rules (shared with his
// friend): who approves a post, the reminder to submit it, and how the
// caption is written.

import { useState } from 'react'

import { EditorFrame, useSaver } from './Editors'
import { NO_POSTING, type Campaign, type CampaignPosting } from './look'
import {
  PostingError,
  accountLabel,
  accountsBehind,
  placeFor,
  refreshAccounts,
  timeLabel,
  type CampaignPlace,
  type LocalPosting,
} from './posting'

const APPROVALS: { value: CampaignPosting['approval']; label: string; hint: string }[] = [
  { value: 'me', label: 'I approve', hint: 'Each post waits on the Posts screen for you to approve it.' },
  { value: 'direct', label: 'Straight away', hint: "Scheduled as soon as it's ready - nothing to approve." },
  {
    value: 'brand',
    label: 'Brand approves',
    hint: "Waits until you tap Brand approved. If its time has gone by then, it takes the next time today, or posts at once.",
  },
]

const CAPTIONS: { value: CampaignPosting['caption']; label: string }[] = [
  { value: 'claude', label: 'Claude writes it' },
  { value: 'paste', label: 'I paste it' },
]

export function PostingEditor({
  campaign,
  local,
  onSave,
  onCancel,
  onSetUp,
}: {
  campaign: Campaign
  local: LocalPosting | null
  /** Saves the shared rules with the campaign, and this person's accounts
   *  and times with their profile. `catchUp` names newly picked accounts the
   *  videos already made should also go to - empty when he declined, or
   *  there is none. */
  onSave: (posting: CampaignPosting, place: CampaignPlace | null, catchUp: string[]) => Promise<void>
  onCancel: () => void
  onSetUp: () => void
}) {
  const [posting, setPosting] = useState<CampaignPosting>({ ...NO_POSTING, ...campaign.posting })
  const [hashtagText, setHashtagText] = useState((campaign.posting?.hashtags ?? []).join(' '))
  const [place, setPlace] = useState<CampaignPlace>(() => placeFor(local?.profile, campaign.id))
  const [accounts, setAccounts] = useState(local?.profile.accounts ?? [])
  // The videos already made were fixed to the accounts the campaign had when
  // they were prepared, so an account picked later misses them. When any
  // picked account is one that waiting or scheduled videos do not go to, he is
  // asked whether they should. On by default: leaving them out is the bug this
  // answers, and it can be unticked. Worked out from the last posts the phone
  // saw, so it also offers again after a save that could not reach the server.
  const [catchUpOn, setCatchUpOn] = useState(true)
  const behind = accountsBehind(campaign.id, place.accounts)
  const [newTime, setNewTime] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshProblem, setRefreshProblem] = useState<string | null>(null)
  const [saving, problems, run] = useSaver()

  const change = (fields: Partial<CampaignPosting>) => setPosting((p) => ({ ...p, ...fields }))
  const toggleAccount = (id: string) =>
    setPlace((p) => ({ ...p, accounts: p.accounts.includes(id) ? p.accounts.filter((a) => a !== id) : [...p.accounts, id] }))
  const addTime = () => {
    if (!/^\d{2}:\d{2}$/.test(newTime)) return
    setPlace((p) => ({ ...p, times: [...new Set([...p.times, newTime])].sort() }))
    setNewTime('')
  }

  const approval = APPROVALS.find((a) => a.value === posting.approval) ?? APPROVALS[0]

  return (
    <EditorFrame
      title={`Posting · ${campaign.name}`}
      onCancel={onCancel}
      problems={problems}
      saving={saving}
      saveLabel="Save posting"
      onSave={() =>
        void run([], async () => {
          const hashtags = hashtagText
            .split(/[\s,]+/)
            .map((t) => t.replace(/^#+/, ''))
            .filter(Boolean)
            .map((t) => `#${t}`)
          try {
            await onSave({ ...posting, rules: posting.rules.trim(), hashtags }, local ? place : null, catchUpOn ? behind.accounts : [])
          } catch (error) {
            throw new Error(error instanceof PostingError ? error.message : String(error))
          }
        })
      }
    >
      <div className="hint">Your accounts and times are yours. How it's approved and captioned is shared with your friend.</div>

      <div className="group">
        <div className="group-title">Your accounts</div>
        {local ? (
          <>
            {accounts.length === 0 ? <div className="hint">No accounts in your Postiz yet.</div> : null}
            {accounts.map((account) => (
              <label key={account.id} className="toggle">
                <input type="checkbox" checked={place.accounts.includes(account.id)} onChange={() => toggleAccount(account.id)} />
                <span>
                  <span className="label">{accountLabel(account)}</span>
                  {account.disabled ? (
                    <span className="hint warn-text" style={{ display: 'block' }}>
                      Disconnected in Postiz
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
            <div>
              <button
                type="button"
                className="linkbtn"
                disabled={refreshing}
                onClick={() => {
                  setRefreshing(true)
                  setRefreshProblem(null)
                  refreshAccounts()
                    .then((profile) => setAccounts(profile.accounts))
                    .catch((error: unknown) => setRefreshProblem(error instanceof Error ? error.message : String(error)))
                    .finally(() => setRefreshing(false))
                }}
              >
                {refreshing ? 'Looking…' : 'Added an account in Postiz? Look again'}
              </button>
            </div>
            {refreshProblem ? <div className="error">{refreshProblem}</div> : null}
            {behind.videos > 0 ? (
              <label className="toggle">
                <input type="checkbox" checked={catchUpOn} onChange={() => setCatchUpOn((on) => !on)} />
                <span>
                  <span className="label">Add to videos already made</span>
                  <span className="hint" style={{ display: 'block' }}>
                    {behind.videos} video{behind.videos === 1 ? '' : 's'} already made for {campaign.name}{' '}
                    {behind.videos === 1 ? "doesn't" : "don't"} go to{' '}
                    {behind.accounts.map((id) => accounts.find((a) => a.id === id)).filter((a) => a !== undefined).map(accountLabel).join(', ')}. Tick to add{' '}
                    {behind.accounts.length === 1 ? 'it' : 'them'}: the accounts they already go to are not touched, so nothing posts twice. Ones that
                    have gone out stay as they were.
                  </span>
                </span>
              </label>
            ) : null}
          </>
        ) : (
          <>
            <div className="hint">Connect your Postiz first to pick the accounts this campaign posts to.</div>
            <div>
              <button type="button" className="btn" onClick={onSetUp}>
                Set up posting
              </button>
            </div>
          </>
        )}
      </div>

      {local ? (
        <div className="group">
          <div className="group-title">Your times</div>
          {place.times.length > 0 ? (
            <div className="seg chips">
              {place.times.map((time) => (
                <button
                  key={time}
                  type="button"
                  className="active"
                  aria-label={`Remove ${timeLabel(time)}`}
                  onClick={() => setPlace((p) => ({ ...p, times: p.times.filter((t) => t !== time) }))}
                >
                  {timeLabel(time)} ✕
                </button>
              ))}
            </div>
          ) : null}
          <div className="time-add">
            <input type="time" value={newTime} aria-label="A time to post at" onChange={(e) => setNewTime(e.target.value)} />
            <button type="button" className="btn small" disabled={!newTime} onClick={addTime}>
              Add time
            </button>
          </div>
          <div className="hint">
            {place.times.length === 0
              ? "No times: each post goes as soon as it's ready."
              : 'Each video takes the next free time, a few minutes after it.'}
          </div>
        </div>
      ) : null}

      <div className="group">
        <div className="group-title">Before it posts</div>
        <div className="seg full" role="radiogroup" aria-label="Before it posts">
          {APPROVALS.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={posting.approval === a.value}
              className={posting.approval === a.value ? 'active' : ''}
              onClick={() => change({ approval: a.value })}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="hint">{approval.hint}</div>
        <label className="toggle">
          <input type="checkbox" checked={posting.remind} onChange={(e) => change({ remind: e.target.checked })} />
          <span>
            <span className="label">Remind me to submit it when it goes live</span>
            <span className="hint" style={{ display: 'block' }}>
              A notification the moment it's posted - for a brand that pays only if you submit within 2 hours.
            </span>
          </span>
        </label>
      </div>

      <div className="group">
        <div className="group-title">Repost</div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={posting.repost?.on === true}
            onChange={(e) => change({ repost: { on: e.target.checked, afterDays: posting.repost?.afterDays ?? 7 } })}
          />
          <span>
            <span className="label">Post each video again later</span>
            <span className="hint" style={{ display: 'block' }}>
              The same video goes out a second time with a different caption. Off unless you turn it on.
            </span>
          </span>
        </label>
        {posting.repost?.on ? (
          <label className="field">
            <span className="label">Repost after</span>
            <select
              value={posting.repost.afterDays}
              onChange={(e) => change({ repost: { on: true, afterDays: Number(e.target.value) } })}
            >
              {[3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="group">
        <div className="group-title">Caption</div>
        <div className="seg full" role="radiogroup" aria-label="Caption">
          {CAPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={posting.caption === c.value}
              className={posting.caption === c.value ? 'active' : ''}
              onClick={() => change({ caption: c.value })}
            >
              {c.label}
            </button>
          ))}
        </div>
        {posting.caption === 'claude' ? (
          <>
            <label className="field">
              <span className="label">The brand's caption rules</span>
              <textarea
                rows={4}
                value={posting.rules}
                placeholder={'e.g. Always end with a variation of: Comment "CLIP" and I\'ll send it over to you'}
                onChange={(e) => change({ rules: e.target.value })}
              />
              <span className="hint">
                Claude writes each caption from what you say in the video, with hashtags for the niche. Never "ad" or
                "paid partnership".
              </span>
            </label>
            <label className="field">
              <span className="label">Hashtags every post carries</span>
              <input
                type="text"
                value={hashtagText}
                placeholder="e.g. #pumpfunpartner"
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => setHashtagText(e.target.value)}
              />
            </label>
          </>
        ) : (
          <div className="hint">The Posts screen asks you to paste it - a brand's tracking caption - before the post can go.</div>
        )}
      </div>
    </EditorFrame>
  )
}

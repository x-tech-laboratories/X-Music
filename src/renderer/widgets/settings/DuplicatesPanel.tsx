import { useState } from 'react'
import { ipc } from '../../lib/ipc'
import { cx } from '../../lib/cx'
import type { DuplicateGroup, DuplicateReason, MergeResult } from '@shared/ipc'
import { MergeView } from '../MergeView'
import { library } from '../../stores/library'
import { use_pref } from '../../lib/prefs'
import { isNumberIn } from '@shared/prefs'
import s from './DuplicatesPanel.module.css'

const REASONS: { id: DuplicateReason; label: string; hint: string }[] = [
  { id: 'audio_hash', label: 'Identical audio', hint: 'Byte-identical content' },
  { id: 'mb_recording_id', label: 'MusicBrainz id', hint: 'Same tagged recording' },
  { id: 'tags', label: 'Matching tags', hint: 'Same artist, title and album' },
  { id: 'fuzzy', label: 'Similar', hint: 'Same artist and title, similar length — noisy, needs review' }
]

const MAX_SHOWN = 200

const mmss = (ms: number | null): string => {
  if (ms === null) return '—'
  const sec = Math.round(ms / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function DuplicatesPanel() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<number[] | null>(null)
  const [tolerance, setTolerance] = use_pref('duplicates.toleranceSeconds', 3, isNumberIn(0, 60))

  // Fuzzy is off by default: on a real library it proposes far more than anyone can review.
  const [enabled, setEnabled] = use_pref<Record<DuplicateReason, boolean>>('duplicates.reasons', {
    audio_hash: true, mb_recording_id: true, tags: true, fuzzy: false
  })

  function toggleReason(id: DuplicateReason): void {
    setEnabled({ ...enabled, [id]: !enabled[id] })
  }

  // Per-group outcome, so a quick merge reports in place rather than reshuffling the list.
  const [done, setDone] = useState<Record<string, MergeResult>>({})
  const [working, setWorking] = useState<Record<string, boolean>>({})
  const [groupError, setGroupError] = useState<Record<string, string>>({})

  /**
   * Merge with the defaults the preview already proposes — richest source survives, multi-value
   * fields union, statistics combine. Safe to offer because it is undoable, and the undo control
   * replaces the button rather than being hidden behind a history view.
   */
  async function quickMerge(g: DuplicateGroup): Promise<void> {
    setWorking((w) => ({ ...w, [g.key]: true }))
    setGroupError((e) => ({ ...e, [g.key]: '' }))
    try {
      const ids = g.members.map((m) => m.trackId)
      const preview = await ipc('tracks:mergePreview', ids)
      const result = await ipc('tracks:merge', { ids, survivor: preview.survivor })
      setDone((d) => ({ ...d, [g.key]: result }))
      await library.refresh()
    } catch (err) {
      setGroupError((e) => ({ ...e, [g.key]: (err as Error).message }))
    } finally {
      setWorking((w) => ({ ...w, [g.key]: false }))
    }
  }

  async function undoGroup(key: string): Promise<void> {
    const r = done[key]
    if (!r) return
    setWorking((w) => ({ ...w, [key]: true }))
    try {
      await ipc('tracks:unmerge', r.batchId)
      setDone((d) => {
        const next = { ...d }
        delete next[key]
        return next
      })
      await library.refresh()
    } catch (err) {
      setGroupError((e) => ({ ...e, [key]: (err as Error).message }))
    } finally {
      setWorking((w) => ({ ...w, [key]: false }))
    }
  }

  async function find(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      setGroups(await ipc('tracks:duplicates', {
        reasons: REASONS.map((r) => r.id).filter((r) => enabled[r]),
        lengthToleranceMs: tolerance * 1000,
        limit: MAX_SHOWN
      }))
      setRan(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const total = groups.reduce((n, g) => n + g.members.length, 0)

  return (
    <>
      <section className={s.dupes}>
        <header className={s.header}>
          <h2 className={s.heading}>Find duplicates</h2>
          <p className={s.lead}>
            X-Music never merges automatically. This proposes groups with its reasoning; you decide.
          </p>
        </header>

        <div className={s.opts}>
          {REASONS.map((r) => (
            <label key={r.id} className={s.label} title={r.hint}>
              <input type="checkbox" checked={enabled[r.id]} onChange={() => toggleReason(r.id)} />
              {r.label}
              {r.id === 'fuzzy' && <span className={s.warnish}>noisy</span>}
            </label>
          ))}
          <label className={cx(s.label, s.tol)}>
            Length tolerance
            <input type="number" min="0" max="60" value={tolerance}
                   onChange={(e) => {
                     const v = (e.currentTarget as HTMLInputElement).value
                     if (v !== '') setTolerance(+v)
                   }} /> s
          </label>
        </div>

        <div className={s.actions}>
          <button className={cx(s.button, s.primary)} onClick={find} disabled={busy}>
            {busy ? 'Searching…' : 'Find duplicates'}
          </button>
          {ran && !busy && (
            <span className={s.hint}>
              {groups.length} group{groups.length === 1 ? '' : 's'} · {total} tracks
              {groups.length >= MAX_SHOWN && <> (showing the first {MAX_SHOWN})</>}
            </span>
          )}
        </div>

        {error && <p className={cx(s.note, s.err)}>{error}</p>}

        {ran && groups.length === 0 && !busy && (
          <p className={s.note}>No duplicates found with these settings.</p>
        )}

        <div className={s.groups}>
          {groups.map((g) => (
            <article key={g.key} className={cx(s.group, s[g.confidence], done[g.key] && s.merged)}>
              <div className={s.ghead}>
                <span className={cx(s.conf, s[g.confidence])}>{g.confidence}</span>
                <span className={s.why}>
                  {done[g.key] ? (
                    `Merged into one track holding ${done[g.key]!.mediaMoved + 1} files.`
                  ) : groupError[g.key] ? (
                    <span className={s.gerr}>{groupError[g.key]}</span>
                  ) : (
                    g.explanation
                  )}
                </span>

                {done[g.key] ? (
                  <button className={cx(s.button, s.undo)} disabled={working[g.key]} onClick={() => undoGroup(g.key)}>
                    {working[g.key] ? 'Undoing…' : 'Undo'}
                  </button>
                ) : (
                  <div className={s.gactions}>
                    <button
                      className={cx(s.button, s.quick)}
                      disabled={working[g.key]}
                      title={'Merge now using the defaults: richest source survives, genres and labels are\ncombined, plays and ratings are combined. Undoable.'}
                      onClick={() => quickMerge(g)}
                    >{working[g.key] ? 'Merging…' : 'Quick merge'}</button>
                    <button className={cx(s.button, s.merge)} onClick={() => setMerging(g.members.map((m) => m.trackId))}>
                      Review
                    </button>
                  </div>
                )}
              </div>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th className={s.th}>Title</th><th className={s.th}>Artist</th><th className={s.th}>Album</th>
                    <th className={cx(s.th, s.num)}>Length</th><th className={cx(s.th, s.num)}>Rating</th>
                    <th className={cx(s.th, s.num)}>Plays</th><th className={cx(s.th, s.num)}>Files</th><th className={s.th}>Formats</th>
                  </tr>
                </thead>
                <tbody className={s.tbody}>
                  {g.members.map((m) => (
                    <tr key={m.trackId}>
                      <td className={s.td}>{m.title ?? '—'}</td>
                      <td className={s.td}>{m.artist ?? '—'}</td>
                      <td className={s.td}>{m.album ?? '—'}</td>
                      <td className={cx(s.td, s.num)}>{mmss(m.lengthMs)}</td>
                      <td className={cx(s.td, s.num)}>{m.rating ?? '—'}</td>
                      <td className={cx(s.td, s.num)}>{m.playCount}</td>
                      <td className={cx(s.td, s.num)}>{m.mediaCount}</td>
                      <td className={s.td}>{m.codecs ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ))}
        </div>
      </section>

      {merging && (
        <MergeView
          ids={merging}
          onclose={(merged) => {
            setMerging(null)
            if (merged) {
              void library.refresh()
              void find()
            }
          }}
        />
      )}
    </>
  )
}

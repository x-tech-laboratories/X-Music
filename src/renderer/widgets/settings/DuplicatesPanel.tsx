import { useState } from 'react'
import { ipc } from '../../lib/ipc'
import { cx } from '@x-tech-laboratories/x-libs/web/dom'
import type { DuplicateGroup, DuplicateReason, MergeResult } from '@shared/ipc'
import { MergeView } from '../MergeView'
import { library } from '../../stores/library'
import { Badge, type Tone } from '@x-tech-laboratories/x-libs/web/react/badges'
import { PageHeading } from '@x-tech-laboratories/x-libs/web/react/layout'
import { use_pref } from '@x-tech-laboratories/x-libs/web/react/prefs'
import { is_number_in } from '@x-tech-laboratories/x-libs/web/prefs'
import { format_clock } from '@x-tech-laboratories/x-libs/durations'
import s from './DuplicatesPanel.module.css'

const REASONS: { id: DuplicateReason; label: string; hint: string }[] = [
  { id: 'audio_hash', label: 'Identical audio', hint: 'Byte-identical content' },
  { id: 'mb_recording_id', label: 'MusicBrainz id', hint: 'Same tagged recording' },
  { id: 'tags', label: 'Matching tags', hint: 'Same artist, title and album' },
  { id: 'fuzzy', label: 'Similar', hint: 'Same artist and title, similar length — noisy, needs review' }
]

const MAX_SHOWN = 200

const mmss = (milliseconds: number | null): string => format_clock(milliseconds, '—')

const CONFIDENCE_TONES: Record<DuplicateGroup['confidence'], Tone> = { certain: 'good', likely: 'info', possible: 'warn' }

export function DuplicatesPanel() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<number[] | null>(null)
  const [tolerance, setTolerance] = use_pref('x-music.pref.duplicates.toleranceSeconds', 3, is_number_in(0, 60))

  // Fuzzy is off by default: on a real library it proposes far more than anyone can review.
  const [enabled, setEnabled] = use_pref<Record<DuplicateReason, boolean>>('x-music.pref.duplicates.reasons', {
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
        <PageHeading
          level={2}
          title="Find duplicates"
          subtitle="X-Music never merges automatically. This proposes groups with its reasoning; you decide."
        />

        <div className={s.opts}>
          {REASONS.map((r) => (
            <label key={r.id} className={s.label} title={r.hint}>
              <input type="checkbox" checked={enabled[r.id]} onChange={() => toggleReason(r.id)} />
              {r.label}
              {r.id === 'fuzzy' && <Badge tone="warn">noisy</Badge>}
            </label>
          ))}
          <label className={s.label}>
            Length tolerance
            <input type="number" className="input-xs" min="0" max="60" value={tolerance}
                   onChange={(e) => {
                     const v = (e.currentTarget as HTMLInputElement).value
                     if (v !== '') setTolerance(+v)
                   }} /> s
          </label>
        </div>

        <div className={s.actions}>
          <button className="accent solid" onClick={find} disabled={busy}>
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
                <Badge tone={CONFIDENCE_TONES[g.confidence]}>{g.confidence}</Badge>
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
                  <button disabled={working[g.key]} onClick={() => undoGroup(g.key)}>
                    {working[g.key] ? 'Undoing…' : 'Undo'}
                  </button>
                ) : (
                  <div className={s.gactions}>
                    <button
                      className="accent"
                      disabled={working[g.key]}
                      title={'Merge now using the defaults: richest source survives, genres and labels are\ncombined, plays and ratings are combined. Undoable.'}
                      onClick={() => quickMerge(g)}
                    >{working[g.key] ? 'Merging…' : 'Quick merge'}</button>
                    <button onClick={() => setMerging(g.members.map((m) => m.trackId))}>
                      Review
                    </button>
                  </div>
                )}
              </div>
              <div className="table-wrap"><table>
                <thead>
                  <tr>
                    <th>Title</th><th>Artist</th><th>Album</th>
                    <th className="number">Length</th><th className="number">Rating</th>
                    <th className="number">Plays</th><th className="number">Files</th><th>Formats</th>
                  </tr>
                </thead>
                <tbody>
                  {g.members.map((m) => (
                    <tr key={m.trackId}>
                      <td>{m.title ?? '—'}</td>
                      <td>{m.artist ?? '—'}</td>
                      <td>{m.album ?? '—'}</td>
                      <td className="number">{mmss(m.lengthMs)}</td>
                      <td className="number">{m.rating ?? '—'}</td>
                      <td className="number">{m.playCount}</td>
                      <td className="number">{m.mediaCount}</td>
                      <td>{m.codecs ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
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

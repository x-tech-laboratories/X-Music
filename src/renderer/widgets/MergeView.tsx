// Sources side by side, one column each, one row per field — so a disagreement reads as a diff
// rather than as a list of options. Resolution stays per field, following Thunderbird CardBook.

import { Fragment, useState } from 'react'
import type { MergeResult, Resolution } from '@shared/ipc'
import { Badge } from '@x-tech-laboratories/x-libs/web/react/badges'
import { Tile, Tiles } from '@x-tech-laboratories/x-libs/web/react/layout'
import { Loaded, use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { use_pref } from '@x-tech-laboratories/x-libs/web/react/prefs'
import { is_boolean } from '@x-tech-laboratories/x-libs/web/prefs'
import { ipc } from '../lib/ipc'
import { cx } from '@x-tech-laboratories/x-libs/web/dom'
import { library } from '../stores/library'
import { PageView } from '@x-tech-laboratories/x-libs/web/react/page_view'
import s from './MergeView.module.css'

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

export function MergeView({ ids, onclose }: { ids: number[]; onclose?: (merged: boolean) => void }) {
  const loaded = use_resource(() => ipc('tracks:mergePreview', ids), [])
  const preview = loaded.data
  // The source that survives, the preview's proposal until one is picked.
  const [chosen_survivor, setSurvivor] = useState<number | null>(null)
  const survivor = chosen_survivor ?? preview?.survivor ?? null
  const [choices, setChoices] = useState<Record<string, Resolution>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MergeResult | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [onlyDifferences, setOnlyDifferences] = use_pref('x-music.pref.merge.onlyDifferences', false, is_boolean)

  const sourceIndex = (id: number): number => (preview?.ids.indexOf(id) ?? -1) + 1

  const valueFor = (fieldId: string, from: number): unknown => {
    const f = preview?.fields.find((x) => x.field === fieldId)
    if (!f) return null
    if (!f.conflict) return f.value
    return f.options?.find((o) => o.from === from)?.value ?? null
  }

  /** What the survivor ends up with, given the current choices. */
  function resultFor(fieldId: string): unknown {
    const f = preview?.fields.find((x) => x.field === fieldId)
    if (!f) return null
    if (!f.conflict) return f.value

    const res = choices[fieldId]
    if (res?.kind === 'value') return valueFor(fieldId, res.from)
    if (f.multi) return f.union
    return valueFor(fieldId, survivor ?? preview!.ids[0]!)
  }

  const isChosen = (fieldId: string, from: number): boolean => {
    const f = preview?.fields.find((x) => x.field === fieldId)
    if (!f?.conflict) return false
    const res = choices[fieldId]
    if (res?.kind === 'value') return res.from === from
    return !f.multi && from === survivor
  }

  const unionChosen = (fieldId: string): boolean => {
    const f = preview?.fields.find((x) => x.field === fieldId)
    if (!f?.multi || !f.conflict) return false
    const res = choices[fieldId]
    return !res || res.kind === 'union'
  }

  function pick(fieldId: string, from: number): void {
    setChoices({ ...choices, [fieldId]: { kind: 'value', from } })
  }

  function pickUnion(fieldId: string): void {
    setChoices({ ...choices, [fieldId]: { kind: 'union' } })
  }

  /** Take every field from one source at once — the "this record is simply better" shortcut. */
  function takeAll(from: number): void {
    const next: Record<string, Resolution> = { ...choices }
    for (const f of preview?.fields ?? []) if (f.conflict) next[f.field] = { kind: 'value', from }
    setChoices(next)
    setSurvivor(from)
  }

  const visibleFields = (preview?.fields ?? []).filter((f) => !onlyDifferences || f.conflict)

  const conflictCount = (preview?.fields ?? []).filter((f) => f.conflict).length

  const mediaFor = (id: number): number =>
    preview?.media.filter((m) => m.from === id).length ?? 0

  const columns = preview
    ? `170px repeat(${preview.ids.length}, minmax(180px, 1fr)) minmax(200px, 1fr)`
    : '1fr'

  async function apply(): Promise<void> {
    if (!preview || survivor === null) return
    setBusy(true)
    setError(null)
    try {
      setResult(await ipc('tracks:merge', { ids: preview.ids, survivor, resolutions: choices }))
      await library.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function undo(): Promise<void> {
    if (!result) return
    setUndoing(true)
    try {
      await ipc('tracks:unmerge', result.batchId)
      await library.refresh()
      onclose?.(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUndoing(false)
    }
  }

  const actions = !result && preview && (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={onlyDifferences}
          onChange={(e) => setOnlyDifferences(e.currentTarget.checked)}
        /> Only differences
      </label>
      <button className="accent solid" onClick={apply} disabled={busy || survivor === null}>
        {busy ? 'Merging…' : 'Merge'}
      </button>
    </>
  )

  return (
    <PageView
      title={`Merge ${ids.length} tracks into one`}
      subtitle={conflictCount > 0
        ? `${conflictCount} field${conflictCount === 1 ? '' : 's'} disagree — pick which value to keep`
        : 'Every field agrees; merging keeps all files under one track'}
      on_close={() => onclose?.(false)}
      actions={actions}
    >
      {error && <p className={cx(s.note, s.err)}>{error}</p>}

      {result ? (
        <div className={s.done}>
          <h3 className={s.h2}>Merged</h3>
          <p className={s.doneText}>
            One track now holds <strong>{result.mediaMoved + 1}</strong>
            {' '}{result.mediaMoved + 1 === 1 ? 'file' : 'files'}.
            {result.playlistEntriesRepointed > 0 && (
              <> {result.playlistEntriesRepointed} playlist entries repointed.</>
            )}
          </p>
          <div className={s.rowActions}>
            <button onClick={undo} disabled={undoing}>{undoing ? 'Undoing…' : 'Undo this merge'}</button>
            <button className="accent solid" onClick={() => onclose?.(true)}>Done</button>
          </div>
        </div>
      ) : preview ? (
        <>
          {preview.pinnedSources.length > 0 && (
            <p className={cx(s.note, s.warn)}>
              {preview.pinnedSources.length} of these was merged or split by hand before. Merging replaces
              that decision.
            </p>
          )}

          <div className={s.grid} style={{ gridTemplateColumns: columns }}>
            {/* header: one column per source, plus the result */}
            <div className={cx(s.cell, s.head, s.corner)}>Field</div>
            {preview.ids.map((id) => (
              <div key={id} className={cx(s.cell, s.head, s.source, survivor === id && s.survivor)}>
                <div className={s.shead}>
                  <button className={cx(survivor === id && 'accent solid')} aria-pressed={survivor === id} onClick={() => setSurvivor(id)}>
                    {survivor === id ? '● Survivor' : '○ Make survivor'}
                  </button>
                  <span className={s.sname}>Source {sourceIndex(id)}</span>
                </div>
                <div className={s.smeta}>
                  {mediaFor(id)} file{mediaFor(id) === 1 ? '' : 's'}
                </div>
                <button onClick={() => takeAll(id)}>Take all from this</button>
              </div>
            ))}
            <div className={cx(s.cell, s.head, s.result)}>Result</div>

            {visibleFields.map((f) => (
              <Fragment key={f.field}>
                <div className={cx(s.cell, s.label, f.conflict && s.conflict)}>{f.name}</div>

                {preview.ids.map((id) => {
                  const text = show(valueFor(f.field, id))
                  return f.conflict ? (
                    <button
                      key={id}
                      className={cx(s.cell, s.value, s.clickable, isChosen(f.field, id) && s.chosen, text === '' && s.empty)}
                      onClick={() => pick(f.field, id)}
                      title={text || 'empty'}
                    >{text || '—'}</button>
                  ) : (
                    <div key={id} className={cx(s.cell, s.value, s.same)} title={text}>{text || '—'}</div>
                  )
                })}

                <div className={cx(s.cell, s.resultCell)}>
                  {f.conflict && f.multi && (
                    <button className={cx(unionChosen(f.field) && 'accent solid')} aria-pressed={unionChosen(f.field)} onClick={() => pickUnion(f.field)}>
                      Keep all
                    </button>
                  )}
                  <span className={s.rval}>{show(resultFor(f.field)) || '—'}</span>
                </div>
              </Fragment>
            ))}
          </div>

          <section>
            <h3 className={s.h2}>Combined statistics</h3>
            <p className={s.hint}>
              These are not a choice: plays and skips are summed, the highest rating wins, and play
              history is merged and deduplicated.
            </p>
            <Tiles>
              <Tile label="plays" value={preview.statistics.playCount} value_first />
              <Tile label="skips" value={preview.statistics.skipCount} value_first />
              <Tile label="rating" value={preview.statistics.rating ?? '—'} value_first />
            </Tiles>
          </section>

          <section className={s.files}>
            <h3 className={s.h2}>Files the surviving track will hold</h3>
            <ul className={s.fileList}>
              {preview.media.map((m) => (
                <li key={m.id} className={s.file}>
                  <span className={s.codec}>{m.codec ?? '?'}</span>
                  <span className={s.uri} title={m.uri}>{m.uri}</span>
                  <span className={s.src}>Source {sourceIndex(m.from)}</span>
                  {!m.present && <Badge tone="bad">missing</Badge>}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <Loaded resource={loaded} lines={6}>{() => null}</Loaded>
      )}
    </PageView>
  )
}

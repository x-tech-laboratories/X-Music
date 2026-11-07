// Everything X-Music knows about one track. This is the first place the entity model is visible:
// a track is a piece of music, and the files are sources hanging off it (DESIGN-SPEC §6.5).

import { Fragment } from 'react'
import { useEffect, useState } from 'react'
import type { TrackDetails } from '@shared/ipc'
import { ipc } from '../lib/ipc'
import { cx } from '../lib/cx'
import { Page } from '../lib/Page'
import { Stars } from './Stars'
import { Cover } from './Cover'
import s from './SongProperties.module.css'

type Section = 'overview' | 'sources' | 'tags' | 'history'

const when = (ms: number | null): string =>
  ms === null || ms === 0 ? 'never' : new Date(ms).toLocaleString()

const bytes = (n: number | null): string => {
  if (n === null) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`
}

const mmss = (ms: number | null): string => {
  if (ms === null) return '—'
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Plain language for how this track came to be one track. */
const identityExplanation = (source: string): string => ({
  manual: 'Merged or split by hand. Automated passes leave it alone.',
  mbid: 'Identified by its MusicBrainz recording id.',
  acoustid: 'Identified by an acoustic fingerprint.',
  audio_hash: 'Identified by matching audio content.',
  heuristic: 'Grouped by its path and tags; no stronger evidence was available.'
} as Record<string, string>)[source] ?? source

const hashExplanation = (algo: string | null): string => ({
  'flac-streaminfo-md5': "FLAC's own checksum of the decoded audio. Exact, and free to read.",
  'sha256-mdat': 'Hashed over the MP4 audio data with the tag atoms excluded, so retagging does not change it.',
  'sha256-ogg-packets': 'Hashed over the Ogg audio packets with the comment header excluded, so retagging does not change it.',
  'sha256-frames': 'Hashed over the audio frames with tag regions excluded, so retagging does not change it.',
  'sha256-file': 'Hashed over the whole file, so editing tags will change it. Weaker for move detection.'
} as Record<string, string>)[algo ?? ''] ?? 'Not hashed yet; scan this folder to enable move detection.'

export function SongProperties({ trackId, onclose }: { trackId: number; onclose?: () => void }) {
  const [details, setDetails] = useState<TrackDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('overview')

  useEffect(() => {
    void (async () => {
      try {
        const found = await ipc('tracks:details', trackId)
        setDetails(found)
        if (!found) setError('This track no longer exists.')
      } catch (err) {
        setError((err as Error).message)
      }
    })()
  }, [])

  const totalPlays = details?.history.filter((h) => h.kind === 'play').length ?? 0
  const totalSkips = details?.history.filter((h) => h.kind === 'skip').length ?? 0

  const sections: { id: Section; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'sources', label: `Sources (${details?.media.length ?? 0})` },
    { id: 'tags', label: 'Raw tags' },
    { id: 'history', label: 'History' }
  ]

  const nav = sections.map((x) => (
    <button key={x.id} className={section === x.id ? 'active' : undefined} onClick={() => setSection(x.id)}>
      {x.label}
    </button>
  ))

  let body
  if (error) {
    body = <p className={cx(s.note, s.err)}>{error}</p>
  } else if (!details) {
    body = <p className={s.note}>Loading…</p>
  } else if (section === 'overview') {
    body = (
      <section className={s.section}>
        <div className={s.hero}>
          <Cover trackId={details.id} size={160} />
          <div>
            <h2 className={cx(s.h2, s.first)}>Metadata</h2>
            <dl className={s.dl}>
              {details.fields.slice(0, 4).map((f) =>
                f.value !== null && (
                  <Fragment key={f.field}>
                    <dt className={s.dt}>{f.name}</dt>
                    <dd className={s.dd}>{f.field === 'length' ? mmss(Number(f.value)) : f.value}</dd>
                  </Fragment>
                )
              )}
            </dl>
          </div>
        </div>

        <h2 className={s.h2}>All metadata</h2>
        <dl className={s.dl}>
          {details.fields.map((f) =>
            f.value !== null && (
              <Fragment key={f.field}>
                <dt className={s.dt}>{f.name}{f.multi && <span className={s.multi}>set</span>}</dt>
                <dd className={s.dd}>{f.field === 'length' ? mmss(Number(f.value)) : f.value}</dd>
              </Fragment>
            )
          )}
        </dl>

        <h2 className={s.h2}>Identity</h2>
        <p className={s.hint}>{identityExplanation(details.identity.source)}</p>
        <dl className={s.dl}>
          <dt className={s.dt}>Decided by</dt><dd className={s.dd}><code className={s.code}>{details.identity.source}</code></dd>
          <dt className={s.dt}>Pinned</dt>
          <dd className={s.dd}>{details.identity.pinned ? 'Yes — a person decided this' : 'No'}</dd>
          {details.identity.mbRecordingId && (
            <>
              <dt className={s.dt}>MusicBrainz</dt><dd className={s.dd}><code className={s.code}>{details.identity.mbRecordingId}</code></dd>
            </>
          )}
          {details.identity.acoustid && (
            <>
              <dt className={s.dt}>AcoustID</dt><dd className={s.dd}><code className={s.code}>{details.identity.acoustid}</code></dd>
            </>
          )}
          {details.identity.key && (
            <>
              <dt className={s.dt}>Match key</dt><dd className={s.dd}><code className={cx(s.code, s.key)}>{details.identity.key}</code></dd>
            </>
          )}
        </dl>

        <h2 className={s.h2}>Statistics</h2>
        <p className={s.hint}>These belong to the track, not to any one file, so they survive a re-rip.</p>
        <dl className={s.dl}>
          <dt className={s.dt}>Rating</dt>
          <dd className={s.dd}><Stars value={details.statistics.rating} /></dd>
          <dt className={s.dt}>Plays</dt><dd className={s.dd}>{details.statistics.playCount}</dd>
          <dt className={s.dt}>Skips</dt><dd className={s.dd}>{details.statistics.skipCount}</dd>
          <dt className={s.dt}>First played</dt><dd className={s.dd}>{when(details.statistics.firstPlayed)}</dd>
          <dt className={s.dt}>Last played</dt><dd className={s.dd}>{when(details.statistics.lastPlayed)}</dd>
          <dt className={s.dt}>Added</dt><dd className={s.dd}>{when(details.statistics.added)}</dd>
        </dl>

        {(details.loudness.rgTrackGain !== null || details.loudness.rgAlbumGain !== null) && (
          <>
            <h2 className={s.h2}>Loudness</h2>
            <dl className={s.dl}>
              <dt className={s.dt}>Track gain</dt><dd className={s.dd}>{details.loudness.rgTrackGain ?? '—'} dB</dd>
              <dt className={s.dt}>Album gain</dt><dd className={s.dd}>{details.loudness.rgAlbumGain ?? '—'} dB</dd>
            </dl>
          </>
        )}

        {details.merges.length > 0 && (
          <>
            <h2 className={s.h2}>Merge history</h2>
            {details.merges.map((m) => (
              <p key={m.batchId} className={s.hint}>
                Absorbed {m.absorbed} track{m.absorbed === 1 ? '' : 's'} on {when(m.at)}
                {' '}— <code className={s.code}>{m.batchId}</code>
              </p>
            ))}
          </>
        )}
      </section>
    )
  } else if (section === 'sources') {
    body = (
      <section className={s.section}>
        <h2 className={s.h2}>Sources</h2>
        <p className={s.hint}>
          Every file or stream backing this track. The preferred one is what plays; the rest are kept
          so nothing is lost when formats or drives change.
        </p>

        {details.media.length === 0 ? (
          <p className={s.note}>
            No sources. The track and its statistics are kept; add the files back and a scan will
            reattach them.
          </p>
        ) : details.media.map((m) => (
          <article key={m.id} className={cx(s.source, !m.present && s.missing)}>
            <header className={s.header}>
              {m.preferred && <span className={cx(s.tag, s.pref)}>plays</span>}
              {!m.present && <span className={cx(s.tag, s.gone)}>missing</span>}
              <span className={s.codec}>{(m.codec ?? m.kind).toUpperCase()}</span>
              <span className={s.path} title={m.uri}>{m.uri}</span>
              <button className={s.reveal} onClick={() => ipc('tracks:reveal', m.uri)} disabled={!m.present}>
                Show in folder
              </button>
            </header>

            <dl className={cx(s.dl, s.tech)}>
              <dt className={s.dt}>Bitrate</dt><dd className={s.dd}>{m.bitrate ? `${m.bitrate} kbps` : '—'}{m.bitrateMode ? ` ${m.bitrateMode}` : ''}</dd>
              <dt className={s.dt}>Sample rate</dt><dd className={s.dd}>{m.samplerate ? `${m.samplerate} Hz` : '—'}</dd>
              <dt className={s.dt}>Channels</dt><dd className={s.dd}>{m.channels ?? '—'}</dd>
              <dt className={s.dt}>Bit depth</dt><dd className={s.dd}>{m.bitsPerSample ?? '—'}</dd>
              <dt className={s.dt}>Size</dt><dd className={s.dd}>{bytes(m.filesize)}</dd>
              <dt className={s.dt}>Modified</dt><dd className={s.dd}>{when(m.mtime)}</dd>
              <dt className={s.dt}>Last seen</dt><dd className={s.dd}>{when(m.lastSeen)}</dd>
              <dt className={s.dt}>Quality rank</dt><dd className={s.dd}>{m.qualityRank}</dd>
              {(m.startMs !== null || m.endMs !== null) && (
                <>
                  <dt className={s.dt}>Range</dt>
                  <dd className={s.dd}>{mmss(m.startMs)} – {mmss(m.endMs)} (index {m.subtrackIndex})</dd>
                </>
              )}
            </dl>

            <div className={s.hash}>
              <span className={s.hlabel}>Audio hash</span>
              <code className={s.code}>{m.audioHashHex ? `${m.audioHashHex.slice(0, 32)}…` : 'none'}</code>
              <span className={s.halgo}>{m.audioHashAlgo ?? ''}</span>
              <p className={s.hint}>{hashExplanation(m.audioHashAlgo)}</p>
            </div>
          </article>
        ))}
      </section>
    )
  } else if (section === 'tags') {
    body = (
      <section className={s.section}>
        <h2 className={s.h2}>Raw tags, per source</h2>
        <p className={s.hint}>
          What each file actually carries. Two files backing one track can disagree, and X-Music stores
          both rather than losing the disagreement.
        </p>

        {details.media.map((m) => (
          <article key={m.id} className={s.source}>
            <header className={s.header}><span className={s.path} title={m.uri}>{m.uri}</span></header>
            {m.tags.length ? (
              <dl className={s.dl}>
                {m.tags.map((t, i) => (
                  <Fragment key={`${t.field}-${i}`}>
                    <dt className={s.dt}>{t.field}</dt><dd className={s.dd}>{t.value}</dd>
                  </Fragment>
                ))}
              </dl>
            ) : (
              <p className={s.note}>
                No raw tags stored. The gmusicbrowser import records values on the track rather than
                per file; a scan fills these in.
              </p>
            )}
          </article>
        ))}
      </section>
    )
  } else {
    body = (
      <section className={s.section}>
        <h2 className={s.h2}>Play history</h2>
        <p className={s.hint}>
          {details.historyTotal} recorded event{details.historyTotal === 1 ? '' : 's'}
          {details.historyTotal > details.history.length && (
            <> — showing the most recent {details.history.length}</>
          )}
          {' '}· {totalPlays} played, {totalSkips} skipped
        </p>

        {details.history.length ? (
          <ul className={s.history}>
            {details.history.map((h, i) => (
              <li key={`${h.at}-${i}`} className={s.entry}>
                <span className={cx(s.kind, s[h.kind])}>{h.kind}</span>
                <span>{when(h.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.note}>Never played.</p>
        )}
      </section>
    )
  }

  return (
    <Page
      title={details?.title ?? 'Track'}
      subtitle={details
        ? `${details.media.length} source${details.media.length === 1 ? '' : 's'} · ` +
          `${details.statistics.playCount} play${details.statistics.playCount === 1 ? '' : 's'}`
        : undefined}
      onclose={onclose}
      nav={nav}
    >
      {body}
    </Page>
  )
}

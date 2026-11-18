// Everything X-Music knows about one track. This is the first place the entity model is visible:
// a track is a piece of music, and the files are sources hanging off it (DESIGN-SPEC §6.5).

import { useState } from 'react'
import type { DetailMedia, TrackDetails } from '@shared/ipc'
import { Badge } from '@x-tech-laboratories/x-libs/web/react/badges'
import { Facts, Section, Stack, type Fact } from '@x-tech-laboratories/x-libs/web/react/layout'
import { Empty, Loaded, use_resource } from '@x-tech-laboratories/x-libs/web/react/states'
import { format_clock } from '@x-tech-laboratories/x-libs/durations'
import { plural, size, stamp } from '@x-tech-laboratories/x-libs/web/format'
import { PageView } from '@x-tech-laboratories/x-libs/web/react/page_view'
import { Rating } from '@x-tech-laboratories/x-libs/web/react/rating'
import { rating_to_stars } from '@shared/fields'
import { ipc, page_ipc } from '../lib/ipc.ts'
import { open_track_history } from '../views/HistoryView.tsx'
import { TrackCover } from './Cover.tsx'
import s from './SongProperties.module.css'

type SectionId = 'overview' | 'sources' | 'tags' | 'plays'

// ============================================================================
// Words
// ============================================================================

const when = (milliseconds: number | null): string =>
  milliseconds === null || milliseconds === 0 ? 'Never' : stamp(milliseconds / 1000)

const clock = (milliseconds: number | null): string => format_clock(milliseconds, '—')

const unit = (value: number | null, words: string): string | null => (value ? `${value} ${words}` : null)

// Plain language for how this track came to be one track.
const identity_explanation: Record<string, string> = {
  manual: 'Merged or split by hand. Automated passes leave it alone.',
  mbid: 'Identified by its MusicBrainz recording id.',
  acoustid: 'Identified by an acoustic fingerprint.',
  audio_hash: 'Identified by matching audio content.',
  heuristic: 'Grouped by its path and tags; no stronger evidence was available.'
}

const hash_explanation: Record<string, string> = {
  'flac-streaminfo-md5': "FLAC's own checksum of the decoded audio. Exact, and free to read.",
  'sha256-mdat': 'Hashed over the MP4 audio data with the tag atoms excluded, so retagging does not change it.',
  'sha256-ogg-packets': 'Hashed over the Ogg audio packets with the comment header excluded, so retagging does not change it.',
  'sha256-frames': 'Hashed over the audio frames with tag regions excluded, so retagging does not change it.',
  'sha256-file': 'Hashed over the whole file, so editing tags will change it. Weaker for move detection.'
}

const not_hashed = 'Not hashed yet; scan this folder to enable move detection.'

// ============================================================================
// Sections
// ============================================================================

function field_facts(fields: TrackDetails['fields']): Fact[] {
  return fields
    .filter((field) => field.value !== null)
    .map((field): Fact => [
      field.name,
      <>
        {field.field === 'length' ? clock(Number(field.value)) : field.value}
        {field.multi && <> <Badge title="This field holds several values">set</Badge></>}
      </>
    ])
}

function Overview({ details }: { details: TrackDetails }) {
  const { identity, statistics, loudness } = details
  return (
    <Stack>
      <div className={s.hero}>
        <TrackCover track_id={details.id} size="large" />
        <Facts rows={field_facts(details.fields.slice(0, 4))} />
      </div>

      <Section title="All metadata">
        <Facts layout="rows" rows={field_facts(details.fields)} />
      </Section>

      <Section title="Identity">
        <p className="muted small">{identity_explanation[identity.source] ?? identity.source}</p>
        <Facts layout="rows" rows={[
          ['Decided by', <code>{identity.source}</code>],
          ['Pinned', identity.pinned ? 'Yes, a person decided this' : 'No'],
          identity.mb_recording_id !== null && ['MusicBrainz', <code>{identity.mb_recording_id}</code>],
          identity.acoustid !== null && ['AcoustID', <code>{identity.acoustid}</code>],
          identity.key !== null && ['Match key', <code className={s.wrap}>{identity.key.replaceAll('\u001f', ' · ')}</code>]
        ]} />
      </Section>

      <Section title="Statistics">
        <p className="muted small">These belong to the track, not to any one file, so they survive a re-rip.</p>
        <Facts layout="rows" rows={[
          ['Rating', <Rating value={rating_to_stars(statistics.rating)} />],
          ['Plays', statistics.play_count],
          ['Skips', statistics.skip_count],
          ['First played', when(statistics.first_played)],
          ['Last played', when(statistics.last_played)],
          ['Added', when(statistics.added)]
        ]} />
      </Section>

      {(loudness.rg_track_gain !== null || loudness.rg_album_gain !== null) && (
        <Section title="Loudness">
          <Facts layout="rows" rows={[
            ['Track gain', loudness.rg_track_gain === null ? null : `${loudness.rg_track_gain} dB`],
            ['Album gain', loudness.rg_album_gain === null ? null : `${loudness.rg_album_gain} dB`]
          ]} />
        </Section>
      )}

      {details.merges.length > 0 && (
        <Section title="Merge history">
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">Absorbed</th><th scope="col">Batch</th></tr></thead>
            <tbody>
              {details.merges.map((merge) => (
                <tr key={merge.batch_id}>
                  <td>{when(merge.at)}</td>
                  <td>{plural(merge.absorbed, 'track')}</td>
                  <td><code>{merge.batch_id}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </Stack>
  )
}

function Source({ media }: { media: DetailMedia }) {
  const range = media.start_ms !== null || media.end_ms !== null
  return (
    <Section
      class_name={s.source}
      title={
        <span className={s.source_title}>
          {media.preferred && <Badge tone="good">Plays</Badge>}
          {!media.present && <Badge tone="bad">Missing</Badge>}
          <span className={s.path} title={media.uri}>{media.uri}</span>
        </span>
      }
      tools={<button onClick={() => void page_ipc('show_in_folder', media.uri)} disabled={!media.present}>Show in folder</button>}
    >
      <Facts rows={[
        ['Format', (media.codec ?? media.kind).toUpperCase()],
        ['Bitrate', unit(media.bitrate, media.bitrate_mode ? `kbps ${media.bitrate_mode}` : 'kbps')],
        ['Sample rate', unit(media.samplerate, 'Hz')],
        ['Channels', media.channels],
        ['Bit depth', media.bits_per_sample],
        ['Size', size(media.filesize)],
        ['Modified', when(media.mtime)],
        ['Last seen', when(media.last_seen)],
        ['Quality rank', media.quality_rank],
        range && ['Range', `${clock(media.start_ms)} – ${clock(media.end_ms)} (index ${media.subtrack_index})`]
      ]} />
      <Facts layout="rows" rows={[
        ['Audio hash', media.audio_hash_hex ? <code className={s.wrap}>{media.audio_hash_hex}</code> : 'None'],
        media.audio_hash_algo !== null && ['Hash method', <code>{media.audio_hash_algo}</code>]
      ]} />
      <p className="muted small">{hash_explanation[media.audio_hash_algo ?? ''] ?? not_hashed}</p>
    </Section>
  )
}

function Sources({ details }: { details: TrackDetails }) {
  return (
    <Stack>
      <p className="muted">
        Every file or stream backing this track. The preferred one is what plays; the rest are kept
        so nothing is lost when formats or drives change.
      </p>
      {details.media.length === 0
        ? <Empty title="No sources" hint="The track and its statistics are kept; add the files back and a scan will reattach them." />
        : details.media.map((media) => <Source key={media.id} media={media} />)}
    </Stack>
  )
}

// One row per tag, with repeated tags such as several artists joined.
function tag_facts(tags: DetailMedia['tags']): Fact[] {
  const joined = new Map<string, string[]>()
  for (const tag of tags) joined.set(tag.field, [...(joined.get(tag.field) ?? []), tag.value])
  return [...joined].map(([field, values]): Fact => [field, values.join(', ')])
}

function RawTags({ details }: { details: TrackDetails }) {
  return (
    <Stack>
      <p className="muted">
        What each file actually carries. Two files backing one track can disagree, and X-Music stores
        both rather than losing the disagreement.
      </p>
      {details.media.map((media) => (
        <Section key={media.id} class_name={s.source} title={<span className={s.path} title={media.uri}>{media.uri}</span>}>
          {media.tags.length > 0
            ? <Facts layout="rows" rows={tag_facts(media.tags)} />
            : <Empty title="No raw tags stored" hint="The gmusicbrowser import records values on the track rather than per file; a scan fills these in." />}
        </Section>
      ))}
    </Stack>
  )
}

function Plays({ details }: { details: TrackDetails }) {
  const plays = details.history.filter((entry) => entry.kind === 'play').length
  const skips = details.history.length - plays
  const shown_part = details.history_total > details.history.length ? `, showing the most recent ${details.history.length}` : ''
  return (
    <Stack>
      <p className="muted">
        {plural(details.history_total, 'recorded event')}{shown_part} · {plural(plays, 'play')}, {plural(skips, 'skip')}
      </p>
      {details.history.length > 0 ? (
        <table>
          <thead><tr><th scope="col">Event</th><th scope="col">When</th></tr></thead>
          <tbody>
            {details.history.map((entry, index) => (
              <tr key={`${entry.at}-${index}`}>
                <td><Badge tone={entry.kind === 'play' ? 'good' : 'warn'}>{entry.kind === 'play' ? 'Played' : 'Skipped'}</Badge></td>
                <td>{when(entry.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title="Never played" />
      )}
    </Stack>
  )
}

// ============================================================================
// Page
// ============================================================================

export function SongProperties({ track_id, on_close }: { track_id: string; on_close: () => void }) {
  const [section, set_section] = useState<SectionId>('overview')
  const resource = use_resource(() => ipc('get_track', track_id), [track_id])
  const details = resource.data

  const sections: { id: SectionId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'sources', label: `Sources (${details?.media.length ?? 0})` },
    { id: 'tags', label: 'Raw tags' },
    { id: 'plays', label: 'Plays and skips' }
  ]

  return (
    <PageView
      title={details?.title ?? 'Track'}
      subtitle={details ? `${plural(details.media.length, 'source')} · ${plural(details.statistics.play_count, 'play')}` : undefined}
      on_close={on_close}
      actions={details && <button onClick={() => open_track_history(details.id, details.title ?? 'Untitled track', () => void resource.reload(true))}>History</button>}
      sections={sections}
      section={section}
      on_section={set_section}
    >
      <Loaded resource={resource} lines={6} empty={<Empty title="This track no longer exists" />}>
        {(loaded) => loaded !== null && (
          <div className={s.body}>
            {section === 'overview' && <Overview details={loaded} />}
            {section === 'sources' && <Sources details={loaded} />}
            {section === 'tags' && <RawTags details={loaded} />}
            {section === 'plays' && <Plays details={loaded} />}
          </div>
        )}
      </Loaded>
    </PageView>
  )
}

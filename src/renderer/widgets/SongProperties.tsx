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
import { ratingToStars } from '@shared/fields'
import { ipc } from '../lib/ipc'
import { TrackCover } from './Cover'
import s from './SongProperties.module.css'

type SectionId = 'overview' | 'sources' | 'tags' | 'history'

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
        <TrackCover track_id={details.id} size={160} />
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
          identity.mbRecordingId !== null && ['MusicBrainz', <code>{identity.mbRecordingId}</code>],
          identity.acoustid !== null && ['AcoustID', <code>{identity.acoustid}</code>],
          identity.key !== null && ['Match key', <code className={s.wrap}>{identity.key.replaceAll('\u001f', ' · ')}</code>]
        ]} />
      </Section>

      <Section title="Statistics">
        <p className="muted small">These belong to the track, not to any one file, so they survive a re-rip.</p>
        <Facts layout="rows" rows={[
          ['Rating', <Rating value={ratingToStars(statistics.rating)} />],
          ['Plays', statistics.playCount],
          ['Skips', statistics.skipCount],
          ['First played', when(statistics.firstPlayed)],
          ['Last played', when(statistics.lastPlayed)],
          ['Added', when(statistics.added)]
        ]} />
      </Section>

      {(loudness.rgTrackGain !== null || loudness.rgAlbumGain !== null) && (
        <Section title="Loudness">
          <Facts layout="rows" rows={[
            ['Track gain', loudness.rgTrackGain === null ? null : `${loudness.rgTrackGain} dB`],
            ['Album gain', loudness.rgAlbumGain === null ? null : `${loudness.rgAlbumGain} dB`]
          ]} />
        </Section>
      )}

      {details.merges.length > 0 && (
        <Section title="Merge history">
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">Absorbed</th><th scope="col">Batch</th></tr></thead>
            <tbody>
              {details.merges.map((merge) => (
                <tr key={merge.batchId}>
                  <td>{when(merge.at)}</td>
                  <td>{plural(merge.absorbed, 'track')}</td>
                  <td><code>{merge.batchId}</code></td>
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
  const range = media.startMs !== null || media.endMs !== null
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
      tools={<button onClick={() => void ipc('tracks:reveal', media.uri)} disabled={!media.present}>Show in folder</button>}
    >
      <Facts rows={[
        ['Format', (media.codec ?? media.kind).toUpperCase()],
        ['Bitrate', unit(media.bitrate, media.bitrateMode ? `kbps ${media.bitrateMode}` : 'kbps')],
        ['Sample rate', unit(media.samplerate, 'Hz')],
        ['Channels', media.channels],
        ['Bit depth', media.bitsPerSample],
        ['Size', size(media.filesize)],
        ['Modified', when(media.mtime)],
        ['Last seen', when(media.lastSeen)],
        ['Quality rank', media.qualityRank],
        range && ['Range', `${clock(media.startMs)} – ${clock(media.endMs)} (index ${media.subtrackIndex})`]
      ]} />
      <Facts layout="rows" rows={[
        ['Audio hash', media.audioHashHex ? <code className={s.wrap}>{media.audioHashHex}</code> : 'None'],
        media.audioHashAlgo !== null && ['Hash method', <code>{media.audioHashAlgo}</code>]
      ]} />
      <p className="muted small">{hash_explanation[media.audioHashAlgo ?? ''] ?? not_hashed}</p>
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

function History({ details }: { details: TrackDetails }) {
  const plays = details.history.filter((entry) => entry.kind === 'play').length
  const skips = details.history.length - plays
  const shown_part = details.historyTotal > details.history.length ? `, showing the most recent ${details.history.length}` : ''
  return (
    <Stack>
      <p className="muted">
        {plural(details.historyTotal, 'recorded event')}{shown_part} · {plural(plays, 'play')}, {plural(skips, 'skip')}
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

export function SongProperties({ trackId, onclose }: { trackId: string; onclose: () => void }) {
  const [section, set_section] = useState<SectionId>('overview')
  const resource = use_resource(() => ipc('tracks:details', trackId), [trackId])
  const details = resource.data

  const sections: { id: SectionId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'sources', label: `Sources (${details?.media.length ?? 0})` },
    { id: 'tags', label: 'Raw tags' },
    { id: 'history', label: 'History' }
  ]

  return (
    <PageView
      title={details?.title ?? 'Track'}
      subtitle={details ? `${plural(details.media.length, 'source')} · ${plural(details.statistics.playCount, 'play')}` : undefined}
      on_close={onclose}
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
            {section === 'history' && <History details={loaded} />}
          </div>
        )}
      </Loaded>
    </PageView>
  )
}

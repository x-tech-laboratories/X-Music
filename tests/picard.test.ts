// Handing tracks to MusicBrainz Picard: which files it gets, where it is found, and what is read again once it closes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { find_picard, tag_with_picard, type PicardLauncher, type PicardScans } from '@main/picard'
import type { ScanReport } from '@shared/ipc'
import { new_id } from '@shared/library/database'
import { get_picard_settings, handoff_files, rescan_targets, set_picard_settings } from '@shared/library/picard'
import { add_track, fresh_db, type TestDb } from './sqlite.ts'

let db: TestDb

beforeEach(() => { db = fresh_db() })
afterEach(() => db.close())

// ============================================================================
// Helpers
// ============================================================================

function file(track_id: string, uri: string, extra: { present?: number; subtrack_index?: number; start_ms?: number | null } = {}): void {
  db.prepare(`INSERT INTO media (id, track_id, kind, uri, present, subtrack_index, start_ms, added) VALUES (?, ?, 'file', ?, ?, ?, ?, 0)`)
    .run(new_id(), track_id, uri, extra.present ?? 1, extra.subtrack_index ?? 0, extra.start_ms ?? null)
}

function track_with(uri: string): string {
  const id = add_track(db, { title: uri })
  file(id, uri)
  return id
}

const report = (changes: Partial<ScanReport> = {}): ScanReport => ({
  files_found: 0, files_read: 0, files_skipped: 0, tracks_created: 0, tracks_matched: 0,
  moves_detected: 0, marked_missing: 0, errors: [], duration_ms: 0, ...changes
})

// A Picard that stays open until the test closes it, and records how it was started.
function fake_launcher(found: string | null = '/usr/bin/picard') {
  const started: (readonly string[])[] = []
  let close: (exit_code: number) => void = () => undefined
  const launcher: PicardLauncher = {
    on_path: async (name) => (name === 'picard' ? found : null),
    exists: (path) => path === '/opt/picard/picard',
    run: (argv) => {
      started.push(argv)
      return new Promise((resolve) => { close = (exit_code) => resolve({ exit_code }) })
    }
  }
  return { launcher, started, close: (exit_code = 0) => close(exit_code) }
}

function fake_scans(music_folders: string[], first: ScanReport = report()) {
  const scanned: { kind: 'targets' | 'all'; folders?: string[]; files?: string[] }[] = []
  const scans: PicardScans = {
    music_folders: () => music_folders,
    scan: async (targets) => { scanned.push({ kind: 'targets', ...targets }); return first },
    scan_all: async () => { scanned.push({ kind: 'all' }); return report({ moves_detected: 1 }) }
  }
  return { scans, scanned }
}

// ============================================================================
// Settings
// ============================================================================

describe('picard settings', () => {
  it('looks for Picard on PATH and rescans when it closes, unless set otherwise', () => {
    expect(get_picard_settings(db)).toEqual({ path: '', rescan: true })
  })

  it('keeps a change to one setting without losing the other, and trims the path', () => {
    set_picard_settings(db, { path: '  /opt/picard/picard ' })
    set_picard_settings(db, { rescan: false })

    expect(get_picard_settings(db)).toEqual({ path: '/opt/picard/picard', rescan: false })
  })

  it('finds Picard on PATH, or at the path set, and reports a set path that is not there', async () => {
    const { launcher } = fake_launcher()

    expect(await find_picard(db, launcher)).toBe('/usr/bin/picard')
    set_picard_settings(db, { path: '/opt/picard/picard' })
    expect(await find_picard(db, launcher)).toBe('/opt/picard/picard')
    set_picard_settings(db, { path: '/nowhere/picard' })
    expect(await find_picard(db, launcher)).toBeNull()
  })
})

// ============================================================================
// Files
// ============================================================================

describe('the files Picard gets', () => {
  it('gives each track\'s whole files on disk once, in path order', () => {
    const first = track_with('/music/b.flac')
    file(first, '/music/b.mp3')
    const second = track_with('/music/a.flac')

    expect(handoff_files(db, [first, second, first])).toEqual({ files: ['/music/a.flac', '/music/b.flac', '/music/b.mp3'], skipped: 0 })
  })

  it('leaves out tracks with no file on disk and ranges inside a larger file', () => {
    const gone = add_track(db)
    file(gone, '/music/gone.flac', { present: 0 })
    const cue = add_track(db)
    file(cue, '/music/live.flac', { subtrack_index: 3, start_ms: 60_000 })
    const kept = track_with('/music/kept.flac')

    expect(handoff_files(db, [gone, cue, kept, kept])).toEqual({ files: ['/music/kept.flac'], skipped: 2 })
  })
})

describe('what is read again', () => {
  it('reads the folders of files inside the music folders, leaving out folders inside others', () => {
    const targets = rescan_targets(['/music/Album/1.flac', '/music/Album/CD2/1.flac', '/music/Other/2.flac'], ['/music'])

    expect(targets).toEqual({ folders: ['/music/Album', '/music/Other'], files: [] })
  })

  it('reads files outside the music folders alone, so their neighbours stay out of the library', () => {
    const targets = rescan_targets(['/home/me/Downloads/new.flac', '/music/a.flac'], ['/music'])

    expect(targets).toEqual({ folders: ['/music'], files: ['/home/me/Downloads/new.flac'] })
  })

  it('does not mistake a folder that only starts with a music folder\'s name for being inside it', () => {
    expect(rescan_targets(['/music-old/a.flac'], ['/music'])).toEqual({ folders: [], files: ['/music-old/a.flac'] })
  })
})

// ============================================================================
// Handing off
// ============================================================================

describe('tag_with_picard', () => {
  it('opens the files in a Picard of their own and rescans their folders once it closes', async () => {
    const ids = [track_with('/music/Album/1.flac'), track_with('/music/Album/2.flac')]
    const picard = fake_launcher()
    const { scans, scanned } = fake_scans(['/music'], report({ files_read: 2 }))

    const run = await tag_with_picard(db, ids, picard.launcher, scans)

    expect(run).toMatchObject({ files: 2, skipped: 0, picard: '/usr/bin/picard' })
    expect(picard.started).toEqual([['/usr/bin/picard', '--stand-alone-instance', '/music/Album/1.flac', '/music/Album/2.flac']])
    expect(scanned).toEqual([])

    picard.close()
    expect(await run.closed).toEqual({ files: 2, report: report({ files_read: 2 }), error: undefined })
    expect(scanned).toEqual([{ kind: 'targets', folders: ['/music/Album'], files: [] }])
  })

  it('reads every music folder when a file went missing, since Picard probably moved it', async () => {
    const picard = fake_launcher()
    const { scans, scanned } = fake_scans(['/music'], report({ marked_missing: 1 }))

    const run = await tag_with_picard(db, [track_with('/music/Album/1.flac')], picard.launcher, scans)
    picard.close()

    expect((await run.closed).report).toEqual(report({ moves_detected: 1 }))
    expect(scanned.map((scan) => scan.kind)).toEqual(['targets', 'all'])
  })

  it('reads nothing again when rescanning is turned off, and says when Picard failed', async () => {
    set_picard_settings(db, { rescan: false })
    const picard = fake_launcher()
    const { scans, scanned } = fake_scans(['/music'])

    const run = await tag_with_picard(db, [track_with('/music/a.flac')], picard.launcher, scans)
    picard.close(1)

    expect(await run.closed).toEqual({ files: 1, report: null, error: 'Picard ended with exit code 1' })
    expect(scanned).toEqual([])
  })

  it('refuses when Picard is not found, or when no track has a whole file', async () => {
    const { scans } = fake_scans(['/music'])
    const missing = add_track(db)

    await expect(tag_with_picard(db, [track_with('/music/a.flac')], fake_launcher(null).launcher, scans)).rejects.toThrow(/Picard was not found/)
    await expect(tag_with_picard(db, [missing], fake_launcher().launcher, scans)).rejects.toThrow(/no.*whole file/)
  })

  it('says what went wrong when Picard cannot be started', async () => {
    const { scans } = fake_scans(['/music'])
    const launcher: PicardLauncher = { ...fake_launcher().launcher, run: async () => { throw new Error('spawn E2BIG') } }

    const run = await tag_with_picard(db, [track_with('/music/a.flac')], launcher, scans)

    expect(await run.closed).toEqual({ files: 1, report: null, error: 'spawn E2BIG' })
  })
})

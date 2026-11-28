# Instructions for AI agents

X-Music is an Electron music player written in TypeScript. Read `README.md` first; the full design is
in `docs/DESIGN-SPEC.md`, and every feature should match it. Where the design spec disagrees with the
Application Standard or the Design Guidelines (below), the standards win; fix the spec to match.

## Setup and checks

- `nix develop` gives the pinned toolchain; then `npm install`.
- `npm run typecheck` and `npm test` must pass before you propose a change.
- Run only the tests for what you changed while working (`npx vitest run tests/<file>`); CI runs the full suite.
- To run or screenshot the real app, use the `run-x-music` skill in `.claude/skills/`.

## Rules

- Code in `src/shared/` stays framework-free and DOM-free; it is imported by both main and renderer.
- The app and the tests reach SQLite through Node's own `node:sqlite`; add no native SQLite module.
- The library store lives in `src/shared/library/` and imports nothing from `node:`. A schema change is made in
  `schema.ts` and written with `npm run db:generate`; a released migration is never edited. Rows get ids from
  `new_id()`, never an auto-incrementing number.
- Never open the real library (`~/.config/x-music/library.db` or wherever `X_MUSIC_DB` points) from a test or a
  check; use a scratch database.
- Filters run through X-App `filter` and `filter_sql` over the catalogue in `src/shared/query/catalogue.ts`; keep
  SQL and in-memory results in agreement there, as `tests/filter_compile.test.ts` checks.
- Add a test for every behaviour you change, and a failing test first for every bug fix.
- Prefer settings and extension points over changing behaviour for everyone.
- Commit messages follow Conventional Commits and end with an `Assisted-by:` trailer naming the tool.

## X-Tech standards

- Follow the [Application Standard](https://x-tech-laboratories.github.io/standards/application/) and the
  [Design Guidelines](https://x-tech-laboratories.github.io/standards/design/), whose source is `src/content/docs/standards/`
  in [x-tech-laboratories.github.io](https://github.com/x-tech-laboratories/x-tech-laboratories.github.io). Ask before
  changing either, since a change applies to every X-app.
- Use [X-App](https://github.com/x-tech-laboratories/X-App) and Halon ([X-Themes](https://github.com/x-tech-laboratories/X-Themes))
  before writing your own code: check the module table in the X-App README first.
- A feature another app could use belongs in X-App, or Halon for styling, with tests and a README row. If that is out
  of reach, add it to the candidates in X-App's `docs/TODO.md`.

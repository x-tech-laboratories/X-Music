# Instructions for AI agents

X-Music is an Electron music player written in TypeScript. Read `README.md` first; the full design is
in `docs/DESIGN-SPEC.md`, and every feature should match it.

## Setup and checks

- `nix develop` gives the pinned toolchain; then `npm install`.
- `npm run typecheck` and `npm test` must pass before you propose a change.
- Run only the tests for what you changed while working (`npx vitest run test/unit/<file>`); CI runs the full suite.
- To run or screenshot the real app, use the `run-x-music` skill in `.claude/skills/`.

## Rules

- X-Music is read-only by default. Every filesystem write must go through `assertWritable()` in `src/main/safety.ts`.
- Code in `src/shared/` stays framework-free and DOM-free; it is imported by both main and renderer.
- Tests reach SQLite through `node:sqlite`, never `better-sqlite3`.
- Keep the SQL compiler and the native filter predicate in agreement; `test/property/ast-agreement.test.ts` must pass.
- Add a test for every behaviour you change, and a failing test first for every bug fix.
- Prefer settings and extension points over changing behaviour for everyone.
- Commit messages follow Conventional Commits and end with an `Assisted-by:` trailer naming the tool.

## X-Tech standards

- Follow the [Application Standard](https://x-tech-laboratories.github.io/standards/application/) and the
  [Design Guidelines](https://x-tech-laboratories.github.io/standards/design/), whose source is `src/content/docs/standards/`
  in [x-tech-laboratories.github.io](https://github.com/x-tech-laboratories/x-tech-laboratories.github.io). Ask before
  changing either, since a change applies to every X-app.
- Use [X-Libs](https://github.com/x-tech-laboratories/X-Libs) and Halon ([X-Themes](https://github.com/x-tech-laboratories/X-Themes))
  before writing your own code: check the module table in the X-Libs README first.
- A feature another app could use belongs in X-Libs, or Halon for styling, with tests and a README row. If that is out
  of reach, add it to the candidates in X-Libs' `docs/TODO.md`.

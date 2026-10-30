# Hack Dev Code: conventions for coding agents and contributors

Hack Dev Code is a TypeScript monorepo (pnpm workspaces, Node 24.9+). The agent harness lives in `packages/` and `apps/`; the product built for the hackathon is the guild in `packages/hackdev`. Read [README.md](README.md) first and [docs/hack-dev-code.md](docs/hack-dev-code.md) for the design.

## Layout

- `packages/<group>/<package>`: one plugin or library per package. Everything is a Cordis plugin; services are declared by a `Context` and consumed through `inject`.
- `packages/hackdev/tool-hackdev`: the mission pipeline (`src/script.ts` holds the fixed orchestration scripts).
- `packages/hackdev/client-ui-hackdev`: the Web card for mission and gate-review results.
- `packages/bundle/*`: product bundles. A tool or UI plugin is mounted by a row in a bundle's `cordis.patch.yml`; the Web app also needs rows in `packages/bundle/web-app/presets/*.patch.yml`.
- `apps/cli`, `apps/web`, `apps/desktop`: command line, Web UI and desktop shell.
- `vendor/`: vendored Cordis framework libraries. `native/`: the native sandbox helper.
- `docs/`: the design doc plus generated `tool-catalog.md` and `config-catalog.md` (regenerate with `pnpm run gen-tool-catalog` and `pnpm run gen-config-catalog`).

## Commands

```sh
pnpm install
pnpm run build:artifacts              # set DSH_CLIENT_COMMIT_HASH=abcdef1 outside a git checkout
npx tsc -b tsconfig.client.json       # type check the browser side
npx tsc -b tsconfig.host.json         # type check the host side (use NODE_OPTIONS=--max-old-space-size=8192)
pnpm run lint                         # oxlint
npx vitest run <path>                 # tests for a package or file
pnpm run start:web                    # Web UI at http://127.0.0.1:3080
```

## Rules

- **English only.** All code, comments, UI text, docs and test data are in English. Test samples that need wide characters use `\uXXXX` escapes.
- **No secrets.** Never write an API key into a file, test, prompt or log. Use `DEEPSEEK_API_KEY` or the credential store.
- **Strict TypeScript, no `any`.** The lint config enforces it. Keep export JSDoc accurate.
- **Tests sit next to the package** in `tests/`. Client component tests are `*.client.spec.tsx` (jsdom). Prefer deterministic tests with scripted agents over live model calls.
- **Match the surrounding code**: comment density, naming and idiom.
- A new workspace package also needs: a reference in `tsconfig.host.json` or `tsconfig.client.json`, `pnpm run gen-tsconfig-paths`, and a manual `"<name>/client"` path entry in `tsconfig.base.json` when it has a client entry.
- Generated files (`tsconfig.base.json` aliases, `docs/tool-catalog.md`, `docs/config-catalog.md`) are produced by their scripts; do not hand-edit generated sections.

## Windows notes

Some repository tests need symlinks, git or a POSIX shell and fail on Windows for that reason alone (symlink `EPERM`, "not a git repository", `tar`/`pwsh` not found). Judge a change by the failures that mention the files you touched.

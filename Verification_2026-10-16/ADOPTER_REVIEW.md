# Independent adopter check — 2026-10-16

## Scope and source

A fresh, isolated copy of 66 allowlisted project files was installed under `adopter_clean_2026-10-16/`. The SHA-256 manifest is `adopter_snapshot_manifest.json`. The copy contains source, documentation, public handbook files, and invented fixtures. It excludes `.git`, `.local`, `.vercel`, existing `node_modules`, `dist`, verification folders, and local environment files. The root `.env.example` is included as documentation. The isolated directory is explicitly ignored by `Verification_2026-10-16/.gitignore`.

The final history-view safeguard in `apps/web/App.tsx` was copied into the snapshot and its manifest hash updated before repeating type checking, tests, and production build. The subsequent mobile settings accessible label, navigation CSS adjustment, and LF/trailing-blank normalization were then copied and a final production build passed; the source manifest records those refreshed files. No external deployment, real clinical data, real access code, signing secret, or provider credential was used for this check.

## Commands and results

The commands below were run from the isolated project root using Node **24.19.0** and npm **10.9.8**. The local machine's bundled Node executable was placed first on `PATH`; this does not change the adopter commands.

| Documented command | Observed result |
|---|---|
| `npm ci` | Exit 0; 78 packages added, 79 audited; npm reported zero vulnerabilities. Puppeteer's normal installation was enabled. |
| `npm run typecheck` | Exit 0, including after the final history-view safeguard. |
| `npm test` | Exit 0; **79 passed, 1 skipped**, across three passing test files and one skipped file. The skipped public-catalogue test is opt-in; this run made no model calls. |
| `npm run build` | Exit 0; Vite 8.3.4 transformed 2,029 modules. The final copied UI produced the bundled Hebrew font, CSS and JavaScript assets. |
| `npm run handbook -- --html-only` | Exit 0 in the isolated copy. This validates the handbook builder and source imports; it deliberately does not produce a release PDF or a new paired manifest. |

The build emitted nonfatal `lucide-react` module-level `"use client"` directive warnings. The first build also emitted plugin-timing advice. These did not prevent output generation; this report does not claim a warning-free build.

## Configuration checks

Only an invented API origin was used:

```dotenv
# apps/web/.env.local — isolated verification copy only
VITE_API_URL=https://api.example.invalid
```

For the production build, `PAGES_BASE=/adopter-check/` was set in the process environment. The emitted HTML referenced `/adopter-check/assets/`, and the emitted JavaScript contained the invented API origin. This confirms the README's distinction: Vite reads the frontend `.env.local` from `apps/web`, whereas this project's `PAGES_BASE` must be supplied to the process or workflow.

The HTML-only handbook output contained the independent-deployment instructions imported from the root README, the credential-generation command, absolute repository links for relative source links, and prompt version `2026-10-16.3`. No unresolved template markers remained.

The exact documented Node credential-generation command was evaluated with a mock filesystem and deterministic mock randomness. It used a dated `.local/setup_…` path, produced a 32-character code, a matching 64-hex-character SHA-256 hash, a 64-character signing secret, and exclusive file creation. This check created no actual credential file and no real secrets.

## Documentation corrections included

- Independent clone/fork and Vercel project creation steps now use the adopter's repository and account placeholders.
- Node 24, locked dependencies, the project-root Vercel configuration, and local UI-only development are explicit.
- Frontend `.env.local` placement, public API origin syntax, Pages base-path handling, exact CORS origins, and localhost versus preview ports are explicit.
- Redis REST URL/token requirements, write/EVAL capability, variable precedence, fixed namespace, and the limits of a readiness PING are explicit.
- Access-code hashing and signing-secret generation use a portable Node command that does not print values.
- The handbook uses the repository's locked Puppeteer dependency and portable browser installation/executable options; it needs no author-specific skill/runtime path.
- Preference cancellation is documented as a scoped event, preserving the original preference and historical record.

## Limits and evidence location

The report verifies installation, compilation, automated tests, build configuration, and handbook source assembly. It does not independently prove Vercel deployment, browser behavior, production CORS, Redis scripting, provider authentication, or all-model inference. The root release review records those checks separately. Final HTML and PDF publication must follow the final release-evidence update and paired handbook rebuild.

Local command transcripts are `adopter_npm_ci.log`, `adopter_typecheck.log`, `adopter_test.log`, `adopter_build.log`, and `adopter_handbook_preview.log` beside this report. Logs and the isolated installation are ignored; this small report and the source manifest may be retained in the repository.

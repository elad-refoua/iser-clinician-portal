# Operating handbook

The Hebrew handbook is built from `2026-10-16/handbook.md`, `metadata.json`, `release-evidence.md`, and `handbook.css`. The date identifies the source edition. HTML and PDF must always be regenerated together before publishing. Never edit the generated `apps/web/public/handbook.html` or `handbook.pdf` directly.

The builder imports all active `PROMPT_SECTIONS`, the prompt version and exact dynamic prompt/output contracts through `buildSystemPrompt`. It also imports the intake fields, statuses, nine section mappings, approved models, and the actual TypeScript contracts and active prompt-section count. Chapter 13 imports the independent-deployment section from the root README, including credential generation and required Neon configuration for the signed-in workspace flow. No copied prompt or competing adopter recipe is maintained in the prose. Source hashes and output hashes are recorded in `2026-10-16/build-manifest.json`; the shared source fingerprint is visible in both editions. The source list includes new-record UI, workspace synchronization, the domain storage adapter, the workspace handler, login/case-overview/response-explanation modules and their behavior tests, and the SQL/table implementation in `apps/api/workspace-store.ts`.

## Rebuild

From the repository root, using Node 24:

```sh
npm ci
npm run handbook
npm run build
```

Puppeteer is a locked development dependency. Its install normally downloads a compatible browser. If installation ran with browser download disabled, install the pinned Chrome build explicitly:

```sh
npx puppeteer browsers install chrome
npm run handbook
```

Alternatively, point to a compatible Chrome/Chromium already installed on the build machine. These are examples; use the executable's actual path:

```powershell
$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run handbook
```

```sh
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npm run handbook
```

Linux Chrome also needs its system libraries; the Puppeteer CLI supports `npx puppeteer browsers install chrome --install-deps` on supported Linux systems with the necessary privileges. Browser installation is a build-machine concern, not a Vercel runtime secret. For an advanced shared-runtime setup, `PUPPETEER_MODULE_PATH` can point to the absolute directory of an existing Puppeteer package; ordinary adopters do not need this override or a Codex skill installation.

`npm run handbook -- --html-only` creates a preview without touching the PDF and is explicitly not a releasable pair. The Pages workflow uses the committed HTML/PDF, so it does not require a browser to serve the site or run ordinary unit tests.

The builder uses Chromium for this local artifact only, waits for embedded fonts, checks TOC anchors and horizontal overflow at desktop and mobile widths, and prints multipage A4 with page numbers. It follows the HTML-to-PDF skill's RTL/font/page-break guidance, adapted for a multipage handbook. These checks do not replace deployed participant-browser verification. Inspect PDF pages after substantial layout changes, including long tables, code, and the last page.

## Update a release

1. Inspect the current implementation before changing a behavioral claim.
2. Edit the Markdown source and release evidence. Record only observed checks, with their scope; do not infer live model quality from prepared-mode tests.
3. Increment the handbook version in `metadata.json` when changing a published edition. If prompt behavior changes, its owner also updates `PROMPT_VERSION` and acceptance tests.
4. Rebuild both outputs, inspect the PDF, then build the website. Publish the generated files with the same source change.
5. Verify the deployed HTML and PDF links, version and source fingerprint through the browser.

Font: Noto Sans Hebrew, included under the SIL Open Font License (`2026-10-16/assets/OFL.txt`). The TTF is embedded in the generated HTML so rendering does not depend on a remote font service.

For optional PDF inspection, `python docs/handbook/2026-10-16/inspect_pdf.py` uses PyMuPDF and Pillow to render every page, produce contact sheets, and record text-block bounds. Generated PNGs are ignored locally; the JSON report is retained. The inspector does not replace reading the images. A machine missing these optional inspection libraries can install them in its own Python environment; they are not required for `npm run handbook`.

No patient/client/participant data is used in the source, fixtures, or build. The request-control example is an artificial empty context, not a saved session.

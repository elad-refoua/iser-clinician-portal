# Server-only persistence audit — 2026-10-16

Reviewed the current shared working tree after the server-only UI changes and implemented bounded lossless workspace transport. This review used repository code and explicitly fictional fixtures only. No database, deployment, real patient files, secrets, or model API was accessed by this reviewer. The live-size measurement below was supplied by the coordinating agent, not independently fetched here. Browser verification and deployment remain the coordinating agent's separate checks.

## Findings and implemented correction

**The original 3 MB JSON request cap would stop ordinary history growth well before the archive schema limit.** The coordinator measured the fictional live workspace at revision 45: 1,695,958 UTF-8 bytes for the PUT envelope, 297,940 bytes with gzip, five cases, 19 sessions, 113 versions, and 22 traces. A separate local size exercise added representative synthetic traces containing the full prompt and context; 46 traces produced a 3,023,552-byte envelope while the archive remained valid. This exercise demonstrates the cap, not a forecast of how many future real interactions fit.

Vercel documents a **4.5 MB request and response payload limit**. Raising only the request parser limit would therefore leave both deployment transport and GET reload vulnerable to rejection. Source checked on 2026-10-16: [Vercel Functions limits](https://vercel.com/docs/functions/limitations).

Implemented `packages/transport/workspace.ts:1` and integrated it into `apps/api/workspace.ts:14` and `apps/web/workspace-sync.ts:43`:

- The browser sends binary gzip PUT bodies and requests gzip GET responses using `application/vnd.merhav.workspace+gzip`. Binary gzip avoids the approximately one-third size overhead of wrapping compressed bytes in base64 JSON.
- The wire body remains bounded to 3,000,000 bytes in each direction; decoded JSON is bounded to 25,000,000 UTF-8 bytes. Both readers count actual streamed bytes. Declared oversized bodies are rejected before reading; malformed gzip, malformed JSON, and invalid UTF-8 fail closed.
- This is application-level compression, with no HTTP `Content-Encoding` header. Decoding therefore remains under the application's explicit decoded-size bound instead of relying on an intermediary or fetch's transparent decompression.
- PUT validates the entire archive with `importState`, then checks that the future GET envelope can also be encoded within the limits, reserving 1,024 bytes for envelope variation before the CAS write (`apps/api/workspace.ts:70`). Nothing is shortened, pruned, or omitted to make a save fit.
- Legacy JSON requests and GET responses remain supported below the original 3 MB wire bound. A large workspace requires the updated client. No database schema change or additional service was introduced.

Compression changes capacity, not unlimited storage. Incompressible content can reach the 3 MB compressed cap before the 25 MB decoded cap. Either rejection preserves the previous server snapshot and leaves the current edit unconfirmed in memory. Browser/runtime support for `CompressionStream` and `DecompressionStream` is required by the updated client and needs to be included in the browser verification.

## What is preserved and what a save confirms

The server stores the whole validated `PortalState` in one JSONB row (`apps/api/workspace-store.ts:67`). This includes sources, messages, all retained document versions, pending drafts, draft history, preferences, and full trace prompt/context/response content. The transport does not rebuild a reduced archive. The >4.5 MB fictional round-trip test compares the loaded state with the complete original state, including 70 traces and successive manually edited note versions (`tests/workspace.test.ts:75`).

The row is the **current workspace snapshot**, not a database revision archive. Document and draft history are fields inside that snapshot. They do not independently recover an accidentally lost database row or an explicitly replaced workspace. Operator backups remain a separate durability responsibility; no backup service or history table was added in this scope.

Writes use a server-selected owner workspace and an atomic expected-revision condition. The initial insert succeeds only for revision 0; later updates require the current revision (`apps/api/workspace-store.ts:72`). The client accepts an acknowledgement only when its revision equals the expected revision plus one (`apps/web/workspace-sync.ts:173`). Queued saves retain the latest complete state; a lost acknowledgement retains the original revision so a retry cannot silently overwrite a competing save. A 409 stops automatic saving; a 401 requires login. Ordinary network/availability failures preserve authentication and allow an explicit retry.

## Reload and loss boundaries

The reviewed App keeps its workspace, token, and confirmed baseline in memory (`apps/web/App.tsx:43`); the reviewed entry, workspace, and editor modules contain no automatic localStorage, sessionStorage, or IndexedDB persistence. A fresh login reads the server before permitting workspace use. An empty new server workspace is not editable until its initial save succeeds (`apps/web/App.tsx:280`).

Unconfirmed edits and unsaved document-editor buffers are protected by a beforeunload warning and explicit UI messages, but **closing, crashing, or forcibly reloading the tab can lose that unconfirmed work** (`apps/web/App.tsx:109`). Server-only storage necessarily has this boundary. The UI offers explicit export from the in-memory workspace during authentication and server failures; an exported file is user-requested output, not automatic browser persistence. An unsaved open document-editor buffer is not included in JSON export; the conflict dialog states this and prevents replacing the workspace until that edit is saved or cancelled (`apps/web/App.tsx:416`).

When server and in-memory copies diverge, the App asks the user to choose; it does not silently merge or overwrite. Reconnecting the in-memory copy requires a fresh server read matching the remembered baseline, followed by the ordinary CAS save (`apps/web/App.tsx:285`, `apps/web/workflow-guards.ts:13`). The save label compares the newest visible state to the acknowledged snapshot, so an older acknowledgement cannot label a newer unsent edit as saved.

One expected initialization limitation remains: `store.load` returns revision 0/null for both a never-created workspace and a missing/deleted server row (`apps/api/workspace-store.ts:55`). On a fresh tab these are indistinguishable and the App seeds the fictional fixtures as first setup. There is no automatic application deletion route, but this behavior does not solve operator/database loss. An already open tab retains its copy and allows export or continued unsaved work when the remote state disappears; it does not automatically recreate the missing row from that copy.

## Remaining contract limits

Archive validity, transportability, and model-context validity are different contracts:

| Boundary | Current limit and implication |
|---|---|
| Archive import | `importState` accepts at most 25,000,000 JavaScript characters and validates item counts and provenance (`packages/domain/index.ts:427`). |
| Server transfer | At most 25,000,000 decoded UTF-8 bytes, including the envelope, and 3,000,000 compressed bytes. A valid Hebrew-heavy import can therefore be larger than the transfer bound. It is rejected as too large; no evidence is discarded. |
| Per-session retained history | Archive schema caps messages at 500, traces at 200, and draft history at 100 (`packages/domain/index.ts:424`). Compression does not remove those schema caps. Future growth beyond them needs an explicit archive-policy change, not silent pruning. |
| Model request | The model request is bounded to 600,000 bytes, 200 sources, 80 messages, 50 preferences, and 20 branch-scope entries (`packages/contracts/index.ts:47`, `apps/api/validation.ts:27`). A workspace can save/reload successfully while an individual model operation is too large. |

The updated App checks model-request byte size before sending and explains that no content was omitted (`apps/web/App.tsx:177`). The smaller model item-count limits remain deliberate fail-closed boundaries rather than a lossless-context scaling solution. Full histories should continue to be retained for export and review if generation is blocked.

## Local verification

On the final codec changes, these commands passed without unhandled rejections:

```text
node node_modules/vitest/vitest.mjs run --root . tests/workspace.test.ts tests/workspace-sync.test.ts tests/server-only-workflow.test.ts tests/workspace-choice.test.ts tests/workflow-guards.test.ts
59 tests passed in 5 files

npm run typecheck
tsc --noEmit passed

git diff --check -- packages/transport/workspace.ts apps/api/workspace.ts apps/web/workspace-sync.ts tests/workspace.test.ts tests/workspace-sync.test.ts
passed
```

Coverage includes full compressed archive round-trip, legacy JSON compatibility, decoded gzip overrun, corrupt gzip, oversized/corrupt server responses, authentication before body reading, atomic conflicting writes, uncertain acknowledgements, cancelled/late callbacks, temporary errors retaining authentication, and unconfirmed-work guards. These are local mocked transport/storage tests, not proof of Vercel binary-response behavior or an actual browser reload. The coordinator must verify those deployment/user boundaries before calling the complete feature done.

An independent read-only review by the UI/workflow agent found no blocking transport defect. That reviewer additionally exercised the actual `readWorkspace → WorkspaceSync → handleWorkspace` path with an in-memory fake store: empty GET at revision 0, gzip PUT, gzip GET at revision 1, and exact state-signature equality. This was also local and made no network calls.

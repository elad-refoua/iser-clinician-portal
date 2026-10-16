# Vercel setup — 2026-10-16

Global agent setup was completed using the official [Vercel onboarding guide](https://vercel.com/get-started.md). This prepares the account and tools; it does not create or deploy the portal.

## Verified state

| Component | Evidence | Status |
|---|---|---|
| Vercel CLI | `vercel --version` returned 50.35.0 | Installed |
| CLI authentication | `vercel whoami` returned `elad-refoua` | Authenticated |
| Runtime | Node.js v22.23.2 | Available |
| Vercel guidance | Official `vercel/vercel-plugin` installed with user scope through the Codex marketplace | Installed |
| Guidance enabled | User configuration contains `plugins."vercel@openai-curated"` with `enabled = true` | Enabled |
| Status command | Installed plugin contains `commands/status.md` | Command definition present; slash-menu visibility not separately tested |
| Vercel connector | Codex plugin discovery reports installed, GLOBAL, ENABLED | Available across projects |
| Documentation tool | `search_vercel_documentation` returned Vercel documentation | Passed |
| Authenticated read | `list_teams` returned success with an empty teams array | Passed; no team memberships returned |
| Reload | The connector's tools are callable in the current session | Not needed for the connector |

The connection is managed by the Codex Vercel connector. Its internal MCP configuration path is not exposed by the connector. No standalone MCP entry was added and unrelated user settings were not changed.

The older standalone Codex CLI could not parse two existing user settings. The supported in-app connector was used instead; its authenticated checks above succeeded.

## Project state

- No Vercel project was created, linked, or deployed during global onboarding, as required by the guide.
- No OpenRouter key was supplied or stored, and no paid model call was made.
- No standalone Vercel skills pack was installed alongside the plugin.
- Product implementation and deployment remain separate from this completed global setup.

## Next project steps

1. Finish reviewing the portal design and prepare the fictional demonstration and local implementation.
2. Create/link the dedicated Vercel API project when project work requires it.
3. Add `OPENROUTER_API_KEY` privately in the Vercel project's environment settings. Never put it in chat, Git, the browser bundle, exported case state, or the backstage prompt display.
4. Configure access control, server-side usage limits, and production/preview origins.
5. Verify the deployed experience in a browser before calling the portal ready.

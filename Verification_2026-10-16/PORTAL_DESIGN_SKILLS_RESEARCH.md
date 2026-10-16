# Design skills for the Hebrew clinician portal

Research date: **2026-10-16**. Read-only research; no skills installed and no application files changed. Recommendations below use the supplied portal brief, not an independent browser audit. No patient data was accessed.

**Recommendation:** use **Anthropic Frontend Design** to tighten hierarchy and layout, then **Vercel Web Design Guidelines** to review interaction and accessibility. Keep **UI/UX Pro Max** as a searchable reference for specific component decisions. The first and third skills are already available locally.

## Three strongest choices

| Skill | Verified provenance / adoption | Best use in this portal | Limitation |
|---|---|---|---|
| **[Frontend Design — Anthropic](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)** | Published in Anthropic's own skills repository. [Skills.sh reports 994.3K installs](https://skills.sh/anthropics/skills/frontend-design), observed 2026-10-16. | Establish a deliberate heading scale, reduce excessive card padding, group related information, and write short action labels and summaries in the clinician's language. The source explicitly emphasizes purposeful structure, plain copy, and restrained decoration. | Broad visual guidance, not a clinical workflow or Hebrew RTL specification. Its emphasis on visual distinctiveness needs a restrained application here. |
| **[Web Design Guidelines — Vercel](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md)** | Official Vercel skill. [Skills.sh reports 744.3K installs](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines). [GitHub API reports 32,499 stars and 2,836 forks](https://api.github.com/repos/vercel-labs/agent-skills) for the **whole collection**, observed 2026-10-16. | Audit heading order, keyboard access, visible focus, field labels, inline errors, and status messages. Particularly useful for change highlights and the manual/conversational intake-completion flow. [The source guidelines](https://vercel.com/design/guidelines) require status cues beyond color and explicit labels. | A review skill, not a component library or layout generator. It fetches current rules at review time, so record the date/version for reproducible reviews. Code review still requires a browser check of the actual flow. |
| **[UI/UX Pro Max — NextLevelBuilder](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)** | [Skills.sh reports 399.0K installs](https://skills.sh/nextlevelbuilder/ui-ux-pro-max-skill/ui-ux-pro-max). [GitHub API reports 136,377 stars and 14,496 forks](https://api.github.com/repos/nextlevelbuilder/ui-ux-pro-max-skill), observed 2026-10-16. | Searchable design guidance for dashboard/admin patterns, form states, typography, spacing, and React. Use focused queries to compare compact alternatives while preserving the existing visual identity. | Recommendations are generic and need judgment; a generated palette or font pairing is not proof of Hebrew suitability. The locally installed guide advertises fewer rules/stacks than the current upstream guide, so local and online capabilities differ. |

The numbers above are popularity signals, not user endorsements or evidence of clinical usability. Skills.sh's displayed install totals are not presented here as counts of unique users. Repository stars for a collection do not measure a particular skill's quality.

## Concrete application to the requested changes

These are **proposed adaptations**, not claims that the portal already implements them:

1. **Compactness:** reduce space between related elements and remove repetitive card containers before shrinking text. Keep a consistent spacing scale and a readable Hebrew body size. Preserve sufficient button hit areas even when the visible control is compact.
2. **Hierarchy:** separate the page title, major section headings, and subsection headings through semantic heading levels plus visibly different weight/size. Supporting sentences should sit immediately under their relevant heading rather than resemble another section.
3. **Proposed edits:** show a short plain-language summary first, followed by the actual changed passages. Pair highlighting with explicit labels such as “Added,” “Removed,” or “Revised”; color alone cannot carry the meaning. Unchanged text should not be marked as changed.
4. **Intake gaps from session 4:** present one compact completion panel with the missing-item count and two clearly named actions: manual completion and conversational completion. Keep the same underlying completion state in either route; display what remains and a clear saved state. This timing comes from the product brief, not from an external design guideline.
5. **Hebrew RTL:** retain the portal's Hebrew font and right-to-left reading order; use layout properties that follow writing direction, and verify mixed Hebrew/Latin text, dates, icons, keyboard navigation, and mobile wrapping in the browser. None of these three skills alone establishes complete RTL support.

## Why not use the local Dashboard Style skill wholesale?

The locally read [Dashboard Style skill](C:/Users/user/.agents/skills/dashboard-style/SKILL.md) is designed for dark, dense research dashboards, with tiny data labels, prominent numerical cards, and a single-file/no-dependencies architecture. Those assumptions are not a direct match for this existing React clinician-documentation portal. Its compact grouping and expandable details are useful ideas; its full theme, text scale, and architecture should not drive this revision. No public adoption measure was established for this personal skill.

## Local sources inspected

- [Frontend Design](C:/Users/user/.codex/plugins/cache/claude-plugins-official/frontend-design/local/skills/frontend-design/SKILL.md)
- [UI/UX Pro Max](C:/Users/user/.agents/skills/ui-ux-pro-max/SKILL.md)
- [Dashboard Style](C:/Users/user/.agents/skills/dashboard-style/SKILL.md)

No installation is needed to apply the two already available skills. The Vercel source can be read as a review reference without installing anything.

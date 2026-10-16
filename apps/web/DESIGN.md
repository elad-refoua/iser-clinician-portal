# מרווח — interface design, 2026-10-16

The product is a quiet place for a clinician to retain a session while it is still fresh. Its memorable element is an unusually generous writing surface, introduced by a large, direct Hebrew invitation. The record and its evidence remain reachable without competing for attention.

## Tokens

- Mist `#f0f6f4`: page background.
- Paper `#ffffff`: writing and document surfaces.
- Ink `#173e38`: headings and primary text.
- Teal `#226b60`: actions, active navigation, keyboard focus.
- Reed `#5b6f69`: supporting text.
- Line `#cfdfda`: boundaries between meaningful groups.
- Ochre `#805b25`: factual uncertainty and prepared-mode labels.

Noto Sans Hebrew carries all Hebrew typography; Arial and sans-serif are fallbacks. Display text is 38–46 px, body text 17 px, supporting text 14 px. Long text remains right aligned and has generous line height. Technical identifiers use their natural left-to-right direction only in backstage views.

## Layout comparison

Chosen: one writing column with a narrow contextual rail. The rail gives continuity without turning the workspace into a dashboard.

```text
[ brand                  patient / session     mode ]
[ session documentation | patient record | backstage ]
                 [ context rail ] [ writing page      ]
                                  [ one question      ]
                                  [ session draft     ]
```

Alternative considered: a persistent split conversation/document layout. Rejected for the opening screen because it divides attention before any draft exists. The same split structure is useful only for a user-requested comparison between versions.

At narrow widths the rail becomes a compact context disclosure. Navigation scrolls horizontally, controls wrap, and documents retain a single reading column.

## Interaction principles and brief review

The five goals are quietly active and do not become an entry wizard. Patient and session selectors are the only entry choices. The writing area supports multiple contributions before questions. A question never arrives on each paragraph; the clinician explicitly finishes sharing. A draft is always one action away. Source and version markers describe provenance rather than decorating the page. Prepared responses explicitly identify themselves. Saving status only confirms completed local writes. Loading, cancellation, errors, historical versions, proposals, and branching are distinct visible states.

The palette follows the approved teal direction. Rounded controls and one paper surface serve the writing task; repeated statistic cards, gradients, ornamental labels, and decorative illustrations are deliberately omitted. Accessible focus, 44 px targets, reduced motion, and sensible reading width are part of the base implementation.

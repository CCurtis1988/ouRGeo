# Field collection

Open **Settings → Appearance → Field collection** to use the website's
palettes with realistic nature photography. Each of the 13 themes has six
distinct still photographs: one default and five alternatives. No animation
is bundled with this collection; rendered loops can be incorporated later.

| Theme | Palette and photographic direction |
| --- | --- |
| Dev | Blue-black, cyan water and sea-glass; rough coasts and cold rivers |
| Slate | Restrained blue-grey; wet ridges, scree and slate shoreline |
| Basalt | Charcoal, mineral blue and warm seams; volcanic rock and broken terrain |
| Forest | Deep conifer and new growth; wet bark, ferns and moss |
| Trout | Olive, cream and rusty red; clear rivers and wild trout habitat |
| High Alpine | Cold granite and late sun; ridges, tarns and exposed rock |
| Wood | Walnut, muted green and ember; grain, roots and weathered timber |
| Sextant | Deep navy, brass and bone; rough water and weathered coast |
| Glacier | Pale ice and cold shadows; glacier faces, moraine and meltwater |
| Field Notes | Manila, blue ink and dry olive; sediment, grass and field geology |
| Rainproof | Buff and olive; rain, moorland and wet vegetation |
| Albany | Warm map paper, hydro blue and vegetation green; rivers and rolling land |
| Linen | Warm paper and quiet natural colour; grasses, stone and pale open landscapes |

The first eight themes are dark; Glacier through Linen are light. Switching
an app theme selects its matching code and Markdown palettes and default
basemap. Code/Markdown palette names include **· Field**, which distinguishes
the new Forest palette from the existing one. You can choose other syntax
palettes independently afterwards.

**Background images…** opens the selected theme's six photographs. Choose
one for a fixed background or several for a slideshow, then set the interval.
Linked image folders work here too. The existing Forest and other illustrated
themes remain in **Illustrated**. Settings has four tabs: **Illustrated**,
**Legacy**, **Field collection** and **Custom**. Theme Studio shows the same
collections as collapsible groups, opening the selected theme’s group. Collection tabs support Left/Right, Home and End keys and follow
theme switches made by the assistant.

The app includes every photo and thumbnail for offline use. Final stills are
1600 × 900 WebP; picker/gallery thumbnails are 320 × 180. The photographs use
natural weather, gritty textures and compositions that survive narrow editor
crops. Interface and syntax colours retain the website's hues, with contrast
adjustments for desktop text and the faint photograph layer. No remote fonts
are added.

## Artwork sources

- Default photos: `src/assets/themes/field-<website-slug>.webp`.
- Alternatives: `src/assets/themes/gallery/field-<website-slug>-1.webp` through
  `-5.webp`.
- Full prompts and built-in image-generation provenance:
  `src/assets/themes/gallery/field-prompts.json`.
- Untouched local PNG masters for video rendering:
  `.cache/field-theme-artwork/<website-slug>/`. These are authoring files,
  separate from the bundled application assets.

Theme IDs use the prefix `field-` to preserve all existing theme settings.
For example, `field-forest` and `forest` remain independent. Field Notes is
`field-field-notes`; High Alpine is `field-high-alpine`.

Implementation and verification evidence is in
[field-themes-validation.md](field-themes-validation.md).

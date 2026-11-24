# UGC Roadmap style

His ask (2026-11-24): everything made for UGC Roadmap - guides, PDFs, decks, pages for his students - uses
**the exact styling of his sales-call deck** ("UGC Roadmap Call", made with Claude), every time, without
being asked. A cream-and-black look guessed from the logo was wrong ("that's not the style").

The template: `docs/ugc-roadmap/railway_guide.py` (the students' Railway guide, 14 pages of 16:9) with the
deck's own pictures in `docs/ugc-roadmap/assets/`. Start from it.

- **Shape**: 16:9 pages (960 x 540 pt), like slides, even for a guide. Side margins 50 pt.
- **Backgrounds**: the deck's own, near-black with a soft blue glow: `bg-title.jpeg` (cover, the big road "U" on
  the right), `bg-phase.jpeg` (a step or phase), `bg-content.jpeg` (lists, tables), `bg-price.jpeg` /
  `bg-logo.jpeg` (a big centred number or the closing page, glow in the middle).
- **Colours** (the deck's theme): background `#0A0B0E`; titles `#F4F3EF`; body text `#B9BCC4`; dim text and
  page numbers `#8A8D93`; accent blue `#86A8FF`; cards `#16181D` with a thin `#2A2D35` border; lines and
  stop rings `#3A3E47`. The one bright card is the blue gradient `highlight-card.png` (`#6585F5` top left to
  `#1D40C2` bottom right) with white text.
- **Type**: Arial (Liberation Sans in PDFs here), bold titles. Title 40 pt; the small label above it in
  spaced bold capitals, blue, 13 pt ("PHASE 01", "STEP 01"); subtitle 16 pt `#B9BCC4`; card title 19-20 pt
  bold; card text 13-14 pt. Addresses and paths in mono on a `#2A2D35` chip.
- **Logo**: `logo.png` (the blue road "U" + UGC ROADMAP) bottom left of every page, about 72 pt wide; page
  number bottom right, 11 pt dim. `logo-cover.png` top left on the cover; `logo-glow.png` for a closing page.
- **Pieces**:
  - Cards in a row (3, sometimes 4), each with a round dark icon spot (blue icon or number), a spaced blue
    label ("MODULE 0"), a bold title and a line of text; the last one in the row is the blue highlight card
    when it is the key one ("CHECKPOINT", "IMPORTANT", "CHECK IT WORKED").
  - The road: `road.png` (light to bright blue band) with black dashes, white-ringed dark circles numbered
    in white on it, a blue dot at its end; labels "PHASE 01" and short text under each stop.
  - Stops top right on a step's page: small circles 1..n joined by dashes, the current one filled blue.
  - A long dark bar under the cards with a blue phone icon and one line of text.
  - Rows (a list or a table): dark bars, blue number or check icon on the left, bold white name, grey text.
  - Closing / price page: small spaced label centred, one huge white line (64 pt+), a grey line under it,
    a row of small chips with blue checks.
- **Words**: plain and short, for students.

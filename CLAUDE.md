# CLAUDE.md — Project rules for Team Coverage App

## Stack & hosting
- Vanilla HTML / CSS / JavaScript only — no frameworks, no build step
- Hosted on GitHub Pages from the `main` branch root
- Do not introduce npm, bundlers, or transpilers

## Data
- Dummy data only in this repo — no real names, addresses, or postcodes
- Team data lives in `data/teams.json`

## Diagrams
- Mermaid source files live in `/docs` (`.mmd` extension)
- To render or update a diagram:
  1. Load the `figma-generate-diagram` skill first
  2. Use the Figma MCP `generate_diagram` tool
  3. Always reuse the board's `fileKey` and replace the existing diagram node rather than adding a new one
- FigJam board URL: https://www.figma.com/board/kATGd4IjgdBoLFgsWFreCd/TeamCoverage
- FigJam fileKey: `kATGd4IjgdBoLFgsWFreCd` — reuse for all future diagrams

## Git
- Never commit or push. Leave changes uncommitted; I review and commit them myself.

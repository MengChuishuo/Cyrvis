# Companion artwork sources

These files are third-party artwork, not covered automatically by Cyrvis's
software license. `SOURCES.json` records the pinned upstream commits, paths,
authors and asset terms. Original metadata and available license texts are kept
beside each pack. `SHA256SUMS.json` records the downloaded image bytes.

## Included packs

- Awesome Codex Pet: Bugcat Capoo (lan-kehan), Bubu (Guo Beining / gbn666),
  Agumon (legeling). Default asset license is CC BY-NC 4.0; per-pet
  `submission.json` may specify different terms. Bubu declares MIT. Capoo and
  Agumon are unofficial fan artwork with character rights retained by the owners.
- Local Jarvis: four GIF states from `desktop/assets/pet`, under the repository
  MIT license (preserved in `jarvis/LICENSE`).

Review these asset terms before distributing an application containing them.
Repository source-code licenses do not override character or asset rights.

## Integrity

All downloaded image files were checked against their pinned GitHub tree blob
hashes.
Bubu's upstream `submission.json` SHA-256 is stale: the file matches the pinned
Git tree, and our `SHA256SUMS.json` records the actual verified bytes. The upstream
metadata is retained unchanged for attribution.

## Runtime adaptation

The original robot uses six PNG poses. Codex atlases use 192×208 cells, eight
columns and either nine or eleven rows. Cyrvis plays idle, waiting, review,
waving and running for its corresponding voice/task states; sleeping holds the
first idle frame because these packs have no sleep animation. Blank trailing
cells are never played. The v2 gaze rows remain available in the original atlas.

Jarvis uses its original GIF animations.

Add future packs under this directory and register them in
`src/shared/companion-skins.ts`. The right-click Appearance menu groups entries
by source automatically; the renderer includes PNG/WebP/GIF assets at build time.

# Aetherglyph Google Play assets

The `demo` and `full` directories are complete, separate upload sets.

## Upload map

For each edition:

| Play Console field | File or directory |
| --- | --- |
| App icon | `app-icon-512.png` |
| Feature graphic | `feature-graphic-1024x500.png` |
| Phone screenshots | `phone/` (7 images, 1080x1920) |
| 7-inch tablet screenshots | `tablet-7/` (7 images, 1440x2560) |
| 10-inch tablet screenshots | `tablet-10/` (7 images, 1620x2880) |
| Google Play Games on PC logo | `google-play-games-pc/logo-600x400.png` |
| Google Play Games on PC feature graphic | `google-play-games-pc/feature-graphic-1920x1080.png` |
| Google Play Games on PC screenshots | `google-play-games-pc/screenshots/` (7 images, 1920x1080) |

The demo screenshots advertise only offline tutorial, Practice vs AI, guide
shortcuts, the public spell reference, and Glyph Laboratory. The full set adds
ranked/unranked matchmaking, world rankings, AI fallback, online combat,
spectating, and private rooms.

The PC feature graphics are text-free. Their transparent 600x400 companion
logos contain the game name as required by Google Play Games on PC.

## Source art

Supplied originals are preserved under `assets/source/`:

- `demo-icon.png`
- `demo-feature.png`
- `full-icon.png`
- `full-banner.png`

## Regeneration and validation

```powershell
npm run play-assets
npm run play-assets:validate
```

`asset-inventory.json` records dimensions, formats, transparency, and file
sizes. Static art and representative screenshots were also visually reviewed.

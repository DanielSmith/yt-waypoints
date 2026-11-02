# YT Waypoints icon

Generated with the built-in image-generation tool on 2026-11-02, with
`transparent_background: true`. No reference images were used.

The untouched generated master is `yt-waypoints-icon-master.png`. Browser PNGs
in `src/shared/icons/` were exported from it using ImageMagick, for example:

```sh
magick assets/yt-waypoints-icon-master.png -resize 32x32 src/shared/icons/icon-32.png
```

Repeat at 16, 32, 48, 96, and 128 pixels as needed, then rebuild both extensions.
ImageMagick is only needed to export new icon sizes; ordinary extension builds
copy the checked-in PNGs and require only Python.

## Exact generation prompt

Create one polished browser-extension app icon for a product called YT Waypoints. Output a single centered square icon, transparent background, no text or letters. Concept: a small stylized map with THREE waypoints connected by a simple angular route, visually fused with a filmstrip. Strong clean flat vector-like graphic, bold geometry designed to remain recognizable at 16 and 32 pixels. A nearly square dark deep-teal film frame with softly rounded corners and THREE large pale rectangular sprocket holes along EACH vertical side. In its center, a simple pale mint folded-map shape with two subtle fold divisions. Across the map, a bold warm vermilion route connects three large round waypoints, one upper-left, one center-right, one lower-left. Keep the route uncluttered and the three waypoints clear. Very limited palette: deep teal, pale mint/ivory, vermilion. Large shapes, thick strokes, no tiny map roads, no lettering, no YouTube logo, no play triangle, no photography, no perspective, no 3D, no glow, no drop shadow, no gradients, no surrounding scenery. Face-on, balanced centered silhouette that fills about 90 percent of the image, transparent outer margin. Produce exactly one final icon, not a presentation board or multiple variants.

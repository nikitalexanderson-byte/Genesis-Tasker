# Bundled native design assets

GENESIS Android 3.2.4 uses the licensed Inter family for all UI roles and official Lucide icons. Source Serif 4 remains bundled unmodified with its license. The assets work offline and add no dependency.

- **Inter**: official Google Fonts `ofl/inter` original full variable TTF, SIL Open Font License 1.1; see `inter-OFL.txt`.
- **Source Serif 4**: official Google Fonts `ofl/sourceserif4` original full variable TTF, SIL Open Font License 1.1; see `sourceserif4-OFL.txt`.
- **Lucide**: official `lucide-static@1.61.0` npm package, ISC License; see `lucide-LICENSE`. Source SVG paths/primitives are converted mechanically to Android VectorDrawable, preserving the 24-unit geometry, stroke width 2, round caps/joins, and source fill when present. No new icon geometry was drawn.

`genesis-assets-manifest.json` records the pinned Google Fonts commit, upstream URLs, source and converted SHA-256 hashes, byte counts, icon names and path counts. `generate-native-assets.py` reproduces the asset download/conversion and verifies all Russian upper/lowercase Cyrillic letters including Ё/ё using fontTools. The copied fonts remain unmodified; Compose selects wght and opsz axes.

Reproduce: `python android/third-party-licenses/generate-native-assets.py` (network + fontTools). This helper is a development tool, not a runtime dependency. Include the three license notices with redistributed APKs.

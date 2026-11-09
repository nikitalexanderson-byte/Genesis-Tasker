/** Recolors green and neutral shadows while preserving gold and warm highlights. */
export function PaletteArtFilter() {
  return <svg aria-hidden="true" focusable="false" width="0" height="0" className="palette-art-filter">
    <defs><filter id="genesis-palette-art" colorInterpolationFilters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix" result="green-mask" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -10 10 0 0 0.35" />
      <feFlood floodColor="var(--palette-art-tint)" result="palette-tone" />
      <feComposite in="palette-tone" in2="green-mask" operator="in" result="green-tone" />
      <feBlend in="green-tone" in2="SourceGraphic" mode="color" />
    </filter>
    <filter id="genesis-daylight-art" colorInterpolationFilters="sRGB">
      <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="daylight-monochrome" />
      <feFlood floodColor="var(--day-art-tint)" result="daylight-tone" />
      <feBlend in="daylight-monochrome" in2="daylight-tone" mode="screen" result="daylight-art" />
      <feComposite in="daylight-art" in2="SourceGraphic" operator="in" />
    </filter>
    <filter id="genesis-blue-silver-art" colorInterpolationFilters="sRGB">
      <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="silver-art" />
      <feColorMatrix in="SourceGraphic" type="matrix" result="cool-mask" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -10 10 0 0 0.35" />
      <feFlood floodColor="var(--palette-art-tint)" result="blue-tone" />
      <feComposite in="blue-tone" in2="cool-mask" operator="in" result="blue-shadows" />
      <feBlend in="blue-shadows" in2="silver-art" mode="color" />
    </filter></defs>
  </svg>;
}

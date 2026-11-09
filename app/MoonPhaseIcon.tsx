const MOON_RADIUS = 46;

export const MOON_PHASE_STEPS = 30;

export function MoonPhaseIcon({
  phaseStep,
  size = 24,
  className = "",
}: {
  phaseStep: number;
  size?: number;
  className?: string;
}) {
  const step = ((Math.round(phaseStep) % MOON_PHASE_STEPS) + MOON_PHASE_STEPS) % MOON_PHASE_STEPS;
  const fraction = step / MOON_PHASE_STEPS;
  const waxing = fraction < 0.5;
  const firstQuarter = fraction < 0.25;
  const lastQuarter = fraction >= 0.75;
  const terminatorRadius = Math.abs(Math.cos(fraction * Math.PI * 2)) * MOON_RADIUS;
  const litHalf = waxing
    ? `M 50 4 A ${MOON_RADIUS} ${MOON_RADIUS} 0 0 1 50 96 Z`
    : `M 50 4 A ${MOON_RADIUS} ${MOON_RADIUS} 0 0 0 50 96 Z`;
  const terminatorIsLight = waxing ? !firstQuarter : !lastQuarter;

  return (
    <svg
      className={`moon-phase-icon ${className}`.trim()}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      focusable="false"
      aria-hidden="true"
    >
      <circle className="moon-phase-shadow" cx="50" cy="50" r={MOON_RADIUS} />
      {step === 0 ? null : step === MOON_PHASE_STEPS / 2 ? (
        <circle className="moon-phase-light" cx="50" cy="50" r={MOON_RADIUS} />
      ) : (
        <>
          <path className="moon-phase-light" d={litHalf} />
          <ellipse
            className={terminatorIsLight ? "moon-phase-light" : "moon-phase-shadow"}
            cx="50"
            cy="50"
            rx={terminatorRadius}
            ry={MOON_RADIUS}
          />
        </>
      )}
      <circle className="moon-phase-rim" cx="50" cy="50" r={MOON_RADIUS} />
    </svg>
  );
}

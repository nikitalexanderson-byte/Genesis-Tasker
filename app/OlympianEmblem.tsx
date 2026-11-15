type EmblemState = 'rest' | 'hover' | 'pressed';

/** One responsive geometry: a circle of nine points gathers around a tetractys. */
export function OlympianEmblem({ state }: { state: EmblemState }) {
  const radius = state === 'pressed' ? 18 : state === 'hover' ? 26 : 24;
  const turn = state === 'hover' ? 20 : state === 'pressed' ? 60 : 0;
  const dots = Array.from({ length: 9 }, (_, index) => {
    const angle = ((index * 40 + turn - 90) * Math.PI) / 180;
    return { x: 32 + Math.cos(angle) * radius, y: 32 + Math.sin(angle) * radius };
  });
  return <svg className="olympian-emblem" data-motion={state} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <circle className="olympian-emblem-orbit" cx="32" cy="32" r="24" />
    <path className="olympian-emblem-triangle" d="M32 15 47 42H17Z" />
    <g className="olympian-emblem-tetractys">{[1,2,3,4].flatMap((count,row) => Array.from({length:count},(_,col) => <circle key={`${row}-${col}`} cx={32 + (col-(count-1)/2)*6} cy={22+row*5.2} r="1.45" />))}</g>
    {dots.map((dot,index) => <circle className="olympian-emblem-point" key={index} cx={dot.x} cy={dot.y} r={index % 3 === 0 ? 2.3 : 1.45} />)}
    <path className="olympian-emblem-spark" d="m49 8 1.8 4.2L55 14l-4.2 1.8L49 20l-1.8-4.2L43 14l4.2-1.8Z" />
  </svg>;
}

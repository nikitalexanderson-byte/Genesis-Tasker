export function ProjectsHeroMark({ shared = false }: { shared?: boolean }) {
  return <span className={`projects-hero-mark${shared ? " projects-hero-mark-shared" : ""}`} aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none" focusable="false">
      {shared ? <>
        <path className="projects-mark-tree" d="M5 38V9h12l4 4h22v25H5Z" />
        <circle cx="20" cy="23" r="3" /><circle cx="29" cy="23" r="3" />
        <path d="M14 34v-2a6 6 0 0 1 12 0v2m3-6a6 6 0 0 1 6 6" />
      </> : <>
        <path className="projects-mark-tree" d="M5 38V9h12l4 4h22v25H5Z" />
        <path className="projects-mark-tree" d="M24 18v8M12 26h24M12 26v7M24 26v7M36 26v7" />
        <circle cx="12" cy="33" r="2" /><circle cx="24" cy="33" r="2" /><circle cx="36" cy="33" r="2" />
      </>}
    </svg>
  </span>;
}

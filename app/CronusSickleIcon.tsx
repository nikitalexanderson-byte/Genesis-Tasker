type CronusSickleIconProps = {
  size?: number;
  className?: string;
};

export function CronusSickleIcon({ size = 24, className = "" }: CronusSickleIconProps) {
  const classes = ["cronus-sickle-icon", className].filter(Boolean).join(" ");

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 64 116"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      shapeRendering="geometricPrecision"
    >
      <path
        className="cronus-sickle-blade"
        d="M7.5 18.5C17.7 8.1 31.5 4.8 43.8 9.5 56.6 14.4 63 28.4 60.8 42.2 58.4 57.2 49.5 69.4 35.2 78.5l-4 2.6c-1.9 1.3-2.6 3.5-2.1 5.7h-5.8c-.7-4.3 1.2-8.4 4.8-11.1l4.6-3.3c12.7-9.1 19.5-20.6 19.8-33.3.3-11.7-5-21.3-14.1-25.5-9.3-4.4-19.8-2.5-30.9 4.9Z"
      />
      <path className="cronus-sickle-binding" d="M25.2 88h12.5l1.9 5H23.5l1.7-5Z" />
      <path className="cronus-sickle-handle" d="M25.5 94h12.1l-1.4 8.2 1.3 8.1c.5 3-2 4.8-6 4.8-3.9 0-6.3-1.8-5.9-4.8l1.1-8.1-2.5-5.8 1.3-2.4Z" />
    </svg>
  );
}

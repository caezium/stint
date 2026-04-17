interface Props {
  size?: number;
  className?: string;
  /** When true, renders just the mark without the wordmark. */
  markOnly?: boolean;
}

/**
 * Stint logo: an abstract apex/chicane line in red, with the wordmark
 * "Stint" in a clean sans. The mark is an S-curve rendered as two sweeping
 * arcs — the shape a car carves through a chicane.
 */
export function StintLogo({ size = 28, className = "", markOnly = false }: Props) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="stint-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(0 84% 60%)" />
            <stop offset="100%" stopColor="hsl(14 91% 55%)" />
          </linearGradient>
        </defs>
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="8"
          fill="url(#stint-mark)"
        />
        <path
          d="M 9 22 Q 9 12, 16 16 Q 23 20, 23 10"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.95"
        />
        <circle cx="9" cy="22" r="1.8" fill="white" />
        <circle cx="23" cy="10" r="1.8" fill="white" />
      </svg>
      {!markOnly && (
        <span className="font-semibold tracking-tight text-foreground">
          Stint
        </span>
      )}
    </span>
  );
}

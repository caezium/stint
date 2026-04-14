"use client";

interface LoadingProps {
  message?: string;
  className?: string;
}

export function Loading({ message = "Loading...", className = "" }: LoadingProps) {
  return (
    <div className={`flex items-center justify-center py-12 ${className}`}>
      <div className="flex items-center gap-3 text-muted-foreground">
        <svg
          className="animate-spin h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <span className="text-sm">{message}</span>
      </div>
    </div>
  );
}

export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-zinc-800 rounded animate-pulse"
          style={{ width: `${80 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

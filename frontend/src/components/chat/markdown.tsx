"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { EvidenceLink } from "@/components/evidence-link";

interface Props {
  children: string;
  /**
   * When supplied, `stint://lap/N?pct=X` markdown links are rendered as
   * `<EvidenceLink>` so the user can jump into the analysis workspace at
   * the cited point. Pass from any message/narrative whose citations
   * should be interactive.
   */
  sessionId?: string;
}

/** Parse `stint://lap/5?pct=45` → `{ lapNum: 5, distancePct: 45 }`. */
function parseStintHref(
  href: string,
): { lapNum: number; distancePct: number | null } | null {
  if (!href.startsWith("stint://lap/")) return null;
  try {
    // URL() needs a real origin for the path/search parsing to work cleanly.
    const u = new URL(href.replace("stint://", "https://stint.local/"));
    // Path is `/lap/<N>`
    const m = u.pathname.match(/^\/lap\/(\d+)$/);
    if (!m) return null;
    const lapNum = Number(m[1]);
    if (!Number.isFinite(lapNum)) return null;
    const pctRaw = u.searchParams.get("pct");
    const distancePct = pctRaw != null ? Number(pctRaw) : null;
    return {
      lapNum,
      distancePct: distancePct != null && Number.isFinite(distancePct) ? distancePct : null,
    };
  } catch {
    return null;
  }
}

/**
 * Compact markdown renderer used by chat bubbles and the debrief narrative.
 * GitHub-flavored markdown + LaTeX (via KaTeX).
 */
export function Markdown({ children, sessionId }: Props) {
  return (
    <div className="prose prose-sm prose-invert max-w-none break-words [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_pre]:my-2 [&_h1]:my-2 [&_h2]:my-2 [&_h3]:my-2 [&_table]:my-2 [&_code]:text-[0.85em] [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre_code]:bg-transparent [&_pre_code]:p-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) => {
          // Preserve our custom scheme — the default sanitizer drops it.
          if (url.startsWith("stint://")) return url;
          return url;
        }}
        components={{
          a: ({ href, children, ...rest }) => {
            if (href && sessionId) {
              const parsed = parseStintHref(href);
              if (parsed) {
                return (
                  <EvidenceLink
                    sessionId={sessionId}
                    lapNum={parsed.lapNum}
                    distancePct={parsed.distancePct}
                  >
                    {children}
                  </EvidenceLink>
                );
              }
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-primary hover:text-primary/80"
                {...rest}
              >
                {children}
              </a>
            );
          },
          pre: ({ children, ...rest }) => (
            <pre
              className="overflow-x-auto rounded bg-muted/60 p-2 text-[11px] leading-snug"
              {...rest}
            >
              {children}
            </pre>
          ),
          table: ({ children, ...rest }) => (
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse" {...rest}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...rest }) => (
            <th
              className="border border-border px-2 py-1 text-left font-semibold"
              {...rest}
            >
              {children}
            </th>
          ),
          td: ({ children, ...rest }) => (
            <td className="border border-border px-2 py-1 align-top" {...rest}>
              {children}
            </td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";

export function ExpandableTranscript({ text, collapseAfter = 1_200 }: { text: string; collapseAfter?: number }) {
  const [expanded, setExpanded] = useState(text.length <= collapseAfter);
  const contentId = useId();
  const isLong = text.length > collapseAfter;

  return (
    <div className="rounded-xl border border-line bg-panel-raised">
      <p
        id={contentId}
        className={`whitespace-pre-wrap break-words p-4 text-sm leading-7 text-secondary ${isLong && !expanded ? "max-h-52 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]" : "max-h-[38rem] overflow-y-auto"}`}
      >
        {text}
      </p>
      {isLong && (
        <div className="border-t border-line p-3">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-bold text-brand-content hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25"
          >
            {expanded ? <ChevronUp aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
            {expanded ? "Collapse transcript" : "Expand full transcript"}
          </button>
        </div>
      )}
    </div>
  );
}

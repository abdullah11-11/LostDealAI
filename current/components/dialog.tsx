"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Native modal semantics provide focus containment, Escape and focus restoration. */
export function Dialog({ open, onClose, title, description, children, className = "", closeDisabled = false }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; className?: string; closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} className={`product-dialog ${className}`} onCancel={event => { event.preventDefault(); if (!closeDisabled) onClose(); }} onClose={onClose}>
    <div className="flex items-start justify-between gap-4 border-b border-line p-5 sm:p-6">
      <div><h2 id={titleId} className="text-xl font-semibold tracking-tight">{title}</h2>{description && <p id={descriptionId} className="mt-2 text-base leading-6 text-secondary">{description}</p>}</div>
      <button type="button" aria-label="Close dialog" disabled={closeDisabled} onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-panel-hover"><X aria-hidden="true" className="size-5" /></button>
    </div>
    <div className="p-5 sm:p-6">{children}</div>
  </dialog>;
}

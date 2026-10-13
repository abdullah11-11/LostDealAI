"use client";

import { useSyncExternalStore } from "react";
import { DENSITIES, parseDensity, parseSidebarPreference } from "@/lib/ui/preferences";

const EVENT = "lostdeal-preferences-change";
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
function applyPreference(key: "density" | "sidebar", value: string) {
  document.documentElement.dataset[key] = value;
  try { localStorage.setItem(`lostdeal-${key}`, value); } catch { /* Preference remains usable without storage. */ }
  window.dispatchEvent(new Event(EVENT));
}
const densitySnapshot = () => parseDensity(document.documentElement.dataset.density);
const sidebarSnapshot = () => parseSidebarPreference(document.documentElement.dataset.sidebar);

export function DensitySelector() {
  const density = useSyncExternalStore(subscribe, densitySnapshot, () => "comfortable");
  return <select aria-label="Table density" value={density} onChange={event => applyPreference("density", parseDensity(event.target.value))} className="min-h-11 rounded-lg border border-line-strong bg-panel px-3 text-sm text-content">
    {DENSITIES.map(value => <option key={value} value={value}>{value === "compact" ? "Compact" : "Comfortable"}</option>)}
  </select>;
}

export function useSidebarPreference() {
  const sidebar = useSyncExternalStore(subscribe, sidebarSnapshot, () => "expanded");
  return { collapsed: sidebar === "collapsed", toggle: () => applyPreference("sidebar", sidebar === "collapsed" ? "expanded" : "collapsed") };
}

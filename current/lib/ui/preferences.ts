export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = typeof DENSITIES[number];
export type SidebarPreference = "expanded" | "collapsed";

export function parseDensity(value: unknown): Density {
  return value === "compact" ? "compact" : "comfortable";
}

export function parseSidebarPreference(value: unknown): SidebarPreference {
  return value === "collapsed" ? "collapsed" : "expanded";
}

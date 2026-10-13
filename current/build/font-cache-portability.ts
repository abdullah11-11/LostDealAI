import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import type { Plugin } from "vite";

/** Vinext caches absolute font paths. Re-root reused cache CSS before compiling. */
export async function makeFontCachePortable(cacheRoot: string): Promise<void> {
  const root = resolve(cacheRoot);
  let directories;
  try { directories = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of directories) {
    if (!entry.isDirectory()) continue;
    const path = join(cacheRoot, entry.name, "style.css");
    let css: string;
    try { css = await readFile(path, "utf8"); } catch { continue; }
    const matches = [...css.matchAll(/url\((?:["'])?([^)"']+\.(?:woff2?|ttf|otf))(?:["'])?\)/g)];
    for (const match of matches) {
      const oldPath = match[1].replaceAll("\\", "/");
      const marker = "/.vinext/fonts/";
      const suffix = oldPath.includes(marker) ? oldPath.slice(oldPath.indexOf(marker) + marker.length) : null;
      const target = suffix ? resolve(root, suffix) : resolve(root, entry.name, oldPath);
      const withinRoot = relative(root, target);
      if (!withinRoot || withinRoot === ".." || withinRoot.startsWith(".." + sep) || isAbsolute(withinRoot)) {
        throw new Error("Invalid font cache path");
      }
      await access(target);
      // Vinext matches its native cache-root string before replacing it with the
      // served font namespace. Keep that prefix intact; the URL suffix uses /.
      css = css.replace(match[0], "url(" + root + "/" + withinRoot.replaceAll("\\", "/") + ")");
    }
    await writeFile(path, css);
  }
}
/** Keep tracked cache source portable after success or a failed build. */
export async function makeFontCacheRelative(cacheRoot: string): Promise<void> {
  let directories;
  try { directories = await readdir(cacheRoot, { withFileTypes: true }); } catch { return; }
  for (const entry of directories) {
    if (!entry.isDirectory()) continue;
    const path = join(cacheRoot, entry.name, "style.css");
    let css: string;
    try { css = await readFile(path,"utf8"); } catch { continue; }
    css = css.replace(/url\((?:["'])?([^)"']+)(?:["'])?\)/g, (match, oldPath: string) => {
      const normalized = oldPath.replaceAll("\\", "/");
      const marker = "/.vinext/fonts/";
      const index = normalized.indexOf(marker);
      if (index === -1) return match;
      const suffix = normalized.slice(index + marker.length);
      return suffix.startsWith(entry.name + "/") ? "url(" + suffix.slice(entry.name.length + 1) + ")" : match;
    });
    await writeFile(path,css);
  }
}
export function portableFontCache(): Plugin {
  return {
    name: "lostdeal-portable-font-cache",
    apply: "build",
    async configResolved(config) { await makeFontCachePortable(resolve(config.root, ".vinext/fonts")); },
  };
}

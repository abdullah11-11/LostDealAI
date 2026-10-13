import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { makeFontCachePortable, makeFontCacheRelative } from "../build/font-cache-portability";
import { _rewriteCachedFontCssToServedUrls } from "../node_modules/vinext/dist/plugins/fonts.js";

async function withCache(run: (root: string, cache: string, style: string) => Promise<void>) {
  const work = resolve("work/font-cache-tests");
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(join(work, "fixture-"));
  const cache = join(root, ".vinext", "fonts");
  const style = join(cache, "fixture", "style.css");
  try {
    await mkdir(join(cache, "fixture"), { recursive: true });
    await run(root, cache, style);
  } finally {
    const contained = relative(work, root);
    assert.ok(contained && contained !== ".." && !contained.startsWith(".." + sep) && !isAbsolute(contained));
    await rm(root, { recursive: true, force: true });
  }
}

test("native build cache paths are stable and cleanup restores original relative bytes", async () => {
  await withCache(async (_root, cache, style) => {
    const names = ["a.woff2", "b.woff", "c.ttf", "d.otf", "..safe.woff2"];
    for (const name of names) await writeFile(join(cache, "fixture", name), "font fixture");
    const original = Buffer.from("/* cached font styles */\r\n" + names.map(name => `src:url(${name});`).join("\r\n") + "\r\n");
    await writeFile(style, original);
    await makeFontCachePortable(cache);
    const expected = original.toString().replace(/url\(([^)]+)\)/g,
      (_match, name: string) => `url(${cache}/fixture/${name})`);
    assert.equal(await readFile(style, "utf8"), expected);
    await makeFontCachePortable(cache);
    assert.equal(await readFile(style, "utf8"), expected);
    await makeFontCacheRelative(cache);
    assert.deepEqual(await readFile(style), original);
  });
});

test("cached Windows, UNC and POSIX checkout paths re-root to the current font file", async () => {
  await withCache(async (_root, cache, style) => {
    await writeFile(join(cache, "fixture", "a.woff2"), "font fixture");
    for (const old of [
      "C:\\previous\\checkout\\.vinext\\fonts\\fixture\\a.woff2",
      "\\\\previous-host\\checkout\\.vinext\\fonts\\fixture\\a.woff2",
      "C:/previous/checkout/.vinext/fonts/fixture/a.woff2",
      "/previous/checkout/.vinext/fonts/fixture/a.woff2",
    ]) {
      await writeFile(style, `src:url("${old}")`);
      await makeFontCachePortable(cache);
      assert.equal(await readFile(style, "utf8"), `src:url(${cache}/fixture/a.woff2)`);
      await makeFontCacheRelative(cache);
      assert.equal(await readFile(style, "utf8"), "src:url(a.woff2)");
    }
  });
});

test("pinned font plugin rewrites native cache paths to real served font URLs", async () => {
  await withCache(async (_root, cache, style) => {
    await writeFile(join(cache, "fixture", "a.woff2"), "font fixture");
    await writeFile(style, "src:url(a.woff2)");
    await makeFontCachePortable(cache);
    const prepared = await readFile(style, "utf8");
    for (const assetsDir of ["assets", "custom-assets"]) {
      const served = _rewriteCachedFontCssToServedUrls(prepared, cache, assetsDir);
      assert.equal(served, `src:url(/${assetsDir}/_vinext_fonts/fixture/a.woff2)`);
      assert.doesNotMatch(served, /\\|\.vinext|[A-Za-z]:\//);
      const fontSuffix = served.match(/_vinext_fonts\/([^)]+)/)?.[1];
      assert.equal(await readFile(join(cache, fontSuffix!), "utf8"), "font fixture");
    }
  });
});

test("cleanup accepts previous Windows and POSIX cache prefixes", async () => {
  await withCache(async (_root, cache, style) => {
    for (const old of ["C:\\old\\.vinext\\fonts/fixture/a.woff2", "/old/.vinext/fonts/fixture/a.woff2"]) {
      await writeFile(style, `src:url(${old})`);
      await makeFontCacheRelative(cache);
      assert.equal(await readFile(style, "utf8"), "src:url(a.woff2)");
    }
  });
});

test("traversal and a sibling cache with the same prefix stay outside the allowed cache", async () => {
  await withCache(async (root, cache, style) => {
    await writeFile(join(root, "outside.woff2"), "outside fixture");
    await mkdir(join(root, ".vinext", "fonts-sibling"), { recursive: true });
    await writeFile(join(root, ".vinext", "fonts-sibling", "outside.woff2"), "outside fixture");
    const escapes = [
      "../../../outside.woff2",
      "..\\..\\..\\outside.woff2",
      "../../fonts-sibling/outside.woff2",
      "/previous/.vinext/fonts/../../outside.woff2",
      "C:\\previous\\.vinext\\fonts\\..\\..\\outside.woff2",
      join(root, "outside.woff2").replaceAll("\\", "/"),
    ];
    if (process.platform === "win32") {
      const otherDrive = resolve(cache).startsWith("Z:") ? "Y:" : "Z:";
      escapes.push(`${otherDrive}/outside.woff2`, "\\\\other-host\\share\\outside.woff2");
    }
    for (const escape of escapes) {
      const css = `src:url(${escape})`;
      await writeFile(style, css);
      await assert.rejects(makeFontCachePortable(cache), /Invalid font cache path/);
      assert.equal(await readFile(style, "utf8"), css);
    }
  });
});

test("missing packaged font fails without rewriting cached styles", async () => {
  await withCache(async (_root, cache, style) => {
    const original = "src:url(missing.woff2)";
    await writeFile(style, original);
    await assert.rejects(makeFontCachePortable(cache), { code: "ENOENT" });
    assert.equal(await readFile(style, "utf8"), original);
  });
});

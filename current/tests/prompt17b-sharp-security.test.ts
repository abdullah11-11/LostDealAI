import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32">
  <rect width="64" height="32" fill="#ffffff" />
  <rect x="16" y="8" width="32" height="16" fill="#ff7418" />
</svg>`);

const makePng = () => sharp(svg).png().toBuffer();

test("the installed image processor and every locked sharp copy use the exact security patch", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    overrides: Record<string, unknown>;
  };
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };
  assert.equal(manifest.overrides.sharp, "0.35.5");
  assert.equal(sharp.versions.sharp, "0.35.5");
  const copies = Object.entries(lock.packages).filter(([path]) => /(?:^|\/)node_modules\/sharp$/.test(path));
  assert.ok(copies.length > 0);
  for (const [path, entry] of copies) assert.equal(entry.version, "0.35.5", path);
});

test("the patched native processor decodes a synthetic SVG and produces a valid PNG", async () => {
  const source = await sharp(svg).metadata();
  assert.equal(source.format, "svg");
  assert.equal(source.width, 64);
  assert.equal(source.height, 32);
  const png = await makePng();
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const output = await sharp(png).metadata();
  assert.equal(output.format, "png");
  assert.equal(output.width, 64);
  assert.equal(output.height, 32);
});

test("the patched processor resizes PNG to WebP while preserving representative image pixels", async () => {
  const png = await makePng();
  const webp = await sharp(png).resize(32, 16, { fit: "fill", kernel: "nearest" }).webp({ lossless: true }).toBuffer();
  const metadata = await sharp(webp).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 32);
  assert.equal(metadata.height, 16);
  const { data, info } = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x + 1) * info.channels)];
  assert.deepEqual(pixel(0, 0), [255, 255, 255, 255]);
  assert.deepEqual(pixel(16, 8), [255, 116, 24, 255]);
});

test("the patched decoder retains its explicit input pixel limit", async () => {
  const png = await makePng();
  await assert.rejects(sharp(png, { limitInputPixels: 64 }).metadata(), /pixel limit/i);
});

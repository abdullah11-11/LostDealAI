import assert from "node:assert/strict";
import test from "node:test";
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from "source-map-js";

function flatMap(): RawSourceMap {
  const generator = new SourceMapGenerator({ file: "bundle.js" });
  generator.addMapping({
    source: "source.ts",
    original: { line: 3, column: 2 },
    generated: { line: 1, column: 0 },
  });
  generator.setSourceContent("source.ts", "const value = 1;");
  return generator.toJSON();
}

test("patched source maps preserve ordinary generation and source round trips", () => {
  const consumer = new SourceMapConsumer(flatMap());
  assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 0 }), {
    source: "source.ts", line: 3, column: 2, name: null,
  });
  assert.equal(consumer.sourceContentFor("source.ts"), "const value = 1;");
  const regenerated = new SourceMapConsumer(SourceMapGenerator.fromSourceMap(consumer).toJSON());
  assert.deepEqual(regenerated.originalPositionFor({ line: 1, column: 0 }),
    consumer.originalPositionFor({ line: 1, column: 0 }));
});

test("malicious indexed source-map offsets fail before serialization can amplify work", () => {
  const indexed = (line: number, map: object = flatMap()) => ({
    version: 3, sections: [{ offset: { line, column: 0 }, map }],
  });
  for (const line of [1e14, -1, Infinity, 0.5]) {
    assert.throws(() => new SourceMapConsumer(indexed(line) as unknown as RawSourceMap), /offset/i);
  }
  assert.throws(() => new SourceMapConsumer(
    indexed(6_000_000, indexed(6_000_000)) as unknown as RawSourceMap,
  ), /offset/i);
});

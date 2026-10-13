import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type OpeningElement = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function authoredElements(path: string): OpeningElement[] {
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements: OpeningElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return elements;
}

function attribute(element: OpeningElement, name: string): string | undefined {
  const item = element.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText() === name);
  if (!item || !ts.isJsxAttribute(item) || !item.initializer) return undefined;
  if (ts.isStringLiteral(item.initializer)) return item.initializer.text;
  if (ts.isJsxExpression(item.initializer) && item.initializer.expression && ts.isStringLiteral(item.initializer.expression)) return item.initializer.expression.text;
  return undefined;
}

function mainLandmarks(elements: OpeningElement[]) {
  return elements.filter(element => element.tagName.getText() === "main" || attribute(element, "role") === "main");
}

test("the dashboard shell owns one main landmark targeted by its skip link", () => {
  const shell = authoredElements("components/dashboard-shell.tsx");
  const landmarks = mainLandmarks(shell);
  assert.equal(landmarks.length, 1);
  assert.equal(attribute(landmarks[0], "id"), "workspace-content");
  assert.ok(shell.some(element => element.tagName.getText() === "a" && attribute(element, "href") === "#workspace-content"));
  assert.equal(authoredElements("app/(dashboard)/layout.tsx").filter(element => element.tagName.getText() === "DashboardShell").length, 1);
});

test("deal success, error and loading content share the shell main landmark", () => {
  const detail = authoredElements("app/(dashboard)/deals/[id]/page.tsx");
  const loading = authoredElements("app/(dashboard)/deals/[id]/loading.tsx");
  assert.equal(mainLandmarks(detail).length, 0, "success and error branches must not add nested main landmarks");
  assert.equal(mainLandmarks(loading).length, 0, "loading content must not add a nested main landmark");
  assert.ok(detail.some(element => attribute(element, "role") === "alert"), "the load error remains announced");
  assert.ok(loading.some(element => attribute(element, "aria-busy") === "true" && attribute(element, "aria-label") === "Loading deal intelligence"));
});

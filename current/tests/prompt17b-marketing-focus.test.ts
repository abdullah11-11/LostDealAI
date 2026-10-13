import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { MARKETING_NAVIGATION } from "@/lib/marketing/content";

type Element = { type: unknown; props: Record<string, unknown> };
type KeyHandler = (event: { key: string }) => void;

function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

// Execute the authored component with controlled hooks and keyboard events, without a new DOM dependency.
function navigationFixture() {
  let open = false;
  const body = {};
  const menuLink = {};
  let activeElement = body;
  let focusCalls = 0;
  const button = { focus() { activeElement = button; focusCalls++; } };
  const ref = { current: null as null | typeof button };
  const listeners = new Set<KeyHandler>();
  let pendingEffect: (() => () => void) | undefined;
  let previousDependencies: unknown[] | undefined;
  let cleanup: (() => void) | undefined;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const modules: Record<string, unknown> = {
    "react": {
      useState: () => [open, (next: boolean | ((current: boolean) => boolean)) => { open = typeof next === "function" ? next(open) : next; }],
      useRef: () => ref,
      useEffect: (effect: () => () => void, dependencies: unknown[]) => {
        if (!previousDependencies || dependencies.some((value, index) => value !== previousDependencies![index])) {
          pendingEffect = effect;
          previousDependencies = [...dependencies];
        }
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { ArrowUpRight: "icon", Menu: "icon", X: "icon" },
    "next/link": { __esModule: true, default: "a" },
    "@/components/brand-logo": { BrandLogo: "logo" },
    "@/lib/marketing/content": { MARKETING_NAVIGATION },
    "@/components/marketing/marketing-primitives": { marketingButtonStyles: () => "button" },
  };
  const exports: { MarketingHeader?: () => Element } = {};
  const authored = readFileSync("components/marketing/marketing-header.tsx", "utf8");
  const compiled = ts.transpileModule(authored, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => { assert.ok(name in modules, `Unexpected component dependency: ${name}`); return modules[name]; },
    window: {
      addEventListener: (type: string, handler: KeyHandler) => { assert.equal(type, "keydown"); listeners.add(handler); },
      removeEventListener: (type: string, handler: KeyHandler) => { assert.equal(type, "keydown"); listeners.delete(handler); },
    },
  });

  function render() {
    assert.ok(exports.MarketingHeader);
    const tree = elements(exports.MarketingHeader());
    const toggle = tree.find(element => element.type === "button")!;
    const navigation = tree.find(element => element.props.id === "marketing-mobile-navigation")!;
    assert.equal(toggle.props.ref, ref, "focus restoration must target the rendered disclosure button");
    ref.current = button;
    if (navigation.props.hidden && activeElement === menuLink) activeElement = body;
    if (pendingEffect) { cleanup?.(); cleanup = pendingEffect(); pendingEffect = undefined; }
    return { toggle, navigation };
  }
  render();
  return {
    button, menuLink,
    render,
    open() { const { toggle } = render(); (toggle.props.onClick as () => void)(); return render(); },
    focusMenuLink() { assert.equal(render().navigation.props.hidden, false); activeElement = menuLink; },
    press(key: string) { for (const handler of [...listeners]) handler({ key }); return render(); },
    active: () => activeElement,
    focusCalls: () => focusCalls,
    unmount() { cleanup?.(); assert.equal(listeners.size, 0); },
  };
}

test("Escape closes an open marketing menu and restores focus from its link to the disclosure button", () => {
  const fixture = navigationFixture();
  try {
    assert.equal(fixture.open().toggle.props["aria-expanded"], true);
    fixture.focusMenuLink();
    const closed = fixture.press("Escape");
    assert.equal(closed.navigation.props.hidden, true);
    assert.equal(closed.toggle.props["aria-expanded"], false);
    assert.equal(fixture.active(), fixture.button);
    assert.equal(fixture.focusCalls(), 1);
  } finally { fixture.unmount(); }
});

test("other keys leave the open marketing menu and its current focus unchanged", () => {
  const fixture = navigationFixture();
  try {
    fixture.open();
    fixture.focusMenuLink();
    assert.equal(fixture.press("Tab").navigation.props.hidden, false);
    assert.equal(fixture.active(), fixture.menuLink);
    assert.equal(fixture.focusCalls(), 0);
  } finally { fixture.unmount(); }
});

test("Escape with a closed marketing menu leaves unrelated focus unchanged", () => {
  const fixture = navigationFixture();
  try {
    const previous = fixture.active();
    assert.equal(fixture.press("Escape").navigation.props.hidden, true);
    assert.equal(fixture.active(), previous);
    assert.equal(fixture.focusCalls(), 0);
  } finally { fixture.unmount(); }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  MOBILE_ICON_DEFINITIONS,
  createSVGIcon,
  createSVGIconFactory,
} from "../runtime/static/ui/icons/index.js";

const makeDocument = () => ({
  createElementNS(_namespace, type) {
    return {
      type,
      attributes: {},
      children: [],
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      appendChild(child) {
        this.children.push(child);
      },
    };
  },
});

test("SVG factory builds themed path nodes and fallback icons", () => {
  const documentObject = makeDocument();
  const icon = createSVGIcon("screenshot", "shortcut-icon", { documentObject });
  assert.equal(icon.type, "svg");
  assert.equal(icon.attributes.class, "shortcut-icon");
  assert.equal(icon.attributes["aria-hidden"], "true");
  assert.equal(icon.children.length, 2);
  assert.equal(icon.children[0].attributes.stroke, "currentColor");
  const fallback = createSVGIcon("unknown", "", { documentObject });
  assert.equal(fallback.children.length, MOBILE_ICON_DEFINITIONS.default.paths.length);
});

test("icon factory preserves injected definitions and document ownership", () => {
  const documentObject = makeDocument();
  const definitions = {
    custom: { viewBox: "0 0 1 1", paths: [{ d: "M0 0", fill: "red" }] },
    default: { paths: [] },
  };
  const factory = createSVGIconFactory({ documentObject, definitions });
  const icon = factory("custom");
  assert.equal(icon.attributes.viewBox, "0 0 1 1");
  assert.equal(icon.children[0].attributes.fill, "red");
  assert.equal(icon.children[0].attributes.stroke, undefined);
});

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MENU_ICON_PATH = "M216.615385 295.384615h586.830769c15.753846 0 31.507692-11.815385 31.507692-31.507692s-15.753846-31.507692-31.507692-31.507692H216.615385c-19.692308 0-31.507693 11.815385-31.507693 31.507692s15.753846 31.507692 31.507693 31.507692zM803.446154 480.492308H216.615385c-19.692308 0-31.507693 11.815385-31.507693 31.507692s15.753846 31.507693 31.507693 31.507692h586.830769c19.692308 0 31.507692-11.815385 31.507692-31.507692s-15.753846-31.507692-31.507692-31.507692zM803.446154 724.676923H216.615385c-19.692308 0-31.507693 11.815385-31.507693 31.507692s15.753846 31.507693 31.507693 31.507693h586.830769c15.753846 0 31.507692-11.815385 31.507692-31.507693s-15.753846-31.507692-31.507692-31.507692z";

export const MOBILE_ICON_DEFINITIONS = Object.freeze({
  menu: { viewBox: "0 0 1024 1024", paths: [{ d: MENU_ICON_PATH, fill: "currentColor" }] },
  screenshot: { paths: [{ d: "M4 7h3l1.5-2h7L17 7h3v12H4z" }, { d: "M12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" }] },
  arrowUp: { paths: [{ d: "M12 19V5" }, { d: "M6 11l6-6 6 6" }] },
  arrowDown: { paths: [{ d: "M12 5v14" }, { d: "M6 13l6 6 6-6" }] },
  arrowLeft: { paths: [{ d: "M19 12H5" }, { d: "M11 6l-6 6 6 6" }] },
  arrowRight: { paths: [{ d: "M5 12h14" }, { d: "M13 6l6 6-6 6" }] },
  slash: { paths: [{ d: "M7 19L17 5" }] },
  copy: { paths: [{ d: "M8 8h10v12H8z" }, { d: "M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }] },
  paste: { paths: [{ d: "M9 4h6l1 2h2v15H6V6h2z" }, { d: "M9 4h6" }, { d: "M9 10h6" }, { d: "M9 14h6" }] },
  tab: { paths: [{ d: "M4 12h15" }, { d: "M14 7l5 5-5 5" }] },
  enter: { paths: [{ d: "M5 6v6h14" }, { d: "M15 8l4 4-4 4" }] },
  shiftTab: { paths: [{ d: "M19 12H4" }, { d: "M9 7l-5 5 5 5" }] },
  pageUp: { paths: [{ d: "M5 17V7" }, { d: "M2 10l3-3 3 3" }, { d: "M11 17h8" }, { d: "M11 12h8" }, { d: "M11 7h8" }] },
  pageDown: { paths: [{ d: "M5 7v10" }, { d: "M2 14l3 3 3-3" }, { d: "M11 17h8" }, { d: "M11 12h8" }, { d: "M11 7h8" }] },
  swap: { paths: [{ d: "M7 7h12l-3-3" }, { d: "M17 17H5l3 3" }] },
  zoomIn: { paths: [{ d: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z" }, { d: "M16 16l5 5" }, { d: "M10.5 7v6" }, { d: "M7.5 10h6" }] },
  zoomOut: { paths: [{ d: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z" }, { d: "M16 16l5 5" }, { d: "M7.5 10h6" }] },
  home: { paths: [{ d: "M4 11l8-7 8 7" }, { d: "M6 10v10h12V10" }] },
  end: { paths: [{ d: "M5 4v16" }, { d: "M19 4v16" }, { d: "M8 12h8" }, { d: "M13 7l5 5-5 5" }] },
  attachment: { paths: [{ d: "M8 12l5-5a3 3 0 0 1 4 4l-6 6a5 5 0 0 1-7-7l6-6" }] },
  tabAdd: { paths: [{ d: "M12 5v14" }, { d: "M5 12h14" }, { d: "M4 4h7" }] },
  "select-all": { paths: [{ d: "M5 5h14v14H5z" }, { d: "M8 8h8v8H8z" }] },
  search: { paths: [{ d: "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" }, { d: "M16 16l5 5" }] },
  "open-link": { paths: [{ d: "M14 4h6v6" }, { d: "M20 4l-9 9" }, { d: "M11 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" }] },
  "copy-link": { paths: [{ d: "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" }, { d: "M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" }] },
  rename: { paths: [{ d: "M4 20h4l11-11-4-4L4 16z" }, { d: "M13 7l4 4" }, { d: "M4 4h7" }] },
  "move-first": { paths: [{ d: "M5 5v14" }, { d: "M19 12H8" }, { d: "M12 8l-4 4 4 4" }] },
  "move-left": { paths: [{ d: "M19 12H5" }, { d: "M9 8l-4 4 4 4" }] },
  "move-right": { paths: [{ d: "M5 12h14" }, { d: "M15 8l4 4-4 4" }] },
  "move-last": { paths: [{ d: "M19 5v14" }, { d: "M5 12h11" }, { d: "M12 8l4 4-4 4" }] },
  "close-others": { paths: [{ d: "M4 7h8v8H4z" }, { d: "M12 9h8v8h-8z" }, { d: "M15 12l3 3" }, { d: "M18 12l-3 3" }] },
  "split-vertical": { paths: [{ d: "M4 5h16v14H4z" }, { d: "M12 5v14" }] },
  "split-horizontal": { paths: [{ d: "M4 5h16v14H4z" }, { d: "M4 12h16" }] },
  "pane-new-tab": { paths: [{ d: "M4 6h10v10H4z" }, { d: "M14 9h6v9H9v-2" }, { d: "M13 5h6v6" }, { d: "M19 5l-7 7" }] },
  theme: { paths: [{ d: "M12 21a9 9 0 1 1 9-9c0 1.7-1.3 3-3 3h-1.5a2 2 0 0 0-1.8 2.8l.2.4A2 2 0 0 1 13.1 21z" }, { d: "M7.5 10.5h.01" }, { d: "M10 7.5h.01" }, { d: "M14 7.5h.01" }, { d: "M16.5 10.5h.01" }] },
  "close-pane": { paths: [{ d: "M4 5h16v14H4z" }, { d: "M9 9l6 6" }, { d: "M15 9l-6 6" }] },
  "close-tab": { paths: [{ d: "M5 7h14l1 4v6H4v-6z" }, { d: "M9 10l6 6" }, { d: "M15 10l-6 6" }] },
  default: { paths: [{ d: "M12 5v14" }, { d: "M5 12h14" }] },
});

export function createSVGIcon(
  name,
  className = "",
  { documentObject = globalThis.document, definitions = MOBILE_ICON_DEFINITIONS } = {},
) {
  const definition = definitions[name] || definitions.default;
  const svg = documentObject.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", definition.viewBox || "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (className) {
    svg.setAttribute("class", className);
  }
  for (const pathAttrs of definition.paths || []) {
    const path = documentObject.createElementNS(SVG_NAMESPACE, "path");
    const hasFill = Object.prototype.hasOwnProperty.call(pathAttrs, "fill");
    const hasStroke = Object.prototype.hasOwnProperty.call(pathAttrs, "stroke");
    if (!hasFill && !hasStroke) {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
    }
    for (const [key, value] of Object.entries(pathAttrs)) {
      path.setAttribute(key, value);
    }
    svg.appendChild(path);
  }
  return svg;
}

export function createSVGIconFactory({ documentObject = globalThis.document, definitions = MOBILE_ICON_DEFINITIONS } = {}) {
  return (name, className = "") => createSVGIcon(name, className, { documentObject, definitions });
}

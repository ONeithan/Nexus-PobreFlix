var TOMATO_ICON_SRC = "./slider/src/images/tomato.svg";
var TOMATO_ICON_FILTER = "drop-shadow(0 1px 2px rgba(0,0,0,0.55))";
var REPEAT_ONE_SVG_PATHS = "\n  <g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\">\n    <path d=\"m17 2l4 4l-4 4\" />\n    <path d=\"M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4l4-4\" />\n    <path d=\"M21 13v1a4 4 0 0 1-4 4H3m8-8h1v4\" />\n  </g>\n";

function joinStyles(styles) {
  return styles.filter(Boolean).join("; ");
}

function getTomatoInlineStyle(size, style = "") {
  return joinStyles([
    "width:" + (size),
    "height:" + (size),
    "display:inline-block",
    "object-fit:contain",
    "pointer-events:none",
    "vertical-align:-.075em",
    "padding: var(--padding-fa)",
    "filter:" + (TOMATO_ICON_FILTER),
    style
  ]);
}

export function getTomatoIconHtml({ className = "", size = "1.4em", style = "" } = {}) {
  var classes = ["jms-tomato-icon", className].filter(Boolean).join(" ");
  return "<img src=\"" + (TOMATO_ICON_SRC) + "\" class=\"" + (classes) + "\" alt=\"\" aria-hidden=\"true\" style=\"" + (getTomatoInlineStyle(size, style)) + "\">";
}

export function createTomatoIconElement({ className = "", size = "1.4em", style = "" } = {}) {
  var icon = document.createElement("img");
  icon.src = TOMATO_ICON_SRC;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  icon.className = ["jms-tomato-icon", className].filter(Boolean).join(" ");
  icon.style.cssText = getTomatoInlineStyle(size, style);
  return icon;
}

export function getRepeatOneIconHtml({ className = "", size = "1.4em", style = "" } = {}) {
  var classes = ["jms-repeat-one-icon", className].filter(Boolean).join(" ");
  var inlineStyle = joinStyles([
    "width:" + (size),
    "height:" + (size),
    "display:inline-block",
    "flex:0 0 auto",
    "vertical-align:-.075em",
    style
  ]);

  return "<svg viewBox=\"0 0 24 24\" class=\"" + (classes) + "\" aria-hidden=\"true\" focusable=\"false\" style=\"" + (inlineStyle) + "\">" + (REPEAT_ONE_SVG_PATHS) + "</svg>";
}

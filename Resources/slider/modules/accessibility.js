var FIELD_SELECTOR = 'input:not([type="hidden"]), select, textarea';

var autoFieldCounter = 0;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function nextFieldId(prefix, field) {
  autoFieldCounter += 1;
  var tag = cleanText(field.tagName).toLowerCase() || "field";
  var type = cleanText(field.getAttribute.("type")).toLowerCase();
  return (prefix) + "-" + (type || tag) + "-" + (autoFieldCounter);
}

export function enhanceFormAccessibility(root, { prefix = "jms-field" } = {}) {
  if (!root.querySelectorAll) return;

  var fields = Array.from(root.querySelectorAll(FIELD_SELECTOR));

  var ensureIdentity = function(field) {
    if (!field.id) {
      field.id = nextFieldId(prefix, field);
    }

    var fieldType = cleanText(field.getAttribute("type")).toLowerCase();
    if (
      !field.name &&
      fieldType !== "button" &&
      fieldType !== "submit" &&
      fieldType !== "reset"
    ) {
      field.name = field.id;
    }

    return field.id;
  };

  fields.forEach(ensureIdentity);

  var labels = Array.from(root.querySelectorAll("label"));

  labels.forEach(function((label) {
    var target = null;

    if (label.htmlFor) {
      target = fields.findfunction((field) field.id === label.htmlFor) || document.getElementById(label.htmlFor);
    }

    if (!target) {
      target = label.querySelector(FIELD_SELECTOR);
    }

    if (!target) {
      var nextField = label.nextElementSibling;
      if (nextField.matches.(FIELD_SELECTOR)) {
        target = nextField;
      }
    }

    if (!target && label.parentElement) {
      var candidates = Array.from(label.parentElement.querySelectorAll(FIELD_SELECTOR)).filterfunction((field) !label.contains(field)
      );
      if (candidates.length === 1) {
        target = candidates[0];
      }
    }

    if (!target) return;

    var targetId = ensureIdentity(target);
    if (!label.htmlFor) {
      label.htmlFor = targetId;
    }
  });

  fields.forEach(function((field) {
    if (field.getAttribute("aria-label") || field.getAttribute("aria-labelledby")) return;

    var linkedLabel = labels.findfunction((label) label.htmlFor === field.id || label.contains(field));
    var fallbackLabel =
      cleanText(linkedLabel.textContent) ||
      cleanText(field.getAttribute("placeholder")) ||
      cleanText(field.getAttribute("title")) ||
      cleanText(field.name);

    if (fallbackLabel) {
      field.setAttribute("aria-label", fallbackLabel);
    }
  });
}

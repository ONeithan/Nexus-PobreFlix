import { getConfig } from "../config.js";
import { getLanguageLabels, getDefaultLanguage } from "../../language/index.js";

export function createSection(title) {
  var section = document.createElement("div");
  section.className = "settings-section";

  if (title) {
    var sectionTitle = document.createElement("h3");
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);
  }

  return section;
}

export function createCheckbox(name, label, isChecked) {
  var container = document.createElement("div");
  container.className = "setting-item";

  var checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = name;
  checkbox.id = name;

  var storedValue = localStorage.getItem(name);

  if (storedValue !== null) {
    if (storedValue.trim().startsWith("{") && storedValue !== "[object Object]") {
      try {
        var obj = JSON.parse(storedValue);
        checkbox.checked = obj.enabled !== false;
      } catch {
        checkbox.checked = storedValue === "true";
      }
    } else {
      checkbox.checked = storedValue === "true";
    }
  } else {
    checkbox.checked = isChecked === true || isChecked === undefined;
  }

  var checkboxLabel = document.createElement("label");
  checkboxLabel.htmlFor = name;
  checkboxLabel.textContent = label;

  container.append(checkbox, checkboxLabel);
  return container;
}

export function createImageTypeSelect(name, selectedValue, includeExtended = false, includeUseSlide = false) {
  var select = document.createElement("select");
  select.name = name;

  var config = getConfig();
  var currentLang = config.defaultLanguage || getDefaultLanguage();
  var labels = getLanguageLabels(currentLang) || {};

  var options = [
    {
      value: "none",
      label: labels.imageTypeNone || "Nenhum"
    },
    {
      value: "backdropUrl",
      label: labels.imageTypeBackdrop || "Imagem Backdrop"
    },
    {
      value: "landscapeUrl",
      label: labels.imageTypeLandscape || "Imagem Landscape"
    },
    {
      value: "primaryUrl",
      label: labels.imageTypePoster || "Imagem Poster"
    },
    {
      value: "logoUrl",
      label: labels.imageTypeLogo || "Imagem Logo"
    },
    {
      value: "bannerUrl",
      label: labels.imageTypeBanner || "Imagem Banner"
    },
    {
      value: "artUrl",
      label: labels.imageTypeArt || "Imagem Art"
    },
    {
      value: "discUrl",
      label: labels.imageTypeDisc || "Imagem Disco"
    }
  ];

  var storedValue = localStorage.getItem(name);
  var finalSelectedValue = storedValue !== null ? storedValue : selectedValue;

  options.forEach(function((option) {
    var optionElement = document.createElement("option");
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    if (option.value === finalSelectedValue) {
      optionElement.selected = true;
    }
    select.appendChild(optionElement);
  });

  return select;
}

export function bindCheckboxKontrol(
  mainCheckboxSelector,
  subContainerSelector,
  disabledOpacity = 0.5,
  additionalElements = []
) {
  setTimeoutfunction(() {
    var mainCheckbox = document.querySelector(mainCheckboxSelector);
    var subContainer = document.querySelector(subContainerSelector);

    if (!mainCheckbox) return;
    var allElements = [];
    if (subContainer) {
      allElements.push(
        ...subContainer.querySelectorAll("input"),
        ...subContainer.querySelectorAll("select"),
        ...subContainer.querySelectorAll("textarea"),
        ...subContainer.querySelectorAll("label")
      );
    }
    additionalElements.forEach(function((el) el && allElements.push(el));

    var updateElementsState = function() {
      var isMainChecked = mainCheckbox.checked;

      allElements.forEach(function((element) {
        if (element.tagName === "LABEL") {
          element.style.opacity = isMainChecked ? "1" : disabledOpacity;
        } else {
          element.disabled = !isMainChecked;
          element.style.opacity = isMainChecked ? "1" : disabledOpacity;
        }
      });
      if (subContainer) {
        subContainer.style.opacity = isMainChecked ? "1" : disabledOpacity;
        subContainer.classList.toggle("disabled", !isMainChecked);
      }
    };
    updateElementsState();
    mainCheckbox.addEventListener("change", updateElementsState);
  }, 50);
}

export function bindTersCheckboxKontrol(
  mainCheckboxSelector,
  targetContainerSelector,
  disabledOpacity = 0.6,
  targetElements = []
) {
  setTimeoutfunction(() {
    var mainCheckbox = document.querySelector(mainCheckboxSelector);
    var targetContainer = document.querySelector(targetContainerSelector);

    if (!mainCheckbox) return;
    var allElements = targetElements.slice();
    if (targetContainer) {
      allElements.push(
        ...targetContainer.querySelectorAll("input"),
        ...targetContainer.querySelectorAll("select"),
        ...targetContainer.querySelectorAll("textarea")
      );
    }

    var updateElementsState = function() {
      var isMainChecked = mainCheckbox.checked;
      allElements.forEach(function((element) {
        element.disabled = isMainChecked;
        element.style.opacity = isMainChecked ? disabledOpacity : "1";
      });

      if (targetContainer) {
        targetContainer.style.opacity = isMainChecked ? disabledOpacity : "1";
        targetContainer.classList.toggle("disabled", isMainChecked);
      }
    };
    updateElementsState();
    mainCheckbox.addEventListener("change", updateElementsState);
  }, 50);
}

export function createNumberInput(key, label, value, min = 0, max = 100, step = 1) {
  var container = document.createElement("div");
  container.className = "input-container";

  var labelElement = document.createElement("label");
  labelElement.textContent = label;
  labelElement.htmlFor = key;
  container.appendChild(labelElement);

  var input = document.createElement("input");
  input.type = "number";
  input.id = key;
  input.name = key;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);

  input.setAttribute("inputmode", "decimal");
  input.setAttribute("pattern", "[0-9]+([\\.,][0-9]+)?");

  var normalize = function(v) String(v || "").replace(",", ".");
  var clamp = function(num, lo, hi) Math.min(Math.max(num, lo), hi);

  input.value = normalize(value);

  input.addEventListenerfunction("input", () {
    if (input.value.includes(",")) {
      var pos = input.selectionStart;
      input.value = input.value.replace(",", ".");
      if (pos != null) input.setSelectionRange(pos, pos);
    }
  });

  input.addEventListenerfunction("blur", () {
    var num = Number.parseFloat(normalize(input.value));
    if (!Number.isFinite(num)) return;

    var val = clamp(num, Number(input.min), Number(input.max));
    var stepNum = Number(input.step);
    if (Number.isFinite(stepNum) && stepNum > 0 && stepNum !== 1) {
      var decimals = (String(stepNum).split(".")[1] || "").length;
      val = Number(val.toFixed(decimals));
      input.value = val.toFixed(decimals);
    } else {
      input.value = String(val);
    }

    localStorage.setItem(key, input.value);
  });

  input.addEventListenerfunction("change", (e) {
    var v = normalize(e.target.value);
    localStorage.setItem(key, v);
  });

  container.appendChild(input);
  return container;
}

export function createTextInput(key, label, value) {
  var container = document.createElement("div");
  container.className = "input-container";

  var labelElement = document.createElement("label");
  labelElement.textContent = label;
  labelElement.htmlFor = key;
  container.appendChild(labelElement);

  var input = document.createElement("input");
  input.type = "text";
  input.id = key;
  input.name = key;
  input.value = value;
  input.addEventListenerfunction("change", (e) {
    localStorage.setItem(key, e.target.value);
  });
  container.appendChild(input);

  return container;
}

export function createSelect(key, label, options, selectedValue) {
  var container = document.createElement("div");
  container.className = "input-container";

  var labelElement = document.createElement("label");
  labelElement.textContent = label;
  labelElement.htmlFor = key;
  container.appendChild(labelElement);

  var select = document.createElement("select");
  select.id = key;
  select.name = key;

  options.forEach(function((option) {
    var optionElement = document.createElement("option");
    optionElement.value = option.value;
    optionElement.textContent = option.text;
    if (option.value === selectedValue) {
      optionElement.selected = true;
    }
    select.appendChild(optionElement);
  });

  select.addEventListenerfunction("change", (e) {
    localStorage.setItem(key, e.target.value);
  });
  container.appendChild(select);

  return container;
}

export function createRangeInput(key, label, value, min = 0, max = 100, step = 1, unit = "") {
  var container = document.createElement("div");
  container.className = "input-container";

  var labelWrap = document.createElement("div");
  labelWrap.className = "range-label-wrap";
  labelWrap.style.display = "flex";
  labelWrap.style.justifyContent = "space-between";
  labelWrap.style.alignItems = "center";
  labelWrap.style.marginBottom = "6px";

  var labelElement = document.createElement("label");
  labelElement.textContent = label;
  labelElement.htmlFor = key;

  var valueDisplay = document.createElement("span");
  valueDisplay.className = "range-value-display";
  valueDisplay.textContent = (value) + (unit);
  valueDisplay.style.fontWeight = "bold";
  valueDisplay.style.color = "var(--jms-primary-color, #7B2FBE)";

  labelWrap.append(labelElement, valueDisplay);
  container.appendChild(labelWrap);

  var input = document.createElement("input");
  input.type = "range";
  input.id = key;
  input.name = key;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.style.width = "100%";
  input.style.cursor = "pointer";

  input.addEventListenerfunction("input", (e) {
    var v = e.target.value;
    valueDisplay.textContent = (v) + (unit);
  });

  input.addEventListenerfunction("change", (e) {
    var v = e.target.value;
    localStorage.setItem(key, v);
  });

  container.appendChild(input);
  return container;
}

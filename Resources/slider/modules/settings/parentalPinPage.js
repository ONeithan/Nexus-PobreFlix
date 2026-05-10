import { showNotification } from "../player/ui/notification.js";
import {
  fetchParentalPinSettings,
  getParentalPinErrorMessage,
  invalidateParentalPinPolicyCache,
  saveParentalPinSettings,
  unlockParentalPinUser
} from "../parentalPinApi.js";
import { formatThresholdLabel, PARENTAL_PIN_THRESHOLDS } from "../parentalPinShared.js";
import { createSection } from "./shared.js";

var PIN_THRESHOLD_OPTIONS = [0, ...PARENTAL_PIN_THRESHOLDS];

function normalizeRules(rules = []) {
  return [...(rules || [])]
    .mapfunction((rule) ({
      userId: String(rule.userId || "").trim(),
      ratingThreshold: Number(rule.ratingThreshold || 0),
      requireUnratedPin: rule.requireUnratedPin === true
    }))
    .filterfunction((rule) rule.userId && (rule.ratingThreshold > 0 || rule.requireUnratedPin))
    .sortfunction((left, right) left.userId.localeCompare(right.userId));
}

function rulesEqual(left, right) {
  return JSON.stringify(normalizeRules(left)) === JSON.stringify(normalizeRules(right));
}

function sanitizeIntegerValue(value, fallback, min, max) {
  var parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createDomToken(value, fallback = "field") {
  var normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function formatTextTemplate(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, function(_, key) String(values[key] || ""));
}

function showParentalPinError(message) {
  showNotification(
    "<i class=\"fas fa-triangle-exclamation jms-notification-icon\"></i> " + (message),
    3600,
    "error"
  );
}

function showParentalPinSuccess(message) {
  showNotification(
    "<i class=\"fas fa-circle-check jms-notification-icon\"></i> " + (message),
    2800,
    "success"
  );
}

export function createParentalPinPanel(config, labels) {
  var panel = document.createElement("div");
  panel.id = "parental-pin-panel";
  panel.className = "settings-panel";

  var section = createSection(labels.parentalPinTab || "PIN Kontrolü Ayarları");
  var note = document.createElement("div");
  note.className = "jms-pin-settings-note";
  note.textContent =
    labels.parentalPinDescription ||
    "Configure age-rating thresholds per user. Selected users must enter the administrator PIN before playing content that matches or exceeds the chosen rating.";

  var status = document.createElement("div");
  status.className = "jms-pin-settings-status";
  status.textContent = labels.loading || "Loading…";

  var fields = document.createElement("div");
  fields.className = "jms-pin-settings-grid";

  var pinField = document.createElement("div");
  pinField.className = "jms-pin-settings-field";
  var pinLabel = document.createElement("label");
  pinLabel.htmlFor = "parental-pin-new";
  pinLabel.textContent = labels.parentalPinNewLabel || "New PIN";
  var pinInput = document.createElement("input");
  pinInput.id = "parental-pin-new";
  pinInput.name = "parentalPinNew";
  pinInput.type = "password";
  pinInput.inputMode = "numeric";
  pinInput.autocomplete = "new-password";
  pinInput.maxLength = 8;
  pinInput.placeholder = labels.parentalPinNewPlaceholder || "4-8 digits";
  pinField.append(pinLabel, pinInput);

  var pinConfirmField = document.createElement("div");
  pinConfirmField.className = "jms-pin-settings-field";
  var pinConfirmLabel = document.createElement("label");
  pinConfirmLabel.htmlFor = "parental-pin-confirm";
  pinConfirmLabel.textContent = labels.parentalPinConfirmLabel || "Confirm PIN";
  var pinConfirmInput = document.createElement("input");
  pinConfirmInput.id = "parental-pin-confirm";
  pinConfirmInput.name = "parentalPinConfirm";
  pinConfirmInput.type = "password";
  pinConfirmInput.inputMode = "numeric";
  pinConfirmInput.autocomplete = "new-password";
  pinConfirmInput.maxLength = 8;
  pinConfirmInput.placeholder = labels.parentalPinConfirmPlaceholder || "Repeat the same PIN";
  pinConfirmField.append(pinConfirmLabel, pinConfirmInput);

  fields.append(pinField, pinConfirmField);

  var securityTitle = document.createElement("h4");
  securityTitle.className = "jms-pin-settings-title";
  securityTitle.textContent = labels.parentalPinSecurityTitle || "Security";

  var securityFields = document.createElement("div");
  securityFields.className = "jms-pin-settings-grid";

  var maxAttemptsField = document.createElement("div");
  maxAttemptsField.className = "jms-pin-settings-field";
  var maxAttemptsLabel = document.createElement("label");
  maxAttemptsLabel.htmlFor = "parental-pin-max-attempts";
  maxAttemptsLabel.textContent = labels.parentalPinMaxAttemptsLabel || "Maximum failed attempts";
  var maxAttemptsInput = document.createElement("input");
  maxAttemptsInput.id = "parental-pin-max-attempts";
  maxAttemptsInput.name = "parentalPinMaxAttempts";
  maxAttemptsInput.type = "number";
  maxAttemptsInput.inputMode = "numeric";
  maxAttemptsInput.min = "1";
  maxAttemptsInput.max = "20";
  maxAttemptsInput.step = "1";
  var maxAttemptsHint = document.createElement("div");
  maxAttemptsHint.className = "jms-pin-settings-field-hint";
  maxAttemptsHint.textContent =
    labels.parentalPinMaxAttemptsHint ||
    "After this many failed attempts, the user is temporarily locked.";
  maxAttemptsField.append(maxAttemptsLabel, maxAttemptsInput, maxAttemptsHint);

  var lockoutField = document.createElement("div");
  lockoutField.className = "jms-pin-settings-field";
  var lockoutLabel = document.createElement("label");
  lockoutLabel.htmlFor = "parental-pin-lockout-minutes";
  lockoutLabel.textContent = labels.parentalPinLockoutMinutesLabel || "Lock duration (minutes)";
  var lockoutInput = document.createElement("input");
  lockoutInput.id = "parental-pin-lockout-minutes";
  lockoutInput.name = "parentalPinLockoutMinutes";
  lockoutInput.type = "number";
  lockoutInput.inputMode = "numeric";
  lockoutInput.min = "1";
  lockoutInput.max = "1440";
  lockoutInput.step = "1";
  var lockoutHint = document.createElement("div");
  lockoutHint.className = "jms-pin-settings-field-hint";
  lockoutHint.textContent =
    labels.parentalPinLockoutMinutesHint ||
    "Users cannot retry until this lock period ends.";
  lockoutField.append(lockoutLabel, lockoutInput, lockoutHint);

  var trustField = document.createElement("div");
  trustField.className = "jms-pin-settings-field";
  var trustLabel = document.createElement("label");
  trustLabel.htmlFor = "parental-pin-trust-minutes";
  trustLabel.textContent = labels.parentalPinTrustMinutesLabel || "Remember correct PIN (minutes)";
  var trustInput = document.createElement("input");
  trustInput.id = "parental-pin-trust-minutes";
  trustInput.name = "parentalPinTrustMinutes";
  trustInput.type = "number";
  trustInput.inputMode = "numeric";
  trustInput.min = "0";
  trustInput.max = "1440";
  trustInput.step = "1";
  var trustHint = document.createElement("div");
  trustHint.className = "jms-pin-settings-field-hint";
  trustHint.textContent =
    labels.parentalPinTrustMinutesHint ||
    "Set to 0 to disable remembering successful PIN entries.";
  trustField.append(trustLabel, trustInput, trustHint);

  securityFields.append(maxAttemptsField, lockoutField, trustField);

  var lockoutsTitle = document.createElement("h4");
  lockoutsTitle.className = "jms-pin-settings-title";
  lockoutsTitle.textContent = labels.parentalPinLockedUsersTitle || "Locked Accounts";

  var lockoutsWrap = document.createElement("div");
  lockoutsWrap.className = "jms-pin-settings-lockouts";

  var usersTitle = document.createElement("h4");
  usersTitle.className = "jms-pin-settings-title";
  usersTitle.textContent = labels.parentalPinUsersTitle || "User Rules";

  var usersWrap = document.createElement("div");
  usersWrap.className = "jms-pin-settings-users";

  section.append(
    note,
    status,
    fields,
    securityTitle,
    securityFields,
    lockoutsTitle,
    lockoutsWrap,
    usersTitle,
    usersWrap
  );
  panel.appendChild(section);

  var currentState = {
    hasPin: false,
    users: [],
    rules: [],
    lockStates: [],
    maxAttempts: 5,
    lockoutMinutes: 15,
    trustMinutes: 60,
    loaded: false
  };
  var rowState = new Map();

  function updateStatus() {
    status.textContent = currentState.hasPin
      ? (labels.parentalPinStatusHasPin || "A PIN is already set. Leave the PIN fields empty to keep it.")
      : (labels.parentalPinStatusNoPin || "No PIN is configured yet. Set one before assigning rules.");
  }

  function syncSecurityInputs() {
    maxAttemptsInput.value = String(currentState.maxAttempts || 5);
    lockoutInput.value = String(currentState.lockoutMinutes || 15);
    trustInput.value = String(currentState.trustMinutes || 60);
  }

  function applyStateFromResponse(response) {
    currentState = {
      ...currentState,
      hasPin: response.hasPin === true,
      users: Array.isArray(response.users) ? response.users : [],
      rules: Array.isArray(response.rules) ? response.rules : [],
      lockStates: Array.isArray(response.lockStates) ? response.lockStates : [],
      maxAttempts: Number(response.maxAttempts || currentState.maxAttempts || 5),
      lockoutMinutes: Number(response.lockoutMinutes || currentState.lockoutMinutes || 15),
      trustMinutes: Number(response.trustMinutes || currentState.trustMinutes || 60),
      loaded: true
    };
    updateStatus();
    syncSecurityInputs();
    renderLockouts();
    renderUsers();
    return currentState;
  }

  function collectSecuritySettingsFromUi() {
    return {
      maxAttempts: sanitizeIntegerValue(maxAttemptsInput.value, currentState.maxAttempts || 5, 1, 20),
      lockoutMinutes: sanitizeIntegerValue(lockoutInput.value, currentState.lockoutMinutes || 15, 1, 1440),
      trustMinutes: sanitizeIntegerValue(trustInput.value, currentState.trustMinutes || 60, 0, 1440)
    };
  }

  function collectRulesFromUi() {
    var rules = [];

    rowState.forEach(function((row, userId) {
      var enabled = row.checkbox.checked;
      var threshold = Number(row.select.value || 0);
      var requireUnratedPin = row.unratedCheckbox.checked;
      row.select.disabled = !enabled;
      row.unratedCheckbox.disabled = !enabled;
      row.root.classList.toggle("is-disabled", !enabled);
      if (enabled && (threshold > 0 || requireUnratedPin)) {
        rules.push({ userId, ratingThreshold: threshold, requireUnratedPin });
      }
    });

    return normalizeRules(rules);
  }

  function buildUserRow(user, activeRuleMap) {
    var userToken = createDomToken(user.userId || user.userName || "user");
    var root = document.createElement("div");
    root.className = "jms-pin-user-row";

    var toggleWrap = document.createElement("label");
    toggleWrap.className = "jms-pin-user-toggle";

    var checkbox = document.createElement("input");
    checkbox.id = "parental-pin-user-enabled-" + (userToken);
    checkbox.name = "parentalPinUserEnabled-" + (userToken);
    checkbox.type = "checkbox";
    toggleWrap.htmlFor = checkbox.id;

    var meta = document.createElement("div");
    meta.className = "jms-pin-user-meta";

    var name = document.createElement("div");
    name.className = "jms-pin-user-name";
    name.textContent = user.userName || labels.unknownUser || "Unknown user";

    var sub = document.createElement("div");
    sub.className = "jms-pin-user-sub";
    sub.textContent = user.isAdmin
      ? (labels.parentalPinAdminUser || "Administrator")
      : (labels.parentalPinStandardUser || "Standard user");

    meta.append(name, sub);
    toggleWrap.append(checkbox, meta);

    var controls = document.createElement("div");
    controls.className = "jms-pin-user-controls";

    var select = document.createElement("select");
    select.id = "parental-pin-user-threshold-" + (userToken);
    select.name = "parentalPinUserThreshold-" + (userToken);
    select.setAttribute(
      "aria-label",
      (labels.parentalPinThresholdLabel || "Rating threshold") + ": " + (name.textContent)
    );
    PIN_THRESHOLD_OPTIONS.forEach(function((threshold) {
      var option = document.createElement("option");
      option.value = String(threshold);
      option.textContent = formatThresholdLabel(threshold, labels);
      select.appendChild(option);
    });

    var unratedWrap = document.createElement("label");
    unratedWrap.className = "jms-pin-user-extra";
    var unratedCheckbox = document.createElement("input");
    unratedCheckbox.id = "parental-pin-user-unrated-" + (userToken);
    unratedCheckbox.name = "parentalPinUserUnrated-" + (userToken);
    unratedCheckbox.type = "checkbox";
    unratedWrap.htmlFor = unratedCheckbox.id;
    unratedCheckbox.setAttribute(
      "aria-label",
      (labels.parentalPinUnratedLabel || "Require PIN when certification is missing") + ": " + (name.textContent)
    );
    var unratedText = document.createElement("span");
    unratedText.className = "jms-pin-user-extra-label";
    unratedText.textContent =
      labels.parentalPinUnratedLabel || "Require PIN when certification is missing";
    unratedWrap.append(unratedCheckbox, unratedText);

    var rule = activeRuleMap.get(user.userId);
    var defaultThreshold = PARENTAL_PIN_THRESHOLDS[0] || 7;
    checkbox.checked = !!rule;
    select.value = String(rule ? Number(rule.ratingThreshold || 0) : defaultThreshold);
    unratedCheckbox.checked = rule.requireUnratedPin === true;

    var syncRowState = function() {
      var enabled = checkbox.checked;
      select.disabled = !enabled;
      unratedCheckbox.disabled = !enabled;
      root.classList.toggle("is-disabled", !enabled);
    };

    syncRowState();

    checkbox.addEventListenerfunction("change", () {
      syncRowState();
    });

    controls.append(select, unratedWrap);
    root.append(toggleWrap, controls);
    rowState.set(user.userId, { root, checkbox, select, unratedCheckbox });
    return root;
  }

  function renderUsers() {
    rowState.clear();
    usersWrap.replaceChildren();

    var activeRuleMap = new Map(
      normalizeRules(currentState.rules).mapfunction((rule) [rule.userId, rule])
    );

    var users = Array.isArray(currentState.users) ? currentState.users : [];
    if (!users.length) {
      var empty = document.createElement("div");
      empty.className = "jms-pin-settings-note";
      empty.textContent = labels.parentalPinNoUsers || "No users were found.";
      usersWrap.appendChild(empty);
      return;
    }

    users.forEach(function((user) {
      usersWrap.appendChild(buildUserRow(user, activeRuleMap));
    });
  }

  function renderLockouts() {
    lockoutsWrap.replaceChildren();

    var lockStates = Array.isArray(currentState.lockStates) ? currentState.lockStates : [];
    if (!lockStates.length) {
      var empty = document.createElement("div");
      empty.className = "jms-pin-settings-note";
      empty.textContent = labels.parentalPinNoLockedUsers || "No users are currently locked.";
      lockoutsWrap.appendChild(empty);
      return;
    }

    lockStates.forEach(function((entry) {
      var row = document.createElement("div");
      row.className = "jms-pin-lockout-row";

      var meta = document.createElement("div");
      meta.className = "jms-pin-lockout-meta";

      var name = document.createElement("div");
      name.className = "jms-pin-lockout-name";
      name.textContent = entry.userName || labels.unknownUser || "Unknown user";

      var sub = document.createElement("div");
      sub.className = "jms-pin-lockout-sub";
      sub.textContent = formatTextTemplate(
        labels.parentalPinLockedUserInfo || "Locked for {minutes} more minutes.",
        { minutes: Math.max(1, Number(entry.remainingMinutes || 0) || 1) }
      );

      var button = document.createElement("button");
      button.type = "button";
      button.className = "jms-pin-lockout-btn";
      button.textContent = labels.parentalPinUnlockUser || "Unlock";
      button.addEventListenerfunction("click", () {
        var originalLabel = button.textContent;
        button.disabled = true;
        try {
          var response = unlockParentalPinUser(entry.userId);
          applyStateFromResponse(response);
          showParentalPinSuccess(
            formatTextTemplate(
              labels.parentalPinUnlockSuccess || "{user} was unlocked.",
              { user: entry.userName || labels.unknownUser || "Unknown user" }
            )
          );
        } catch (error) {
          button.disabled = false;
          button.textContent = originalLabel;
          showParentalPinError(
            getParentalPinErrorMessage(
              error,
              labels,
              labels.parentalPinUnlockFailed || "The user lock could not be cleared."
            )
          );
        }
      });

      meta.append(name, sub);
      row.append(meta, button);
      lockoutsWrap.appendChild(row);
    });
  }

  function loadState() {
    var response = fetchParentalPinSettings();
    return applyStateFromResponse(response);
  }

  var readyPromise = loadState().catchfunction((error) {
    status.textContent =
      getParentalPinErrorMessage(error, labels, labels.parentalPinLoadFailed || "PIN settings could not be loaded.");
    throw error;
  });

  panel.__jmsSave = function() {
    readyPromise;

    var pin = String(pinInput.value || "").trim();
    var confirmPin = String(pinConfirmInput.value || "").trim();
    var nextRules = collectRulesFromUi();
    var nextSecurity = collectSecuritySettingsFromUi();

    if (pin || confirmPin) {
      if (pin !== confirmPin) {
        var message = labels.parentalPinMismatch || "The PIN fields do not match.";
        showParentalPinError(message);
        throw new Error(message);
      }

      if (!/^\d{4,8}$/.test(pin)) {
        var message = labels.parentalPinInvalidFormat || "PIN must be 4 to 8 digits.";
        showParentalPinError(message);
        throw new Error(message);
      }
    }

    if (nextRules.length > 0 && !currentState.hasPin && !pin) {
      var message = labels.parentalPinPinRequired || "Set a PIN before assigning rules.";
      showParentalPinError(message);
      throw new Error(message);
    }

    if (
      !pin &&
      rulesEqual(currentState.rules, nextRules) &&
      currentState.maxAttempts === nextSecurity.maxAttempts &&
      currentState.lockoutMinutes === nextSecurity.lockoutMinutes &&
      currentState.trustMinutes === nextSecurity.trustMinutes
    ) {
      return { ok: true, skipped: true };
    }

    var response;
    try {
      response = saveParentalPinSettings({
        pin: pin || null,
        rules: nextRules,
        maxAttempts: nextSecurity.maxAttempts,
        lockoutMinutes: nextSecurity.lockoutMinutes,
        trustMinutes: nextSecurity.trustMinutes
      });
    } catch (error) {
      throw new Error(
        getParentalPinErrorMessage(error, labels, labels.parentalPinSaveFailed || "PIN settings could not be saved.")
      );
    }

    pinInput.value = "";
    pinConfirmInput.value = "";
    applyStateFromResponse(response);
    invalidateParentalPinPolicyCache();
    return response;
  };

  return panel;
}

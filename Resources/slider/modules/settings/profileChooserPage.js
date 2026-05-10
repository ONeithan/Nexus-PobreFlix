import { createCheckbox, createSection, bindCheckboxKontrol } from "./shared.js";

export function createProfileChooserPanel(config, labels) {
  var panel = document.createElement("div");
  panel.id = "profile-chooser-panel";
  panel.className = "settings-panel";

  var section = createSection(labels.profileChooserHeader || "Configurações de Quem Está Assistindo");
  var enableRow = document.createElement("div");
  enableRow.className = "fsetting-item";

  var enableCb = createCheckbox(
    "enableProfileChooser",
    labels.enableProfileChooser || "Habilitar seletor de perfil (Quem está assistindo?)",
    config.enableProfileChooser
  );

  enableRow.appendChild(enableCb);

  var subWrap = document.createElement("div");
  subWrap.className = "profile-chooser-sub";

  var autoRow = document.createElement("div");
  autoRow.className = "fsetting-item profile-chooser-container";

  var autoCb = createCheckbox(
    "profileChooserAutoOpen",
    labels.profileChooserAutoOpen || "Mostrar automaticamente ao abrir a página",
    config.profileChooserAutoOpen
  );

  autoRow.appendChild(autoCb);

  var autoRuleWrap = document.createElement("div");
  autoRuleWrap.className = "profile-chooser-auto-sub";

  var autoRuleRow = document.createElement("div");
  autoRuleRow.className = "fsetting-item profile-chooser-container";

  var autoRuleCb = createCheckbox(
    "profileChooserAutoOpenRequireQuickLogin",
    labels.profileChooserAutoOpenRequireQuickLogin || "Mostrar se houver ao menos 1 login rápido",
    config.profileChooserAutoOpenRequireQuickLogin
  );

  autoRuleRow.appendChild(autoRuleCb);
  autoRuleWrap.appendChild(autoRuleRow);

  var rememberRow = document.createElement("div");
  rememberRow.className = "fsetting-item profile-chooser-container";

  var rememberCb = createCheckbox(
    "profileChooserRememberTokens",
    labels.profileChooserRememberTokens || "Lembrar tokens (Armazenamento local)",
    config.profileChooserRememberTokens
  );

  rememberRow.appendChild(rememberCb);

  var desc = document.createElement("div");
  desc.className = "description-text";
  desc.textContent =
    labels.profileChooserDesc ||
    "Esta configuração abre a tela de seleção de usuários estilo Netflix na interface do Jellyfin. A exibição automática, regras de login rápido e opções de lembrança de tokens são gerenciadas aqui.";

  subWrap.append(autoRow, autoRuleWrap, rememberRow, desc);

  section.append(enableRow, subWrap);
  panel.appendChild(section);

  bindCheckboxKontrol(
    "#enableProfileChooser",
    ".profile-chooser-sub",
    0.6,
    [autoCb, autoRuleCb, rememberCb]
  );

  bindCheckboxKontrol(
    "#profileChooserAutoOpen",
    ".profile-chooser-auto-sub",
    0.6,
    [autoRuleCb]
  );

  var enableInput = enableCb.querySelector("input");
  var autoInput = autoCb.querySelector("input");

  var syncAutoRuleVisibility = function() {
    var visible = !!(enableInput.checked && autoInput.checked);
    autoRuleWrap.style.display = visible ? "" : "none";
  };

  enableInput.addEventListener("change", syncAutoRuleVisibility);
  autoInput.addEventListener("change", syncAutoRuleVisibility);
  syncAutoRuleVisibility();

  return panel;
}

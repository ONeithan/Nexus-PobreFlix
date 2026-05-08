import { createCheckbox, createSection, bindCheckboxKontrol } from "./shared.js";

export function createProfileChooserPanel(config, labels) {
  const panel = document.createElement("div");
  panel.id = "profile-chooser-panel";
  panel.className = "settings-panel";

  const section = createSection(labels?.profileChooserHeader || "Configurações de Quem Está Assistindo");
  const enableRow = document.createElement("div");
  enableRow.className = "fsetting-item";

  const enableCb = createCheckbox(
    "enableProfileChooser",
    labels?.enableProfileChooser || "Habilitar seletor de perfil (Quem está assistindo?)",
    config.enableProfileChooser
  );

  enableRow.appendChild(enableCb);

  const subWrap = document.createElement("div");
  subWrap.className = "profile-chooser-sub";

  const autoRow = document.createElement("div");
  autoRow.className = "fsetting-item profile-chooser-container";

  const autoCb = createCheckbox(
    "profileChooserAutoOpen",
    labels?.profileChooserAutoOpen || "Mostrar automaticamente ao abrir a página",
    config.profileChooserAutoOpen
  );

  autoRow.appendChild(autoCb);

  const autoRuleWrap = document.createElement("div");
  autoRuleWrap.className = "profile-chooser-auto-sub";

  const autoRuleRow = document.createElement("div");
  autoRuleRow.className = "fsetting-item profile-chooser-container";

  const autoRuleCb = createCheckbox(
    "profileChooserAutoOpenRequireQuickLogin",
    labels?.profileChooserAutoOpenRequireQuickLogin || "Mostrar se houver ao menos 1 login rápido",
    config.profileChooserAutoOpenRequireQuickLogin
  );

  autoRuleRow.appendChild(autoRuleCb);
  autoRuleWrap.appendChild(autoRuleRow);

  const rememberRow = document.createElement("div");
  rememberRow.className = "fsetting-item profile-chooser-container";

  const rememberCb = createCheckbox(
    "profileChooserRememberTokens",
    labels?.profileChooserRememberTokens || "Lembrar tokens (Armazenamento local)",
    config.profileChooserRememberTokens
  );

  rememberRow.appendChild(rememberCb);

  const desc = document.createElement("div");
  desc.className = "description-text";
  desc.textContent =
    labels?.profileChooserDesc ||
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

  const enableInput = enableCb.querySelector("input");
  const autoInput = autoCb.querySelector("input");

  const syncAutoRuleVisibility = () => {
    const visible = !!(enableInput?.checked && autoInput?.checked);
    autoRuleWrap.style.display = visible ? "" : "none";
  };

  enableInput?.addEventListener("change", syncAutoRuleVisibility);
  autoInput?.addEventListener("change", syncAutoRuleVisibility);
  syncAutoRuleVisibility();

  return panel;
}

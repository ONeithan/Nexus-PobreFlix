import { getConfig } from "../config.js";
import { createCheckbox, createSection } from "./shared.js";
import { applySettings } from "./applySettings.js";

const config = getConfig();

export function createNotificationsPanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'notifications-panel';
    panel.className = 'settings-panel';

    const section = createSection(labels.notificationsSettings || 'Configurações de Notificações');

    const enableCheckbox = createCheckbox(
    'enableNotifications',
    labels.enableNotifications || 'Ícone de Notificações',
    config.enableNotifications
);
    section.appendChild(enableCheckbox);

    const enableToastNewCheckbox = createCheckbox(
    'enableToastNew',
    labels.enableToastNew || 'Toast para novidades',
    config.enableToastNew
);
    section.appendChild(enableToastNewCheckbox);


    const enableToastSystemCheckbox = createCheckbox(
    'enableToastSystem',
    labels.enableToastSystem || 'Toast para sistema',
    config.enableToastSystem
);
    section.appendChild(enableToastSystemCheckbox);

    const enableCounterSystemCheckbox = createCheckbox(
    'enableCounterSystem',
    labels.enableCounterSystem || 'Incluir sistema no contador',
    config.enableCounterSystem
);
    section.appendChild(enableCounterSystemCheckbox);

    const maxNotificationsDiv = document.createElement('div');
    maxNotificationsDiv.className = 'setting-item limit-container';

    const maxNotificationsLabel = document.createElement('label');
    maxNotificationsLabel.textContent = labels.maxNotifications || 'Limite de notificações:';

    const maxNotificationsInput = document.createElement('input');
    maxNotificationsInput.type = 'number';
    maxNotificationsInput.value = typeof config.maxNotifications !== 'undefined' ? config.maxNotifications : 15;
    maxNotificationsInput.name = 'maxNotifications';
    maxNotificationsInput.min = 1;
    maxNotificationsInput.max = 100;

    maxNotificationsLabel.htmlFor = 'maxNotificationsInput';
    maxNotificationsInput.id = 'maxNotificationsInput';
    maxNotificationsDiv.append(maxNotificationsLabel, maxNotificationsInput);
    section.appendChild(maxNotificationsDiv);

    const toastDurationDiv = document.createElement('div');
    toastDurationDiv.className = 'setting-item limit-container';

    const toastDurationLabel = document.createElement('label');
    toastDurationLabel.textContent = labels.toastDuration || 'Duração do Toast (ms):';

    const toastDurationInput = document.createElement('input');
    toastDurationInput.type = 'number';
    toastDurationInput.value = typeof config.toastDuration !== 'undefined' ? config.toastDuration : 4000;
    toastDurationInput.name = 'toastDuration';
    toastDurationInput.min = 1000;
    toastDurationInput.max = 20000;

    toastDurationLabel.htmlFor = 'toastDurationInput';
    toastDurationInput.id = 'toastDurationInput';
    toastDurationDiv.append(toastDurationLabel, toastDurationInput);
    section.appendChild(toastDurationDiv);

    const toastGroupThresholdDiv = document.createElement('div');
    toastGroupThresholdDiv.className = 'setting-item limit-container';

    const toastGroupThresholdLabel = document.createElement('label');
    toastGroupThresholdLabel.textContent = labels.toastGroupThreshold || 'Limite de Notificações:';

    const toastGroupThresholdInput = document.createElement('input');
    toastGroupThresholdInput.type = 'number';
    toastGroupThresholdInput.value = typeof config.toastGroupThreshold !== 'undefined' ? config.toastGroupThreshold : 15;
    toastGroupThresholdInput.name = 'toastGroupThreshold';
    toastGroupThresholdInput.min = 1;
    toastGroupThresholdInput.max = 10;

    toastGroupThresholdLabel.htmlFor = 'toastGroupThresholdInput';
    toastGroupThresholdInput.id = 'toastGroupThresholdInput';
    toastGroupThresholdDiv.append(toastGroupThresholdLabel, toastGroupThresholdInput);
    section.appendChild(toastGroupThresholdDiv);

    const enableRenderResumeCheckbox = createCheckbox(
    'enableRenderResume',
    labels.enableRenderResume || "Exibir 'Continuar Assistindo'",
    config.enableRenderResume
);
    section.appendChild(enableRenderResumeCheckbox);

    const renderResumeDiv = document.createElement('div');
    renderResumeDiv.className = 'setting-item limit-container';

    const renderResumeLabel = document.createElement('label');
    renderResumeLabel.textContent = labels.playingLimit || 'Limite de Continuar Assistindo';

    const renderResumeInput = document.createElement('input');
    renderResumeInput.type = 'number';
    renderResumeInput.value = typeof config.renderResume !== 'undefined' ? config.renderResume : 10;
    renderResumeInput.name = 'renderResume';
    renderResumeInput.min = 1;
    renderResumeInput.max = 30;

    renderResumeLabel.htmlFor = 'renderResumeInput';
    renderResumeInput.id = 'renderResumeInput';
    renderResumeDiv.append(renderResumeLabel, renderResumeInput);
    section.appendChild(renderResumeDiv);

    panel.appendChild(section);
    return panel;
}

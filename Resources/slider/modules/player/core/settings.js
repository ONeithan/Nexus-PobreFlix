import { getConfig } from "../../config.js";
import { getLanguageLabels, getDefaultLanguage, getStoredLanguagePreference } from '../../.././language/index.js';
import { enhanceFormAccessibility } from "../../accessibility.js";

export function createSettingsModal() {
    var config = getConfig();
    var currentLang = config.defaultLanguage || getDefaultLanguage();
    var labels = getLanguageLabels(currentLang) || {};
    var modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = 'settings-modal';
    var modalContent = document.createElement('div');
    modalContent.className = 'settings-modal-content';
    var closeBtn = document.createElement('span');
    closeBtn.className = 'settings-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = function() modal.style.display = 'none';
    var title = document.createElement('h2');
    title.textContent = labels.ayarlarBaslik || 'GP Oynatıcı Ayarları';
    var form = document.createElement('form');
    var languageDiv = document.createElement('div');
    languageDiv.className = 'setting-item';
    var languageLabel = document.createElement('label');
    languageLabel.textContent = labels.defaultLanguage || 'Dil:';
    var languageSelect = document.createElement('select');
    languageSelect.name = 'defaultLanguage';
    var uiPref = getStoredLanguagePreference() || 'auto';
    var effective = getDefaultLanguage();
    var languages = [
        { value: 'auto', label: labels.optionAuto || '🌐 Otomatik (Tarayıcı dili)' },
        { value: 'tur', label: '🇹🇷 Türkçe' },
        { value: 'eng', label: '🇬🇧 English' },
        { value: 'spa', label: labels.optionEspanol || '🇪🇸 Español' },
        { value: 'deu', label: '🇩🇪 Deutsch' },
        { value: 'fre', label: '🇫🇷 Français' },
        { value: 'rus', label: '🇷🇺 Русский' },
    ];

    languages.forEach(function(lang) {
        var option = document.createElement('option');
        option.value = lang.value;
        option.textContent = lang.label;
        languageSelect.appendChild(option);
    });

    var selectedLanguage = languages.some(function(lang) lang.value === uiPref)
        ? uiPref
        : (languages.some(function(lang) lang.value === effective) ? effective : 'auto');
    languageSelect.value = selectedLanguage;

    languageDiv.append(languageLabel, languageSelect);

    var limitDiv = document.createElement('div');
    limitDiv.className = 'setting-item';

    var limitLabel = document.createElement('label');
    limitLabel.textContent = labels.muziklimit || 'Müzik Limiti:';

    var limitInput = document.createElement('input');
    limitInput.type = 'number';
    limitInput.value = config.muziklimit || 100;
    limitInput.name = 'muziklimit';

    limitDiv.append(limitLabel, limitInput);

    var saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.textContent = labels.kaydet || 'Kaydet';
    form.append(languageDiv, limitDiv, saveBtn);
    form.onsubmit = function(e) {
        e.preventDefault();
        var formData = new FormData(form);
        var updatedConfig = {
            ...config,
            defaultLanguage: formData.get('defaultLanguage'),
            muziklimit: parseInt(formData.get('muziklimit'))
        };
        updateConfig(updatedConfig);
        modal.style.display = 'none';
        location.reload();
    };
    enhanceFormAccessibility(form, { prefix: "gmmp-settings" });
    modalContent.append(closeBtn, title, form);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    return modal;
}

export function initSettings() {
    var modal = createSettingsModal();

    return {
        open: function() { modal.style.display = 'block'; },
        close: function() { modal.style.display = 'none'; }
    };
}

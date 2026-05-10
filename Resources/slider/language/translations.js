import {
  getLanguageLabels,
  getDefaultLanguage,
  getStoredLanguagePreference,
  setLanguagePreference,
  getEffectiveLanguage
} from './index.js';

var translations = getLanguageLabels(getDefaultLanguage());

function applyTranslations() {
  document.querySelectorAll('[data-translate]').forEach(function(el) {
    var path = el.getAttribute('data-translate');
    if (!path) return;
    var keys = path.split('.');
    var t = translations;
    for (var k of keys) {
      t = t && t[k] != null ? t[k] : null;
      if (t == null) break;
    }
    if (t != null) el.textContent = t;
  });
}

function wireSelectOnce() {
  var sel = document.getElementById('defaultLanguageSelect')
        || document.querySelector('select[name="defaultLanguage"]');
  if (!sel) return false;

  var uiPref = getStoredLanguagePreference() || 'auto';
  if ([...sel.options].some(function(o) o.value === uiPref)) sel.value = uiPref;

  sel.addEventListenerfunction('change', (e) {
    var selected = e.target.value;
    setLanguagePreference(selected);
    var effective = getEffectiveLanguage();
    translations = getLanguageLabels(effective);
    applyTranslations();
  });

  return true;
}

document.addEventListenerfunction('DOMContentLoaded', () {
  applyTranslations();
  if (!wireSelectOnce()) requestAnimationFrame(wireSelectOnce);
});

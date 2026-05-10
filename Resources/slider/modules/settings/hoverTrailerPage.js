import { getConfig } from "../config.js";
import { createCheckbox, createSection, bindCheckboxKontrol, createRangeInput } from "./shared.js";
import { applySettings } from "./applySettings.js";

var cfg = getConfig();

export function createHoverTrailerPanel(config, labels) {
  var panel = document.createElement('div');
  panel.id = 'hover-panel';
  panel.className = 'settings-panel';

  var section = createSection(labels.hoverTrailer || 'HoverTrailer');
  var allPreviewModalCheckbox = createCheckbox(
    'allPreviewModal',
    labels.allPreviewModal || 'Aplicar modal em todo o Jellyfin',
    config.allPreviewModal
  );
  section.appendChild(allPreviewModalCheckbox);

  var hoverVolumeRange = createRangeInput(
    'hoverVolume',
    labels.hoverVolumeLabel || 'Volume do Hover Trailer',
    config.hoverVolume,
    0, 100, 1, "%"
  );
  hoverVolumeRange.style.marginTop = '12px';
  section.appendChild(hoverVolumeRange);

  var modeWrap = document.createElement('div');
  modeWrap.className = 'field-group';
  modeWrap.style.margin = '8px 0 4px';

  var title = document.createElement('div');
  title.className = 'field-label';
  title.textContent = (labels.globalPreviewMode || 'Tipo de hover global');
  modeWrap.appendChild(title);

  var modes = [
    { val: 'modal',      text: (labels.globalPreviewModeModal || 'HoverTrailer (Padrão)')},
    { val: 'studioMini', text: (labels.globalPreviewModeStudio || 'StudioHubs Mini') }
  ];
  var current = config.globalPreviewMode || 'modal';

  modes.forEach(function(m) {
    var label = document.createElement('label');
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = '6px';
    label.style.marginRight = '16px';

    var input = document.createElement('input');
    input.type = 'radio';
    input.name = 'globalPreviewMode';
    input.value = m.val;
    input.checked = (current === m.val);

    label.appendChild(input);
    label.appendChild(document.createTextNode(m.text));
    modeWrap.appendChild(label);
  });

  section.appendChild(modeWrap);

  var studioMiniTrailerPopover = createCheckbox(
    'studioMiniTrailerPopover',
    (labels.studioMiniTrailerPopover || 'Ativar popover de trailer no StudioHubs'),
    !!config.studioMiniTrailerPopover
  );
  studioMiniTrailerPopover.style.margin = '8px 0';
  section.appendChild(studioMiniTrailerPopover);

  var preferTrailerCheckbox = createCheckbox(
    'preferTrailersInPreviewModal',
    labels.preferTrailersInPreviewModal || 'Preferir Trailer > Vídeo no modal',
    config.preferTrailersInPreviewModal
  );
  section.appendChild(preferTrailerCheckbox);

  var onlyTrailerCheckbox = createCheckbox(
    'onlyTrailerInPreviewModal',
    labels.onlyTrailerInPreviewModal || 'Exibir apenas trailers no modal',
    config.onlyTrailerInPreviewModal
  );
  section.appendChild(onlyTrailerCheckbox);

  panel.appendChild(section);

  setTimeoutfunction(() {
    var modalRadio  = document.querySelector('input[name="globalPreviewMode"][value="modal"]');
    var studioRadio = document.querySelector('input[name="globalPreviewMode"][value="studioMini"]');

    var preferCb  = document.querySelector('input[name="preferTrailersInPreviewModal"]');
    var preferLbl = document.querySelector('label[for="preferTrailersInPreviewModal"]');

    var onlyCb    = document.querySelector('input[name="onlyTrailerInPreviewModal"]');
    var onlyLbl   = document.querySelector('label[for="onlyTrailerInPreviewModal"]');

    var smTrailerCb  = document.querySelector('input[name="studioMiniTrailerPopover"]');
    var smTrailerLbl = document.querySelector('label[for="studioMiniTrailerPopover"]');
    var smTrailerContainer = smTrailerCb ? smTrailerCb.closest('.checkboxContainer') || smTrailerCb.parentElement : null;

    var setDisabled = function(el, lbl, disabled) {
      if (!el || !lbl) return;
      el.disabled = disabled;
      el.style.opacity = disabled ? '0.5' : '1';
      lbl.style.opacity = disabled ? '0.5' : '1';
    };

    var setVisible = function(element, visible) {
      if (!element) return;
      element.style.display = visible ? '' : 'none';
    };

    var updateByMode = function() {
      var isModal = !!modalRadio.checked;
      var isStudio = !!studioRadio.checked;

      if (!preferCb || !onlyCb) return;

      if (isModal) {
        setDisabled(preferCb, preferLbl, false);
        setDisabled(onlyCb,   onlyLbl,   false);
      } else {
        setDisabled(preferCb, preferLbl, true);
        setDisabled(onlyCb,   onlyLbl,   true);
      }

      if (smTrailerContainer) {
        setVisible(smTrailerContainer, isStudio);
      } else if (smTrailerCb && smTrailerLbl) {
        setVisible(smTrailerCb, isStudio);
        setVisible(smTrailerLbl, isStudio);
      }

      if (smTrailerCb && smTrailerLbl) {
        setDisabled(smTrailerCb, smTrailerLbl, !isStudio);
      }
    };

    var publishMode = function() {
      var mode = modalRadio.checked ? 'modal' : 'studioMini';
      window.dispatchEvent(new CustomEvent('jms:globalPreviewModeChanged', { detail: { mode } }));
    };

    var onPreferChange = function() {
      if (!modalRadio.checked || !preferCb || !onlyCb) return;

      if (preferCb.checked) {
        if (onlyCb.checked) onlyCb.checked = false;
      }
    };

    var onOnlyChange = function() {
      if (!modalRadio.checked || !preferCb || !onlyCb) return;

      if (onlyCb.checked) {
        if (preferCb.checked) preferCb.checked = false;
      }
    };

    updateByMode();
    publishMode();

    modalRadio.addEventListenerfunction('change', () { updateByMode(); publishMode(); });
    studioRadio.addEventListenerfunction('change', () { updateByMode(); publishMode(); });
    preferCb.addEventListener('change', onPreferChange);
    onlyCb.addEventListener('change', onOnlyChange);
  }, 100);

  return panel;
}

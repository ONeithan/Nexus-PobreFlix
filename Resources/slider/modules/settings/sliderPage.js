import { createCheckbox, createImageTypeSelect, bindCheckboxKontrol, bindTersCheckboxKontrol } from "./shared.js";
import { getDefaultLanguage, getStoredLanguagePreference } from '../../language/index.js';
import { fetchJmsPluginConfig, sanitizeTmdbApiKey } from "../jmsPluginConfig.js";

var LS_TMDB_LANG  = 'jms_tmdb_reviews_lang';

function lsGet(k, def = '') { try { return localStorage.getItem(k) || def; } catch { return def; } }
function lsSet(k, v) { try { (v ? localStorage.setItem(k, v) : localStorage.removeItem(k)); } catch {} }

function createTextInputSimple(id, labelText, value, placeholder = '') {
  var wrap = document.createElement('div');
  wrap.className = 'fsetting-item';
  var label = document.createElement('label');
  label.htmlFor = id; label.textContent = labelText;
  var input = document.createElement('input');
  input.type = 'text';
  input.id = id;
  input.name = id;
  input.value = value || '';
  input.placeholder = placeholder || '';
  wrap.append(label, input);
  return { wrap, input };
}

function createSelectSimple(id, labelText, value, options) {
  var wrap = document.createElement('div');
  wrap.className = 'fsetting-item';
  var label = document.createElement('label');
  label.htmlFor = id; label.textContent = labelText;
  var sel = document.createElement('select');
  sel.id = id;
  sel.name = id;
  for (var opt of options) {
    var o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  }
  sel.value = value || options.[0].value || '';
  wrap.append(label, sel);
  return { wrap, sel };
}

export function createSliderPanel(config, labels) {
  var panel = document.createElement('div');
  panel.id = 'slider-panel';
  panel.className = 'settings-panel';

  var languageDiv = document.createElement('div');
  languageDiv.className = 'setting-item';
  var languageLabel = document.createElement('label');
  languageLabel.textContent = labels.defaultLanguage || 'Idioma:';
  languageLabel.htmlFor = 'defaultLanguageSelect';
  var languageSelect = document.createElement('select');
  languageSelect.name = 'defaultLanguage';
  languageSelect.id = 'defaultLanguageSelect';

  var uiPref = getStoredLanguagePreference() || 'auto';
  var effective = getDefaultLanguage();

  var languages = [
    { value: 'auto', label: labels.optionAuto || '🌐 Automático' },
    { value: 'por',  label: labels.optionPortuguese || '🇧🇷 Português Brasil' },
    { value: 'eng',  label: labels.optionEnglish || '🇬🇧 English' },
    { value: 'spa',  label: labels.optionEspanol || '🇪🇸 Español' },
    { value: 'deu',  label: labels.optionGerman  || '🇩🇪 Deutsch' },
    { value: 'fre',  label: labels.optionFrench  || '🇫🇷 Français' },
    { value: 'rus',  label: labels.optionRussian || '🇷🇺 Русский' },
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

  var tmdbWrap = document.createElement('div');
  tmdbWrap.className = 'fsetting-item';
  var canEditGlobalTmdb = config.currentUserIsAdmin === true;

  var tmdbTitle = document.createElement('h3');
  tmdbTitle.textContent = labels.tmdbReviewsTitle || 'Avaliações do TMDb';

  var tmdbKeyField = function(() {
    var w = document.createElement('div');
    w.className = 'fsetting-item';
    var l = document.createElement('label');
    l.textContent = labels.tmdbApiKeyForReviews || 'Chave API do TMDb (para comentários)';
    l.htmlFor = 'tmdbKeyForReviews';
    var i = document.createElement('input');
    i.type = 'password';
    i.id = 'tmdbKeyForReviews';
    i.name = 'TmdbApiKey';
    i.placeholder = '••••••••';
    i.value = sanitizeTmdbApiKey(config.TmdbApiKey || config.tmdbApiKey || '');
    i.disabled = !canEditGlobalTmdb;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = (labels.showSecret || 'Mostrar');
    btn.style.cssText = 'margin-left:8px; padding:6px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.15); background:transparent; color:inherit; cursor:pointer;';
    btn.disabled = !canEditGlobalTmdb;
    btn.onclick = function() {
      var hidden = i.type === 'password';
      i.type = hidden ? 'text' : 'password';
      btn.textContent = hidden ? (labels.hideSecret || 'Ocultar') : (labels.showSecret || 'Mostrar');
    };

    var row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:6px;';
    row.append(i, btn);

    var hint = document.createElement('div');
    hint.className = 'description-text';
    hint.textContent = canEditGlobalTmdb
      ? (labels.tmdbKeyHint || 'Esta chave é salva nas configurações globais do Jellyfin e usada pelo trailer e detalhes.')
      : (labels.settingsReadOnly || 'Apenas administradores podem alterar este campo.');

    w.append(l, row, hint);
    return w;
  })();

  var tmdbLangSelect = createSelectSimple(
    'tmdbReviewsLang',
    labels.tmdbReviewsLang || 'Idioma dos Comentários',
    lsGet(LS_TMDB_LANG, 'pt-BR'),
    [
      { value: 'pt-BR', label: '🇧🇷 Português (pt-BR)' },
      { value: 'en-US', label: '🇺🇸 English (en-US)' },
      { value: 'es-ES', label: '🇪🇸 Español (es-ES)' },
      { value: 'de-DE', label: '🇩🇪 Deutsch (de-DE)' },
      { value: 'fr-FR', label: '🇫🇷 Français (fr-FR)' },
      { value: 'ru-RU', label: '🇷🇺 Русский (ru-RU)' },
      { value: '', label: labels.noParam || '🌐 Automático' },
    ]
  );
  tmdbLangSelect.sel.addEventListenerfunction('change', () lsSet(LS_TMDB_LANG, tmdbLangSelect.sel.value));
  tmdbWrap.append(tmdbTitle, tmdbKeyField, tmdbLangSelect.wrap);

  function(() {
    try {
      var latest = fetchJmsPluginConfig();
      var input = tmdbKeyField.querySelector('#tmdbKeyForReviews');
      if (input) input.value = sanitizeTmdbApiKey(latest.TmdbApiKey || latest.tmdbApiKey);
    } catch {}
  })();

  var cssDiv = document.createElement('div');
  cssDiv.className = 'fsetting-item';
  var cssLabel = document.createElement('h3');
  cssLabel.textContent = labels.appearance || 'Variante do CSS:';
  var cssSelect = document.createElement('select');
  cssSelect.name = 'cssVariant';

  var variants = [
    { value: 'slider', label: labels.compactSlider || 'Compacto' },
    { value: 'normalslider' ,label: labels.normalSlider || 'Normal' },
    { value: 'fullslider', label: labels.fullSlider || 'Tela Cheia' },
    { value: 'showcase', label: (labels.peakslider || 'Peak') },
  ];

  var enableSliderCheckbox = createCheckbox(
    'enableSlider',
    labels.enableSlider || 'Habilitar Banner (Slider)',
    (config.enableSlider !== false)
  );

  var onlyShowSliderOnHomeTabCheckbox = createCheckbox(
    'onlyShowSliderOnHomeTab',
    labels.onlyShowSliderOnHomeTab || 'Mostrar apenas na aba Início',
    (config.onlyShowSliderOnHomeTab !== false)
  );

  variants.forEach(function(variant) {
    var option = document.createElement('option');
    option.value = variant.value;
    option.textContent = variant.label;
    if (variant.value === config.cssVariant) {
      option.selected = true;
    }
    cssSelect.appendChild(option);
  });

  var peakDiagonalCheckbox = createCheckbox(
    'peakDiagonal',
    labels.peakDiagonal || 'Visual Diagonal',
    (config.cssVariant === 'showcase') && !!config.peakDiagonal
  );

  function updatePeakDiagonalVisibility() {
    var isPeak = cssSelect.value === 'showcase';
    var input = peakDiagonalCheckbox.querySelector('input');
    peakDiagonalCheckbox.style.display = isPeak ? '' : 'none';

    if (isPeak) {
      input.disabled = false;
    } else {
      input.disabled = true;
      input.checked = false;
    }
    var showExtra = input.checked;
    var extraFields = [
      peakSpanLeftLabel, peakSpanLeftInput,
      peakSpanRightLabel, peakSpanRightInput,
      peakGapRightLabel, peakGapRightInput,
      peakGapLeftLabel, peakGapLeftInput,
      peakGapYLabel, peakGapYInput
    ];
    extraFields.forEach(function(el) {
      el.style.display = showExtra ? '' : 'none';
    });
  }

  var cssDesc = document.createElement('div');
  cssDesc.className = 'description-text';
  var baseDesc =
    labels.cssDescriptionBase ||
    labels.cssDescription ||
    '• A visualização em Tela Cheia foi otimizada para Desktop com Poster Dot habilitado.';
  var mobileNote =
    labels.cssMobileNote ||
    '• A visualização de vitrine ainda não está disponível para mobile.';
  cssDesc.innerHTML = (baseDesc) + "<br><br>" + (mobileNote);

  cssLabel.htmlFor = 'cssVariantSelect';
  cssSelect.id = 'cssVariantSelect';

  var peakSpanRightLabel = document.createElement('label');
  peakSpanRightLabel.textContent = labels.peakSpanRight || 'Número de Cards:';
  var peakSpanRightInput = document.createElement('input');
  peakSpanRightInput.type = 'number';
  peakSpanRightInput.value = config.peakSpanRight || 3;
  peakSpanRightInput.name = 'peakSpanRight';
  peakSpanRightInput.min = 1;
  peakSpanRightInput.step = 1;
  peakSpanRightInput.setAttribute('data-group', 'actor');
  peakSpanRightLabel.htmlFor = 'peakSpanRightInput';
  peakSpanRightInput.id = 'peakSpanRightInput';

  var peakSpanLeftLabel = document.createElement('label');
  peakSpanLeftLabel.textContent = labels.peakSpanLeft || 'Número de Cards à Esquerda:';
  var peakSpanLeftInput = document.createElement('input');
  peakSpanLeftInput.type = 'number';
  peakSpanLeftInput.value = config.peakSpanLeft || 3;
  peakSpanLeftInput.name = 'peakSpanLeft';
  peakSpanLeftInput.min = 1;
  peakSpanLeftInput.step = 1;
  peakSpanLeftInput.setAttribute('data-group', 'actor');
  peakSpanLeftLabel.htmlFor = 'peakSpanLeftInput';
  peakSpanLeftInput.id = 'peakSpanLeftInput';

  var peakGapLeftLabel = document.createElement('label');
  peakGapLeftLabel.textContent = labels.peakGapLeft || 'Eixo X Vizinho Esquerdo (px)';
  var peakGapLeftInput = document.createElement('input');
  peakGapLeftInput.type = 'number';
  peakGapLeftInput.value = config.peakGapLeft || 80;
  peakGapLeftInput.name = 'peakGapLeft';
  peakGapLeftInput.min = 0;
  peakGapLeftInput.step = 1;
  peakGapLeftInput.setAttribute('data-group', 'actor');
  peakGapLeftLabel.htmlFor = 'peakGapLeftInput';
  peakGapLeftInput.id = 'peakGapLeftInput';

  var peakGapRightLabel = document.createElement('label');
  peakGapRightLabel.textContent = labels.peakGapRight || 'Eixo X Vizinho Direito (px)';
  var peakGapRightInput = document.createElement('input');
  peakGapRightInput.type = 'number';
  peakGapRightInput.value = config.peakGapRight || 80;
  peakGapRightInput.name = 'peakGapRight';
  peakGapRightInput.min = 0;
  peakGapRightInput.step = 1;
  peakGapRightInput.setAttribute('data-group', 'actor');
  peakGapRightLabel.htmlFor = 'peakGapRightInput';
  peakGapRightInput.id = 'peakGapRightInput';

  var peakGapYLabel = document.createElement('label');
  peakGapYLabel.textContent = labels.peakGapY || 'Eixo Y (px)';
  var peakGapYInput = document.createElement('input');
  peakGapYInput.type = 'number';
  peakGapYInput.value = config.peakGapY || 0;
  peakGapYInput.name = 'peakGapY';
  peakGapYInput.min = 0;
  peakGapYInput.step = 1;
  peakGapYInput.setAttribute('data-group', 'actor');
  peakGapYLabel.htmlFor = 'peakGapYInput';
  peakGapYInput.id = 'peakGapYInput';

  cssDiv.append(enableSliderCheckbox, onlyShowSliderOnHomeTabCheckbox, cssLabel, cssSelect, peakDiagonalCheckbox, peakSpanLeftLabel, peakSpanLeftInput, peakSpanRightLabel, peakSpanRightInput, peakGapRightLabel, peakGapRightInput, peakGapLeftLabel, peakGapLeftInput, peakGapYLabel, peakGapYInput, cssDesc);

  cssSelect.addEventListener('change', updatePeakDiagonalVisibility);
  peakDiagonalCheckbox.querySelector('input').addEventListener('change', updatePeakDiagonalVisibility);
  updatePeakDiagonalVisibility();

  var sliderDiv = document.createElement('div');
  sliderDiv.className = 'fsetting-item';
  var sliderLabel = document.createElement('h3');
  sliderLabel.textContent = labels.sliderDuration || 'Duração do Slider (ms):';
  var sliderInput = document.createElement('input');
  sliderInput.type = 'number';
  sliderInput.value = config.sliderDuration || 15000;
  sliderInput.name = 'sliderDuration';
  sliderInput.min = 1000;
  sliderInput.step = 250;
  sliderLabel.htmlFor = 'sliderDurationInput';
  sliderInput.id = 'sliderDurationInput';
  var sliderDesc = document.createElement('div');
  sliderDesc.className = 'description-text';
  sliderDesc.textContent = labels.sliderDurationDescription || 'Este ajuste deve ser em milissegundos (ms).';
  sliderDiv.append(sliderLabel, sliderDesc, sliderInput);

  var showSecondsCheckbox = createCheckbox(
    'showProgressAsSeconds',
    (labels.showProgressAsSeconds || "Mostrar Progresso em Segundos"),
    config.showProgressAsSeconds || false
  );
  sliderDiv.appendChild(showSecondsCheckbox);

  var playbackOptionsDiv = document.createElement('div');
  playbackOptionsDiv.className = 'fsetting-item';

  var playbackTitle = document.createElement('h3');
  playbackTitle.textContent = labels.previewPlaybackOptions || 'Opções de Reprodução Integrada';
  playbackOptionsDiv.appendChild(playbackTitle);

  var playbackCheckboxesDiv = document.createElement('div');
  var trailerPlaybackCheckbox = createCheckbox(
    'enableTrailerPlayback',
    labels.enableTrailerPlayback || 'Permitir Reprodução de Trailer Integrado',
    config.enableTrailerPlayback
  );

  var videoPlaybackCheckbox = createCheckbox(
    'enableVideoPlayback',
    labels.enableVideoPlayback || 'Permitir Reprodução de Vídeo Integrado',
    config.enableVideoPlayback
  );

  var trailerThenVideoCheckbox = createCheckbox(
    'enableTrailerThenVideo',
    labels.enableTrailerThenVideo || 'Primeiro Trailer, se não houver Vídeo',
    config.enableTrailerThenVideo
  );

  var disableAllPlaybackCheckbox = createCheckbox(
    'disableAllPlayback',
    labels.selectNone || 'Nenhum',
    config.disableAllPlayback || false
  );

  function disableAllPlaybackOptions() {
    var trailerCheckbox = document.querySelector('#enableTrailerPlayback');
    var videoCheckbox = document.querySelector('#enableVideoPlayback');
    var trailerThenVideoCheckbox = document.querySelector('#enableTrailerThenVideo');

    if (trailerCheckbox) trailerCheckbox.checked = false;
    if (videoCheckbox) videoCheckbox.checked = false;
    if (trailerThenVideoCheckbox) trailerThenVideoCheckbox.checked = false;

    localStorage.setItem('previewPlaybackMode', 'none');
    updateTrailerRelatedFields();
  }

  playbackCheckboxesDiv.appendChild(trailerPlaybackCheckbox);
  playbackCheckboxesDiv.appendChild(videoPlaybackCheckbox);
  playbackCheckboxesDiv.appendChild(trailerThenVideoCheckbox);
  playbackCheckboxesDiv.appendChild(disableAllPlaybackCheckbox);

  disableAllPlaybackCheckbox.querySelector('input').addEventListenerfunction('change', (e) {
    if (e.target.checked) {
      disableAllPlaybackOptions();
    }
  });

  [trailerPlaybackCheckbox, videoPlaybackCheckbox, trailerThenVideoCheckbox].forEach(function(checkbox) {
    checkbox.querySelector('input').addEventListenerfunction('change', () {
      disableAllPlaybackCheckbox.querySelector('input').checked = false;
    });
  });

  playbackOptionsDiv.appendChild(playbackCheckboxesDiv);

  function setPlaybackMode(mode) {
    var t = trailerPlaybackCheckbox.querySelector('input');
    var v = videoPlaybackCheckbox.querySelector('input');
    var tv = trailerThenVideoCheckbox.querySelector('input');
    var none = disableAllPlaybackCheckbox.querySelector('input');

    if (mode === 'trailer') { t.checked = true; v.checked = false; tv.checked = false; }
    else if (mode === 'video') { t.checked = false; v.checked = true; tv.checked = false; }
    else { t.checked = false; v.checked = false; tv.checked = true; }
    none.checked = false;

    localStorage.setItem('previewPlaybackMode', mode);
    localStorage.setItem('previewTrailerEnabled', String(mode === 'trailer'));
    updateTrailerRelatedFields();
  }

  trailerPlaybackCheckbox.querySelector('input').addEventListenerfunction('change', (e) {
    if (e.target.checked) setPlaybackMode('trailer');
  });
  videoPlaybackCheckbox.querySelector('input').addEventListenerfunction('change', (e) {
    if (e.target.checked) setPlaybackMode('video');
  });
  trailerThenVideoCheckbox.querySelector('input').addEventListenerfunction('change', (e) {
    if (e.target.checked) setPlaybackMode('trailerThenVideo');
  });

  var initialPlaybackMode = function(() {
    if (config.disableAllPlayback) return 'none';
    if (
      config.previewPlaybackMode === 'trailer' ||
      config.previewPlaybackMode === 'video' ||
      config.previewPlaybackMode === 'trailerThenVideo'
    ) {
      return config.previewPlaybackMode;
    }
    if (config.enableTrailerThenVideo) return 'trailerThenVideo';
    if (config.enableTrailerPlayback) return 'trailer';
    if (config.enableVideoPlayback) return 'video';
    return 'video';
  })();

  if (initialPlaybackMode === 'none') {
    disableAllPlaybackCheckbox.querySelector('input').checked = true;
    disableAllPlaybackOptions();
  } else {
    setPlaybackMode(initialPlaybackMode);
  }

  trailerPlaybackCheckbox.querySelector('input').addEventListenerfunction('change', (e) {
    if (e.target.checked) {
      videoPlaybackCheckbox.querySelector('input').checked = false;
    }
    updateTrailerRelatedFields();
  });

  videoPlaybackCheckbox.querySelector('input').addEventListenerfunction('change', (e) {
    if (e.target.checked) {
      trailerPlaybackCheckbox.querySelector('input').checked = false;
    }
    updateTrailerRelatedFields();
  });

  sliderDiv.appendChild(playbackOptionsDiv);

  var delayDiv = document.createElement('div');
  delayDiv.className = 'fsetting-item trailer-delay-container';
  var delayLabel = document.createElement('label');
  delayLabel.textContent = labels.atrasoTrailer || 'Tempo de Atraso do Trailer Integrado (ms):';
  var delayInput = document.createElement('input');
  delayInput.type = 'number';
  delayInput.value = config.atrasoTrailer || 500;
  delayInput.name = 'atrasoTrailer';
  delayInput.min = 0;
  delayInput.max = 10000;
  delayInput.step = 50;
  delayLabel.htmlFor = 'delayInput';
  delayInput.id = 'delayInput';
  delayDiv.append(delayLabel, delayInput);
  sliderDiv.appendChild(delayDiv);

  var backgroundOptionsDiv = document.createElement('div');
  backgroundOptionsDiv.className = 'fsetting-item';

  var backgroundTitle = document.createElement('h3');
  backgroundTitle.textContent = labels.backgroundOptions || 'Configurações de Exibição de Imagem do Slider';
  backgroundOptionsDiv.appendChild(backgroundTitle);
  sliderDiv.appendChild(backgroundOptionsDiv);

  var indexZeroDesc = document.createElement('div');
  indexZeroDesc.className = 'description-text';
  indexZeroDesc.textContent = labels.indexZeroDescription || 'Quando ativo, sempre seleciona a imagem de índice 0 (desativa outros filtros de qualidade).';
  sliderDiv.appendChild(indexZeroDesc);

  var indexZeroCheckbox = createCheckbox(
    'indexZeroSelection',
    labels.indexZeroSelection || 'Sempre selecionar imagem de índice 0',
    config.indexZeroSelection
  );
  sliderDiv.appendChild(indexZeroCheckbox);

  var manualBackdropCheckbox = createCheckbox(
    'manualBackdropSelection',
    labels.manualBackdropSelection || 'Alterar Fundo do Slide',
    config.manualBackdropSelection
  );
  sliderDiv.appendChild(manualBackdropCheckbox);

  var backdropDiv = document.createElement('div');
  backdropDiv.className = 'fsetting-item backdrop-container';
  var backdropLabel = document.createElement('label');
  backdropLabel.textContent = labels.slideBackgroundImageType || 'Tipo de Imagem de Fundo do Slider:';
  var backdropSelect = createImageTypeSelect('backdropImageType', config.backdropImageType || 'backdropUrl', true);
  backdropLabel.htmlFor = 'backdropSelect';
  backdropSelect.id = 'backdropSelect';
  backdropDiv.append(backdropLabel, backdropSelect);
  sliderDiv.appendChild(backdropDiv);

  var minQualityDiv = document.createElement('div');
  minQualityDiv.className = 'fsetting-item min-quality-container';
  var minQualityLabel = document.createElement('label');
  minQualityLabel.textContent = labels.minHighQualityWidthInput || 'Largura Mínima (px):';

  var minQualityInput = document.createElement('input');
  minQualityInput.type = 'number';
  minQualityInput.value = config.minHighQualityWidth || 1920;
  minQualityInput.name = 'minHighQualityWidth';
  minQualityInput.min = 1;

  var minQualityDesc = document.createElement('div');
  minQualityDesc.className = 'description-text';
  minQualityDesc.textContent = labels.minHighQualitydescriptiontext ||
    'Este ajuste define a largura mínima da imagem de fundo. (Não funciona se "Alterar Fundo do Slide" estiver ativo. Se não houver imagem com a largura definida, a de melhor qualidade será escolhida.)';

  minQualityLabel.htmlFor = 'minHighQualityWidthInput';
  minQualityInput.id = 'minHighQualityWidthInput';
  minQualityDiv.append(minQualityLabel, minQualityDesc, minQualityInput);
  sliderDiv.appendChild(minQualityDiv);

  bindCheckboxKontrol('#manualBackdropSelection', '.backdrop-container', 0.6, [backdropSelect]);
  bindTersCheckboxKontrol('#manualBackdropSelection', '.min-quality-container', 0.6, [minQualityInput]);

  var backdropMaxWidthDiv = document.createElement('div');
  backdropMaxWidthDiv.className = 'fsetting-item min-quality-container';
  var backdropMaxWidthLabel = document.createElement('label');
  backdropMaxWidthLabel.textContent = labels.backdropMaxWidthInput || 'Escala Máxima (px):';

  var backdropMaxWidthInput = document.createElement('input');
  backdropMaxWidthInput.type = 'number';
  backdropMaxWidthInput.value = config.backdropMaxWidth || 1920;
  backdropMaxWidthInput.name = 'backdropMaxWidth';
  backdropMaxWidthInput.min = 1;

  var backdropMaxWidthDesc = document.createElement('div');
  backdropMaxWidthDesc.className = 'description-text';
  backdropMaxWidthDesc.textContent = labels.backdropMaxWidthLabel ||
    'A imagem de fundo será escalonada para o valor inserido. (Não funciona se "Alterar Fundo do Slide" estiver ativo. Se a imagem for menor que o valor, não escalona)';

  backdropMaxWidthLabel.htmlFor = 'backdropMaxWidthInput';
  backdropMaxWidthInput.id = 'backdropMaxWidthInput';
  backdropMaxWidthDiv.append(backdropMaxWidthLabel, backdropMaxWidthDesc, backdropMaxWidthInput);
  sliderDiv.appendChild(backdropMaxWidthDiv);

  var minPixelDiv = document.createElement('div');
  minPixelDiv.className = 'fsetting-item min-quality-container';
  var minPixelLabel = document.createElement('label');
  minPixelLabel.textContent = labels.minPixelCountInput || 'Número Mínimo de Pixels:';

  var minPixelInput = document.createElement('input');
  minPixelInput.type = 'number';
  minPixelInput.value = config.minPixelCount || (1920 * 1080);
  minPixelInput.name = 'minPixelCount';
  minPixelInput.min = 1;

  var minPixelDesc = document.createElement('div');
  minPixelDesc.className = 'description-text';
  minPixelDesc.textContent = labels.minPixelCountDescription ||
    'Resultado de largura × altura. Imagens menores que este valor são consideradas de baixa qualidade. Ex: 1920×1080 = 2073600';

  minPixelLabel.htmlFor = 'minPixelInput';
  minPixelInput.id = 'minPixelInput';
  minPixelDiv.append(minPixelLabel, minPixelDesc, minPixelInput);
  sliderDiv.appendChild(minPixelDiv);

  var sizeFilterToggleDiv = document.createElement('div');
  sizeFilterToggleDiv.className = 'fsetting-item min-quality-container';

  var sizeFilterLabel = document.createElement('label');
  sizeFilterLabel.textContent = labels.enableImageSizeFilter || 'Ativar Filtragem de Tamanho de Imagem';
  sizeFilterLabel.htmlFor = 'enableImageSizeFilter';

  var sizeFilterCheckbox = document.createElement('input');
  sizeFilterCheckbox.type = 'checkbox';
  sizeFilterCheckbox.id = 'enableImageSizeFilter';
  sizeFilterCheckbox.name = 'enableImageSizeFilter';
  sizeFilterCheckbox.checked = config.enableImageSizeFilter || false;

  sizeFilterLabel.prepend(sizeFilterCheckbox);
  sizeFilterToggleDiv.appendChild(sizeFilterLabel);
  sliderDiv.appendChild(sizeFilterToggleDiv);

  var minSizeDiv = document.createElement('div');
  minSizeDiv.className = 'fsetting-item min-quality-container';
  var minSizeLabel = document.createElement('label');
  minSizeLabel.textContent = labels.minImageSizeKB || 'Tamanho Mínimo da Imagem (KB):';

  var minSizeInput = document.createElement('input');
  minSizeInput.type = 'number';
  minSizeInput.value = config.minImageSizeKB || 800;
  minSizeInput.name = 'minImageSizeKB';
  minSizeInput.min = 1;

  var minSizeDesc = document.createElement('div');
  minSizeDesc.className = 'description-text';
  minSizeDesc.textContent = labels.minImageSizeDescription || 'Especifica o tamanho mínimo do arquivo da imagem em KB.';

  minSizeLabel.htmlFor = 'minSizeInput';
  minSizeInput.id = 'minSizeInput';
  minSizeDiv.append(minSizeLabel, minSizeDesc, minSizeInput);
  sliderDiv.appendChild(minSizeDiv);

  var maxSizeDiv = document.createElement('div');
  maxSizeDiv.className = 'fsetting-item min-quality-container';
  var maxSizeLabel = document.createElement('label');
  maxSizeLabel.textContent = labels.maxImageSizeKB || 'Tamanho Máximo da Imagem (KB):';

  var maxSizeInput = document.createElement('input');
  maxSizeInput.type = 'number';
  maxSizeInput.value = config.maxImageSizeKB || 1500;
  maxSizeInput.name = 'maxImageSizeKB';
  maxSizeInput.min = 1;

  var maxSizeDesc = document.createElement('div');
  maxSizeDesc.className = 'description-text';
  maxSizeDesc.textContent = labels.maxImageSizeDescription || 'Especifica o tamanho máximo do arquivo da imagem em KB.';

  maxSizeLabel.htmlFor = 'maxSizeInput';
  maxSizeInput.id = 'maxSizeInput';
  maxSizeDiv.append(maxSizeLabel, maxSizeDesc, maxSizeInput);
  sliderDiv.appendChild(maxSizeDiv);

  bindTersCheckboxKontrol('#manualBackdropSelection', '.min-quality-container', 0.6, [minPixelInput, minSizeInput, maxSizeInput, backdropMaxWidthInput]);
  bindCheckboxKontrol('#enableImageSizeFilter', '.min-quality-container', 0.6, [minSizeInput, maxSizeInput]);

  var dotOptionsDiv = document.createElement('div');
  dotOptionsDiv.className = 'fsetting-item';

  var dotTitle = document.createElement('h3');
  dotTitle.textContent = labels.dotOptions || 'Configurações de Navegação (Dot)';
  dotOptionsDiv.appendChild(dotTitle);
  sliderDiv.appendChild(dotOptionsDiv);

  var dotCheckboxs = document.createElement('div');
  dotCheckboxs.className = 'fsetting-item min-quality-container';

  var dotNavCheckbox = createCheckbox(
    'showDotNavigation',
    labels.showDotNavigation || 'Mostrar Navegação por Dot',
    config.showDotNavigation
  );
  sliderDiv.appendChild(dotNavCheckbox);

  var posterDotsDesc = document.createElement('div');
  posterDotsDesc.className = 'description-text';
  posterDotsDesc.textContent = labels.posterDotsDescription || 'Transforma a navegação por dot em tamanho de poster (requer posicionamento na área do Slider)';
  sliderDiv.appendChild(posterDotsDesc);

  var posterDotsCheckbox = createCheckbox(
    'dotPosterMode',
    labels.dotPosterMode || 'Navegação por Dot em Tamanho de Poster',
    config.dotPosterMode
  );
  sliderDiv.appendChild(posterDotsCheckbox);

  var dotVisibleCountDiv = document.createElement('div');
  dotVisibleCountDiv.className = 'setting-item dot-visible-count-container';

  var dotVisibleCountLabel = document.createElement('label');
  dotVisibleCountLabel.textContent = labels.dotVisibleCount || 'Número de dots visíveis:';
  dotVisibleCountLabel.htmlFor = 'dotVisibleCount';

  var dotVisibleCountInput = document.createElement('input');
  dotVisibleCountInput.type = 'number';
  dotVisibleCountInput.min = '0';
  dotVisibleCountInput.step = '1';
  dotVisibleCountInput.value = Math.max(0, Number(config.dotVisibleCount || 0));
  dotVisibleCountInput.name = 'dotVisibleCount';
  dotVisibleCountInput.id = 'dotVisibleCount';

  var dotVisibleCountDesc = document.createElement('div');
  dotVisibleCountDesc.className = 'description-text';
  dotVisibleCountDesc.textContent = labels.dotVisibleCountDescription || '0 = todos os dots visíveis. Em valores menores, dots distantes recebem a classe hidden.';

  dotVisibleCountDiv.append(dotVisibleCountLabel, dotVisibleCountDesc, dotVisibleCountInput);
  sliderDiv.appendChild(dotVisibleCountDiv);

  var previewModalCheckbox = createCheckbox(
    'previewModal',
    labels.previewModal || 'Modal de Pré-visualização Estilo Netflix',
    config.previewModal
  );
  sliderDiv.appendChild(previewModalCheckbox);

  var dotPreviewDiv = document.createElement('div');
  dotPreviewDiv.className = 'fsetting-item';
  var dotPreviewLabel = document.createElement('div');
  dotPreviewLabel.id = 'dotPreviewPlaybackModeLabel';
  dotPreviewLabel.textContent = labels.dotPreviewMode || 'Modo de Reprodução do Poster Dot:';
  dotPreviewLabel.style.display = 'block';
  dotPreviewLabel.style.marginBottom = '6px';

  var modes = [
    { value: 'trailer',     text: labels.preferTrailersInPreviewModal || 'Trailer + Vídeo' },
    { value: 'video',       text: labels.videoOnly || 'Vídeo' },
    { value: 'onlyTrailer', text: labels.onlyTrailerInPreviewModal || 'Apenas Trailer' },
  ];

  var dotPreviewGroup = document.createElement('div');
  dotPreviewGroup.setAttribute('role', 'radiogroup');
  dotPreviewGroup.setAttribute('aria-labelledby', 'dotPreviewPlaybackModeLabel');
  dotPreviewGroup.style.display = 'flex';
  dotPreviewGroup.style.flexDirection = 'column';
  dotPreviewGroup.style.gap = '4px';

  modes.forEach(function(m) {
    var wrap = document.createElement('label');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = 'dotPreviewPlaybackMode';
    input.value = m.value;
    input.checked = (config.dotPreviewPlaybackMode || '') === m.value;
    wrap.appendChild(input);
    wrap.appendChild(document.createTextNode(m.text));
    dotPreviewGroup.appendChild(wrap);
  });

  if (!config.dotPreviewPlaybackMode) {
    var first = dotPreviewGroup.querySelector('input[value="trailer"]');
    if (first) first.checked = true;
  }

  dotPreviewDiv.append(dotPreviewLabel, dotPreviewGroup);
  sliderDiv.appendChild(dotPreviewDiv);

  document.addEventListenerfunction('DOMContentLoaded', () {
    if (typeof updateModalRelatedFields === 'function') {
      updateModalRelatedFields();
    }
  });

  var dotBgDiv = document.createElement('div');
  dotBgDiv.className = 'fsetting-item';
  dotBgDiv.classList.add('dot-bg-container');
  var dotBgLabel = document.createElement('label');
  dotBgLabel.textContent = labels.dotBackgroundImageType || 'Tipo de Imagem de Fundo do Dot:';
  var dotBgSelect = createImageTypeSelect(
    'dotBackgroundImageType',
    config.dotBackgroundImageType || 'useSlideBackground',
    true,
    true
  );

  dotBgLabel.htmlFor = 'dotBgSelect';
  dotBgSelect.id = 'dotBgSelect';
  dotBgDiv.append(dotBgLabel, dotBgSelect);
  sliderDiv.appendChild(dotBgDiv);

  bindCheckboxKontrol('#showDotNavigation', '.dot-bg-container', 0.6, [dotBgSelect, dotBgLabel]);
  bindCheckboxKontrol('#showDotNavigation', '.dot-visible-count-container', 0.6, [dotVisibleCountInput, dotVisibleCountLabel]);

  var dotblurDiv = document.createElement('div');
  dotblurDiv.className = 'setting-item';

  var dotblurLabel = document.createElement('label');
  dotblurLabel.textContent = labels.backgroundBlur || 'Desfoque do fundo:';
  dotblurLabel.htmlFor = 'dotBackgroundBlur';

  var dotblurInput = document.createElement('input');
  dotblurInput.type = 'range';
  dotblurInput.min = '0';
  dotblurInput.max = '20';
  dotblurInput.step = '1';
  dotblurInput.value = config.dotBackgroundBlur || 10;
  dotblurInput.name = 'dotBackgroundBlur';
  dotblurInput.id = 'dotBackgroundBlur';

  var dotblurValue = document.createElement('span');
  dotblurValue.className = 'range-value';
  dotblurValue.textContent = dotblurInput.value + 'px';

  dotblurInput.addEventListenerfunction('input', () {
    dotblurValue.textContent = dotblurInput.value + 'px';
  });

  dotblurDiv.append(dotblurLabel, dotblurInput, dotblurValue);
  sliderDiv.appendChild(dotblurDiv);

  var dotopacityDiv = document.createElement('div');
  dotopacityDiv.className = 'setting-item';

  var dotopacityLabel = document.createElement('label');
  dotopacityLabel.textContent = labels.backgroundOpacity || 'Opacidade do fundo:';
  dotopacityLabel.htmlFor = 'dotBackgroundOpacity';

  var dotopacityInput = document.createElement('input');
  dotopacityInput.type = 'range';
  dotopacityInput.min = '0';
  dotopacityInput.max = '1';
  dotopacityInput.step = '0.1';
  dotopacityInput.value = (config.dotBackgroundOpacity !== undefined ? config.dotBackgroundOpacity : 0.5);
  dotopacityInput.name = 'dotBackgroundOpacity';
  dotopacityInput.id = 'dotBackgroundOpacity';

  var dotopacityValue = document.createElement('span');
  dotopacityValue.className = 'range-value';
  dotopacityValue.textContent = dotopacityInput.value;

  dotopacityInput.addEventListenerfunction('input', () {
  dotopacityValue.textContent = dotopacityInput.value;
  });

  dotopacityDiv.append(dotopacityLabel, dotopacityInput, dotopacityValue);
  sliderDiv.appendChild(dotopacityDiv);


  panel.append(
    languageDiv,
    tmdbWrap,
    cssDiv,
    sliderDiv
  );

  requestAnimationFramefunction(() {
    updateTrailerRelatedFields();
  });

  return panel;
}

function updateTrailerRelatedFields() {
  var elT = document.querySelector('#enableTrailerPlayback');
  var elV = document.querySelector('#enableVideoPlayback');
  var elTV = document.querySelector('#enableTrailerThenVideo');
  var t = elT && elT.checked;
  var v = elV && elV.checked;
  var tv = elTV && elTV.checked;
  var isEnabled = !!(t || v || tv);

  var trailerDelayContainer = document.querySelector('.trailer-delay-container');
  if (trailerDelayContainer) {
    trailerDelayContainer.style.opacity = isEnabled ? 1 : 0.6;

    trailerDelayContainer.querySelectorAll('input, select').forEach(function(el) el.disabled = !isEnabled);
  }
}
document.addEventListener('DOMContentLoaded', updateTrailerRelatedFields);

import { getConfig } from "../config.js";
import { bindCheckboxKontrol, createCheckbox, createSection } from "./shared.js";

export function createPausePanel(_config, labels) {
  var config = getConfig();
  var sap = Object.assign({
    enabled: true,
    blurMinutes: 0.5,
    hiddenMinutes: 0.2,
    idleMinutes: 45,
    useIdleDetection: true,
    respectPiP: true,
    ignoreShortUnderSec: 300
  }, (config.smartAutoPause || {}));

  var panel = document.createElement('div');
  panel.id = 'pause-panel';
  panel.className = 'settings-panel';

  var section = createSection(labels.pauseSettings || 'Configurações da Tela de Pausa');

  var pauseCssVariantContainer = document.createElement('div');
  pauseCssVariantContainer.className = 'fsetting-item';

  var pauseCssVariantLabel = document.createElement('label');
  pauseCssVariantLabel.textContent = labels.pauseOverlayCssVariant || 'Estilo da Tela de Pausa';
  pauseCssVariantLabel.htmlFor = 'pauseOverlayCssVariant';
  pauseCssVariantLabel.className = 'settings-label';

  var pauseCssVariantSelect = document.createElement('select');
  pauseCssVariantSelect.name = 'pauseOverlayCssVariant';
  pauseCssVariantSelect.id = 'pauseOverlayCssVariant';
  pauseCssVariantSelect.className = 'settings-select';

  [
    ['moduloPausa', labels.pauseOverlayCssVariant_pauseModul || 'Stil 1'],
    ['moduloPausa2', labels.pauseOverlayCssVariant_pauseModul2 || 'Stil 2']
  ].forEach(function(([value, text]) {
    var option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = (config.pauseOverlay.cssVariant || 'moduloPausa') === value;
    pauseCssVariantSelect.appendChild(option);
  });

  pauseCssVariantContainer.appendChild(pauseCssVariantLabel);
  pauseCssVariantContainer.appendChild(pauseCssVariantSelect);
  section.appendChild(pauseCssVariantContainer);

  var pauseCssVariantDescription = document.createElement('div');
  pauseCssVariantDescription.className = 'description-text';
  pauseCssVariantDescription.textContent =
    labels.pauseOverlayCssVariantDescription ||
    'Escolha o design CSS a ser usado na tela de pausa.';
  section.appendChild(pauseCssVariantDescription);

  var enableCheckbox = createCheckbox(
    'pauseOverlay',
    labels.enablePauseOverlay || 'Ativar Tela de Pausa',
    config.pauseOverlay.enabled
  );
  section.appendChild(enableCheckbox);

  var description = document.createElement('div');
  description.className = 'description-text';
  description.textContent = labels.pauseOverlayDescription ||
      'Quando este recurso está ativado, uma tela exibindo informações do conteúdo será mostrada quando o vídeo for pausado.';
  section.appendChild(description);
  var imagePrefContainer = document.createElement('div');
  imagePrefContainer.className = 'fsetting-item';

  var imagePrefLabel = document.createElement('label');
  imagePrefLabel.textContent = labels.pauseImagePreference || 'Prioridade de Imagem';
  imagePrefLabel.htmlFor = 'pauseOverlayImagePreference';
  imagePrefLabel.className = 'settings-label';

  var imagePrefSelect = document.createElement('select');
  imagePrefSelect.name = 'pauseOverlayImagePreference';
  imagePrefSelect.id = 'pauseOverlayImagePreference';
  imagePrefSelect.className = 'settings-select';

  ['auto', 'logo', 'disc', 'title', 'logo-title', 'disc-logo-title', 'disc-title'].forEach(function(value) {
    var option = document.createElement('option');
    option.value = value;
    option.textContent = labels['pauseImage_' + value] || value;
    option.selected = config.pauseOverlay.imagePreference === value;
    imagePrefSelect.appendChild(option);
  });

  imagePrefContainer.appendChild(imagePrefLabel);
  imagePrefContainer.appendChild(imagePrefSelect);
  section.appendChild(imagePrefContainer);

  var showPlotCheckbox = createCheckbox(
    'pauseOverlayShowPlot',
    labels.showPlot || 'Mostrar Sinopse',
    config.pauseOverlay.showPlot !== false
  );
  section.appendChild(showPlotCheckbox);

  var showMetadataCheckbox = createCheckbox(
    'pauseOverlayShowMetadata',
    labels.showMetadata || 'Mostrar Linhas de Informação',
    config.pauseOverlay.showMetadata !== false
  );
  section.appendChild(showMetadataCheckbox);

  var showLogoCheckbox = createCheckbox(
    'pauseOverlayShowLogo',
    labels.showLogo || 'Mostrar Logo/Disco/Texto',
    config.pauseOverlay.showLogo !== false
  );
  section.appendChild(showLogoCheckbox);

  var showBackdropCheckbox = createCheckbox(
    'pauseOverlayShowBackdrop',
    labels.showBackdrop || 'Mostrar Imagem de Fundo',
    config.pauseOverlay.showBackdrop !== false
  );
  section.appendChild(showBackdropCheckbox);

  var closeOnMouseMoveCheckbox = createCheckbox(
    'pauseOverlayCloseOnMouseMove',
    labels.closeOnMouseMove || 'Fechar tela de pausa ao mover o mouse',
    config.pauseOverlay.closeOnMouseMove !== false
  );
  section.appendChild(closeOnMouseMoveCheckbox);

  var minDurRow = addNumberRow({
    name: 'pauseOverlayMinVideoMinutes',
    label: labels.pauseOverlayMinVideoMinutes || 'Duração mínima do vídeo (selo/overlay)',
    value: Math.max(1, Number(config.pauseOverlay.minVideoMinutes || 5) || 5),
    min: 1,
    max: 1000,
    step: 1,
    suffix: labels.dk || 'min'
});
  section.appendChild(minDurRow);

  var minDurDesc = document.createElement('div');
  minDurDesc.className = 'description-text';
  minDurDesc.textContent =
    labels.pauseOverlayMinVideoMinutesDesc
    || 'Selo superior e tela de pausa não serão exibidos em vídeos mais curtos (min) que este valor.';
  section.appendChild(minDurDesc);

  var osdHeaderRatingsHeader = document.createElement('h3');
  osdHeaderRatingsHeader.className = 'settings-subheader';
  osdHeaderRatingsHeader.textContent = labels.osdHeaderRatingsHeader || 'Avaliações no Cabeçalho OSD';
  section.appendChild(osdHeaderRatingsHeader);

  var showOsdHeaderRatingsCheckbox = createCheckbox(
    'pauseOverlayShowOsdHeaderRatings',
    labels.showOsdHeaderRatings || 'Mostrar avaliações no cabeçalho OSD',
    config.pauseOverlay.showOsdHeaderRatings !== false
  );
  section.appendChild(showOsdHeaderRatingsCheckbox);

  var osdHeaderRatingsSubOptions = document.createElement('div');
  osdHeaderRatingsSubOptions.className = 'sub-options pause-osd-header-rating-sub-options';
  osdHeaderRatingsSubOptions.appendChild(createCheckbox(
    'pauseOverlayShowOsdHeaderCommunityRating',
    labels.showCommunityRating || 'Comunidade',
    config.pauseOverlay.showOsdHeaderCommunityRating !== false
  ));
  osdHeaderRatingsSubOptions.appendChild(createCheckbox(
    'pauseOverlayShowOsdHeaderCriticRating',
    labels.showCriticRating || 'Rotten Tomatoes',
    config.pauseOverlay.showOsdHeaderCriticRating !== false
  ));
  osdHeaderRatingsSubOptions.appendChild(createCheckbox(
    'pauseOverlayShowOsdHeaderOfficialRating',
    labels.showOfficialRating || 'Certificação',
    config.pauseOverlay.showOsdHeaderOfficialRating !== false
  ));
  section.appendChild(osdHeaderRatingsSubOptions);

  var osdHeaderRatingsDesc = document.createElement('div');
  osdHeaderRatingsDesc.className = 'description-text';
  osdHeaderRatingsDesc.textContent =
    labels.osdHeaderRatingsDescription ||
    'Controla as avaliações que aparecem ao lado do nome do conteúdo no cabeçalho superior da tela de reprodução.';
  section.appendChild(osdHeaderRatingsDesc);

  bindCheckboxKontrol('#pauseOverlayShowOsdHeaderRatings', '.pause-osd-header-rating-sub-options');

  var ageBadgeHeader = document.createElement('h3');
  ageBadgeHeader.className = 'settings-subheader';
  ageBadgeHeader.textContent = labels.ageBadgeSettings || 'Configurações de Classificação Etária';
  section.appendChild(ageBadgeHeader);

  var showAgeBadgeCheckbox = createCheckbox(
    'pauseOverlayShowAgeBadge',
    labels.showAgeBadge || 'Mostrar classificação etária',
    (config.pauseOverlay.showAgeBadge !== false)
  ) ;
  section.appendChild(showAgeBadgeCheckbox);

  var minDelayRow = addNumberRow({
    name: 'badgeDelayMs',
    label: (labels.pauseOverlayBadgeDelayMs || 'Atraso para Exibição do Selo'),
    value: Math.max(1, Math.round((config.pauseOverlay.badgeDelayMs || 5000) / 1000)),
    min: 1,
    max: 3600,
    step: 1,
    suffix: labels.sn || 'sn'
  });
  section.appendChild(minDelayRow);

  var minDelayResumeRow = addNumberRow({
    name: 'badgeDelayResumeMs',
    label: (labels.badgeDelayResumeMs || 'Atraso do Selo ao Retomar'),
    value: Math.max(1, Math.round((config.pauseOverlay.badgeDelayResumeMs || 5000) / 1000)),
    min: 1,
    max: 3600,
    step: 1,
    suffix: labels.sn || 'sn'
  });
  section.appendChild(minDelayResumeRow);

  var ageBadgeDurationRow = addNumberRow({
    name: 'ageBadgeDurationSec',
    label: (labels.ageBadgeDurationSec || 'Duração da exibição da classificação etária'),
    value: Math.max(1, Math.round((config.pauseOverlay.ageBadgeDurationMs || 12000) / 1000)),
    min: 1,
    max: 3600,
    step: 1,
    suffix: labels.sn || 'sn'
  });
  section.appendChild(ageBadgeDurationRow);

  var ageBadgeDurationResumeMs = addNumberRow({
    name: 'ageBadgeDurationResumeMs',
    label: (labels.ageBadgeDurationResumeMs || 'Duração da Exibição do Selo ao Retomar'),
    value: Math.max(1, Math.round((config.pauseOverlay.ageBadgeDurationResumeMs || 5000) / 1000)),
    min: 1,
    max: 3600,
    step: 1,
    suffix: labels.sn || 'sn'
  });
  section.appendChild(ageBadgeDurationResumeMs);

  var ageBadgeLockRow = addNumberRow({
    name: 'ageBadgeLockSec',
    label: (labels.ageBadgeLockSec || 'Bloqueio de reexibição da classificação etária'),
    value: Math.max(0, Math.round((config.pauseOverlay.ageBadgeLockMs || 6000) / 1000)),
    min: 0,
    max: 3600,
    step: 1,
    suffix: labels.sn || 'sn'
  });
  section.appendChild(ageBadgeLockRow);

  var ageBadgeDesc = document.createElement('div');
  ageBadgeDesc.className = 'description-text';
  ageBadgeDesc.textContent =
    (labels.ageBadgeDesc ||
     'O selo desaparece após o tempo de exibição. O selo não será mostrado novamente durante o tempo de bloqueio.');
  section.appendChild(ageBadgeDesc);

  var sapSec = createSection(labels.smartPauseSettings || 'Pausa Automática Inteligente');
  var sapEnableCheckbox = createCheckbox(
    'sapEnabled',
    labels.smartAutoPauseEnable || 'Pausa Automática Inteligente Ativada',
    sap.enabled !== false
  );
  sapSec.appendChild(sapEnableCheckbox);

  var sapDesc = document.createElement('div');
  sapDesc.className = 'description-text';
  sapDesc.textContent =
    labels.smartAutoPauseDescription ||
    'Pausa o vídeo após os minutos especificados em caso de perda de foco, ocultação/minimização da aba ou inatividade do usuário. Suporta valores decimais (ex: 0.2 min).';
  sapSec.appendChild(sapDesc);

  function addNumberRow({name, label, value, min=0.1, max=1000, step=0.1, suffix=labels.dk})  {
  var wrap = document.createElement('div');
  wrap.className = 'fsetting-item';
  var lab = document.createElement('label');
  lab.textContent = label;
  lab.className = 'settings-label';
  lab.htmlFor = name;
  var inputWrap = document.createElement('div');
  inputWrap.className = 'settings-input';
  var inp = document.createElement('input');
  inp.type = 'number';
  inp.name = name;
  inp.id = name;
  inp.min = String(min);
  inp.max = String(max);
  inp.step = String(step);
  inp.value = (value || '').toString();
  inp.style.width = '110px';
  var suf = document.createElement('span');
  suf.textContent = ' ' + suffix;
  suf.style.marginLeft = '6px';
  inputWrap.appendChild(inp);
  inputWrap.appendChild(suf);
  wrap.appendChild(lab);
  wrap.appendChild(inputWrap);
  return wrap;
}

  var TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  sapSec.appendChild(
    addNumberRow({
      name: 'sapBlurMs',
      label: (labels.smartUnfocusedThreshold || 'Espera fora de foco') + ' (ms)',
      value: Math.round(sap.blurMinutes * 60000),
      min: 100,
      max: TWO_HOURS_MS,
      step: 100,
      suffix: labels.ms || 'ms'
    })
  );

  sapSec.appendChild(
    addNumberRow({
      name: 'sapHiddenMs',
      label: (labels.smartOffscreenThreshold || 'Espera aba oculta/minimizada') + ' (ms)',
      value: Math.round(sap.hiddenMinutes * 60000),
      min: 100,
      max: TWO_HOURS_MS,
      step: 100,
      suffix: labels.ms || 'ms'
    })
  );

  sapSec.appendChild(
    addNumberRow({
      name: 'sapIdleMinutes',
      label: labels.smartIdleThreshold || 'Espera sem atividade',
      value: sap.idleMinutes,
      min: 1,
      max: 1000,
      step: 1,
      suffix: labels.dk || 'min'
    })
  );

  var shortWrap = document.createElement('div');
  shortWrap.className = 'fsetting-item';
  var shortLab = document.createElement('label');
  shortLab.textContent = labels.sapIgnoreShortUnderSec || 'Desativar em vídeos curtos (abaixo de segundos)';
  shortLab.className = 'settings-label';
  shortLab.htmlFor = 'sapIgnoreShortUnderSec';

  var shortInputWrap = document.createElement('div');
  shortInputWrap.className = 'settings-input';
  var shortInp = document.createElement('input');
  shortInp.type = 'number';
  shortInp.name = 'sapIgnoreShortUnderSec';
  shortInp.id = 'sapIgnoreShortUnderSec';
  shortInp.min = '0';
  shortInp.step = '1';
  shortInp.value = (sap.ignoreShortUnderSec || 300).toString();
  shortInp.style.width = '110px';

  var shortSuf = document.createElement('span');
  shortSuf.textContent =  labels.sn;
  shortSuf.style.marginLeft = '6px';
  shortInputWrap.appendChild(shortInp);
  shortInputWrap.appendChild(shortSuf);
  shortWrap.appendChild(shortLab);
  shortWrap.appendChild(shortInputWrap);
  sapSec.appendChild(shortWrap);

  var sapIdleDetectCheckbox = createCheckbox(
    'sapUseIdleDetection',
    labels.smartUseIdleDetection || 'Usar detecção de inatividade (idle) do usuário',
    sap.useIdleDetection !== false
  );
  sapSec.appendChild(sapIdleDetectCheckbox);
  var sapRespectPiPCheckbox = createCheckbox(
    'sapRespectPiP',
    labels.smartRespectPiP || 'Não pausar enquanto Picture-in-Picture (PiP) estiver aberto',
    sap.respectPiP !== false
  );
  sapSec.appendChild(sapRespectPiPCheckbox);

  panel.appendChild(section);
  panel.appendChild(sapSec);

  return panel;
}

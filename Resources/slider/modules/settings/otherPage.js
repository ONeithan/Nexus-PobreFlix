import { getConfig } from "../config.js";
import { compareSemver, fetchLatestGitHubVersion } from "../update.js";
import { createCheckbox, createSection, createImageTypeSelect, bindCheckboxKontrol, bindTersCheckboxKontrol } from "./shared.js";
import { clearQualityBadgesCacheAndRefresh } from "../qualityBadges.js";
import { fetchJmsPluginConfig } from "../jmsPluginConfig.js";

export function createStatusRatingPanel(config, labels) {
        var panel = document.createElement('div');
        panel.id = 'status-rating-panel';
        panel.className = 'settings-panel';

        var statusSection = createSection(labels.showStatusInfo || 'Informações de Status');
        var statusCheckbox = createCheckbox('showStatusInfo', labels.showStatusInfo || 'Mostrar Informações de Status', config.showStatusInfo);
        statusSection.appendChild(statusCheckbox);

        var statusSubOptions = document.createElement('div');
        statusSubOptions.className = 'sub-options status-sub-options';
        statusSubOptions.appendChild(createCheckbox('showTypeInfo', labels.showTypeInfo || 'Tipo de Mídia', config.showTypeInfo));
        statusSubOptions.appendChild(createCheckbox('showWatchedInfo', labels.showWatchedInfo || 'Visto', config.showWatchedInfo));
        statusSubOptions.appendChild(createCheckbox('showRuntimeInfo', labels.showRuntimeInfo || 'Duração', config.showRuntimeInfo));
        statusSubOptions.appendChild(createCheckbox('showQualityInfo', labels.showQualityInfo || 'Qualidade', config.showQualityInfo));

        var qualityDetailSubOptions = document.createElement('div');
        qualityDetailSubOptions.className = 'sub-options quality-detail-options';
        qualityDetailSubOptions.appendChild(createCheckbox('showQualityDetail', labels.showQualityDetail || 'Detalhes da Qualidade', config.showQualityDetail));
        statusSubOptions.appendChild(qualityDetailSubOptions);
        statusSection.appendChild(statusSubOptions);

        statusSubOptions.appendChild(createCheckbox('enableQualityBadges', labels.enableQualityBadges || 'Mostrar selo de qualidade nos posters', config.enableQualityBadges));

        var badgeCacheControls = document.createElement('div');
        badgeCacheControls.className = 'inline-actions quality-badge-actions';

        var btnClear = document.createElement('button');
        btnClear.type = 'button';
        btnClear.className = 'btn btn-warning';
        btnClear.title = (labels.clearQualityCacheTitle || 'Limpar cache de selos de qualidade');
        btnClear.textContent = (labels.clearQualityCache || 'Limpar cache de selos de qualidade');
        btnClear.addEventListener('click', function() {
            try {
                clearQualityBadgesCacheAndRefresh();
                var showToast = window.showToast;
                if (showToast && typeof showToast === "function") {
                    showToast(labels.qualityCacheCleared || 'Cache de selos de qualidade limpo e reconstruído.');
                } else {
                    alert(labels.qualityCacheCleared || 'Cache de selos de qualidade limpo e reconstruído.');
                }
            } catch (e) {
                var showToast = window.showToast;
                if (showToast && typeof showToast === "function") {
                    showToast(labels.qualityCacheClearError || 'Ocorreu um erro ao limpar o cache.');
                } else {
                    alert(labels.qualityCacheClearError || 'Ocorreu um erro ao limpar o cache.');
                }
                console.warn('clearQualityBadgesCacheAndRefresh error:', e);
            }
        });

        badgeCacheControls.append(btnClear);
        statusSubOptions.appendChild(badgeCacheControls);

        bindCheckboxKontrol('#showStatusInfo', '.status-sub-options');
        bindCheckboxKontrol('#showQualityInfo', '.quality-detail-options');

        var ratingSection = createSection(labels.ratingInfoHeader || 'Informações de Avaliação');
        var ratingCheckbox = createCheckbox('showRatingInfo', labels.ratingInfo || 'Mostrar Avaliações', config.showRatingInfo);
        ratingSection.appendChild(ratingCheckbox);

        var ratingSubOptions = document.createElement('div');
        ratingSubOptions.className = 'sub-options rating-sub-options';
        ratingSubOptions.appendChild(createCheckbox('showCommunityRating', labels.showCommunityRating || 'Comunidade', config.showCommunityRating));
        ratingSubOptions.appendChild(createCheckbox('showCriticRating', labels.showCriticRating || 'Rotten Tomatoes', config.showCriticRating));
        ratingSubOptions.appendChild(createCheckbox('showOfficialRating', labels.showOfficialRating || 'Certificação', config.showOfficialRating));
        ratingSubOptions.appendChild(createCheckbox('showMatchPercentage', labels.showMatchPercentage || 'Sugestão', config.showMatchPercentage));
        ratingSection.appendChild(ratingSubOptions);

        bindCheckboxKontrol('#showRatingInfo', '.rating-sub-options');

        var metaIconColorsCheckbox = createCheckbox('metaIconColors', labels.metaIconColors || 'Usar cores nos ícones de metadados', config.metaIconColors);
        ratingSection.appendChild(metaIconColorsCheckbox);

        var description = document.createElement('div');
        description.className = 'description-text';
        description.textContent = labels.statusRatingDescription || 'Este ajuste controla a visibilidade de qualidade, status de visualização, tipo de mídia, duração e informações de avaliação do conteúdo.';
        ratingSection.appendChild(description);

        panel.append(statusSection, ratingSection);
        return panel;
    }

export function createActorPanel(config, labels) {
        var panel = document.createElement('div');
        panel.id = 'actor-panel';
        panel.className = 'settings-panel';

        var section = createSection(labels.actorInfo || 'Informações de Artistas');

        var actorAllCheckbox = createCheckbox('showActorAll', labels.showActorAll || 'Nenhum', config.showActorAll);
        section.appendChild(actorAllCheckbox);

        var actorCheckbox = createCheckbox('showActorInfo', labels.showActorInfo || 'Mostrar Nomes dos Artistas', config.showActorInfo);
        var actorCheckboxInput = actorCheckbox.querySelector('input');
        actorCheckboxInput.setAttribute('data-group', 'actor');
        section.appendChild(actorCheckbox);

        var actorSubOptions = document.createElement('div');
        actorSubOptions.className = 'sub-options actor-sub-options';
        var actorImgCheckbox = createCheckbox('showActorImg', labels.showActorImg || 'Mostrar Fotos dos Artistas', config.showActorImg);
        var actorImgCheckboxInput = actorImgCheckbox.querySelector('input');
        actorImgCheckboxInput.setAttribute('data-group', 'actor');
        actorSubOptions.appendChild(actorImgCheckbox);
        section.appendChild(actorSubOptions);

        var actorRolOptions = document.createElement('div');
        actorRolOptions.className = 'sub-options actor-rol-options';
        var actorRoleCheckbox = createCheckbox('showActorRole', labels.showActorRole || 'Mostrar Papéis dos Artistas', config.showActorRole);
        var actorRoleCheckboxInput = actorRoleCheckbox.querySelector('input');
        actorRoleCheckboxInput.setAttribute('data-group', 'actor');
        actorRolOptions.appendChild(actorRoleCheckbox);
        section.appendChild(actorRolOptions);

        var artistLimitDiv = document.createElement('div');
        artistLimitDiv.className = 'setting-item artist-limit-container';
        var artistLimitLabel = document.createElement('label');
        artistLimitLabel.textContent = labels.artistLimit || 'Número de Atores a Exibir:';
        var artistLimitInput = document.createElement('input');
        artistLimitInput.type = 'number';
        artistLimitInput.value = config.artistLimit || 3;
        artistLimitInput.name = 'artistLimit';
        artistLimitInput.min = 1;
        artistLimitInput.step = 1;
        artistLimitInput.setAttribute('data-group', 'actor');
        artistLimitLabel.htmlFor = 'artistLimitInput';
        artistLimitInput.id = 'artistLimitInput';
        artistLimitDiv.append(artistLimitLabel, artistLimitInput);
        section.appendChild(artistLimitDiv);

        var description = document.createElement('div');
        description.className = 'description-text';
        description.textContent = labels.actorInfoDescription || 'Este ajuste controla a visibilidade das informações dos primeiros artistas do conteúdo.';
        section.appendChild(description);

        panel.appendChild(section);

    setTimeoutfunction(() {
        bindTersCheckboxKontrol(
            'input[name="showActorAll"]',
            null,
            0.5,
            Array.from(panel.querySelectorAll('[data-group="actor"]'))
        );
    }, 0);

    return panel;
}

 export function createDirectorPanel(config, labels) {
        var panel = document.createElement('div');
        panel.id = 'director-panel';
        panel.className = 'settings-panel';

        var section = createSection(labels.directorWriter || 'Configurações de Diretor e Roteirista');
        var directorCheckbox = createCheckbox('showDirectorWriter', labels.showDirectorWriter || 'Mostrar Informações de Diretor e Roteirista', config.showDirectorWriter);
        section.appendChild(directorCheckbox);

        var subOptions = document.createElement('div');
        subOptions.className = 'sub-options director-sub-options';
        subOptions.appendChild(createCheckbox('showDirector', labels.showDirector || 'Diretor', config.showDirector));
        subOptions.appendChild(createCheckbox('showWriter', labels.showWriter || 'Roteirista', config.showWriter));
        section.appendChild(subOptions);

        bindCheckboxKontrol('#showDirectorWriter', '.director-sub-options');

        var description = document.createElement('div');
        description.className = 'description-text';
        description.textContent = labels.directorWriterDescription || 'Este ajuste controla a visibilidade do roteirista e diretor do conteúdo. (Apenas se estiverem na lista abaixo)';
        section.appendChild(description);

        var writersHeader = document.createElement('h2');
        writersHeader.textContent = labels.writersListHeader || 'Lista de Roteiristas';
        section.appendChild(writersHeader);

        var writersDiv = document.createElement('div');
        writersDiv.className = 'setting-item writersLabel';
        var writersLabel = document.createElement('label');
        writersLabel.textContent = labels.writersListLabel || 'Separe os nomes por vírgula:';
        var writersInput = document.createElement('textarea');
        writersInput.id = 'allowedWritersInput';
        writersInput.name = 'allowedWriters';
        writersInput.rows = 4;
        writersInput.placeholder = labels.writersListPlaceholder || 'Exemplo: Quentin TARANTINO, Steven SPIELBERG';
        writersInput.value = config.allowedWriters ? config.allowedWriters.join(', ') : '';
        writersLabel.htmlFor = 'writersInput';
        writersInput.id = 'writersInput';
        writersDiv.append(writersLabel, writersInput);
        section.appendChild(writersDiv);

        var entryTimeDiv = document.createElement('div');
        entryTimeDiv.className = 'setting-item writersLabel';
        var entryTimeLabel = document.createElement('label');
        entryTimeLabel.textContent = labels.entryTime || 'Tempo de Entrada (ms):';
        var entryTimeInput = document.createElement('input');
        entryTimeInput.type = 'number';
        entryTimeInput.value = config.tempoEntrada || 1000;
        entryTimeInput.name = 'tempoEntrada';
        entryTimeInput.min = 50;
        entryTimeInput.step = 50;

        entryTimeLabel.htmlFor = 'entryTimeInput';
        entryTimeInput.id = 'entryTimeInput';
        entryTimeDiv.append(entryTimeLabel, entryTimeInput);
        section.appendChild(entryTimeDiv);

        var activeTimeDiv = document.createElement('div');
        activeTimeDiv.className = 'setting-item writersLabel';
        var activeTimeLabel = document.createElement('label');
        activeTimeLabel.textContent = labels.activeTime || 'Tempo de Atividade (ms):';
        var activeTimeInput = document.createElement('input');
        activeTimeInput.type = 'number';
        activeTimeInput.value = config.tempoAtivo || 5000;
        activeTimeInput.name = 'tempoAtivo';
        activeTimeInput.min = 50;
        activeTimeInput.step = 50;
        activeTimeLabel.htmlFor = 'activeTimeInput';
        activeTimeInput.id = 'activeTimeInput';
        activeTimeDiv.append(activeTimeLabel, activeTimeInput);
        section.appendChild(activeTimeDiv);

        panel.appendChild(section);
        return panel;
    }

export function createInfoPanel(config, labels) {
    var panel = document.createElement('div');
    panel.id = 'info-panel';
    panel.className = 'settings-panel';

    var section = createSection(labels.infoHeader || 'Informações de Gênero, Ano e País');
    var infoCheckbox = createCheckbox('showInfo', labels.showInfo || 'Mostrar Gênero, Ano e País', config.showInfo);
    section.appendChild(infoCheckbox);

    var subOptions = document.createElement('div');
    subOptions.className = 'sub-options info-sub-options';
    subOptions.appendChild(createCheckbox('showGenresInfo', labels.showGenresInfo || 'Gênero', config.showGenresInfo));
    subOptions.appendChild(createCheckbox('showYearInfo', labels.showYearInfo || 'Ano', config.showYearInfo));
    subOptions.appendChild(createCheckbox('showCountryInfo', labels.showCountryInfo || 'País', config.showCountryInfo));
    section.appendChild(subOptions);

    bindCheckboxKontrol('#showInfo', '.info-sub-options');

    var description = document.createElement('div');
    description.className = 'description-text';
    description.textContent = labels.infoDescription || 'Este ajuste controla a visibilidade de gênero, ano de produção e país de origem do conteúdo.';
    section.appendChild(description);

    panel.appendChild(section);
    return panel;
}


export function createLogoTitlePanel(config, labels) {
    var panel = document.createElement('div');
    panel.id = 'logo-title-panel';
    panel.className = 'settings-panel';

    var section = createSection(labels.logoOrTitleHeader || 'Configurações de Logo / Título');
    var logoCheckbox = createCheckbox('showLogoOrTitle', labels.showLogoOrTitle || 'Mostrar Logo', config.showLogoOrTitle);
    section.appendChild(logoCheckbox);

    var displayOrderDiv = document.createElement('div');
    displayOrderDiv.className = 'sub-options logo-sub-options';
    displayOrderDiv.id = 'displayOrderContainer';
    var displayOrderLabel = document.createElement('label');
    var displayOrderSpan = document.createElement('span');
    displayOrderSpan.textContent = labels.displayOrderlabel || 'Ordem de Exibição:';
    var displayOrderInput = document.createElement('input');
    displayOrderInput.type = 'text';
    displayOrderInput.id = 'displayOrderInput';
    displayOrderInput.name = 'displayOrder';
    displayOrderInput.placeholder = 'logo,disk,originalTitle';
    displayOrderInput.value = config.displayOrder || 'logo,disk,originalTitle';
    var displayOrderSmall = document.createElement('small');
    displayOrderSmall.textContent = labels.displayOrderhelp || '(Exemplo: logo,disk,originalTitle)';
    displayOrderLabel.append(displayOrderSpan, displayOrderInput, displayOrderSmall);
    displayOrderDiv.appendChild(displayOrderLabel);
    section.appendChild(displayOrderDiv);

    var titleOnlyCheckbox = createCheckbox('showTitleOnly', labels.showTitleOnly || 'Mostrar Título Original em vez do Logo', config.showTitleOnly);
    var titleOnlyDiv = document.createElement('div');
    titleOnlyDiv.className = 'sub-options title-sub-options';
    titleOnlyDiv.id = 'showTitleOnlyLabel';
    titleOnlyDiv.appendChild(titleOnlyCheckbox);
    section.appendChild(titleOnlyDiv);

    var discOnlyCheckbox = createCheckbox('showDiscOnly', labels.showDiscOnly || 'Mostrar Disco em vez do Logo', config.showDiscOnly);
    var discOnlyDiv = document.createElement('div');
    discOnlyDiv.className = 'sub-options disc-sub-options';
    discOnlyDiv.id = 'showDiscOnlyLabel';
    discOnlyDiv.appendChild(discOnlyCheckbox);
    section.appendChild(discOnlyDiv);

    function setupMutuallyExclusive(checkbox1, checkbox2) {
        var cb1 = checkbox1.querySelector('input');
        var cb2 = checkbox2.querySelector('input');

        cb1.addEventListener('change', function() {
            if (this.checked) {
                cb2.checked = false;
            }
        });

        cb2.addEventListener('change', function() {
            if (this.checked) {
                cb1.checked = false;
            }
        });
    }

    setupMutuallyExclusive(titleOnlyCheckbox, discOnlyCheckbox);

    bindCheckboxKontrol('#showLogoOrTitle', '.logo-sub-options');
    bindTersCheckboxKontrol('#showLogoOrTitle', '.title-sub-options');
    bindTersCheckboxKontrol('#showLogoOrTitle', '.disc-sub-options');

    if (titleOnlyCheckbox.querySelector('input').checked && discOnlyCheckbox.querySelector('input').checked) {
        discOnlyCheckbox.querySelector('input').checked = false;
    }

    var description = document.createElement('div');
    description.className = 'description-text';
    description.textContent = labels.logoOrTitleDescription || 'Este ajuste controla a visibilidade do logo ou título original no slider.';
    section.appendChild(description);

    panel.appendChild(section);
    return panel;
}

export function createDescriptionPanel(config, labels) {
    var panel = document.createElement('div');
    panel.id = 'description-panel';
    panel.className = 'settings-panel';

    var section = createSection(labels.descriptionsHeader || 'Configurações de Descrição');
    var descCheckbox = createCheckbox('showDescriptions', labels.showDescriptions || 'Mostrar Informações', config.showDescriptions);
    section.appendChild(descCheckbox);

    var subOptions = document.createElement('div');
    subOptions.className = 'sub-options desc-sub-options';
    subOptions.appendChild(createCheckbox('showSloganInfo', labels.showSloganInfo || 'Slogan', config.showSloganInfo));
    subOptions.appendChild(createCheckbox('showTitleInfo', labels.showTitleInfo || 'Título', config.showTitleInfo));
    subOptions.appendChild(createCheckbox('showOriginalTitleInfo', labels.showOriginalTitleInfo || 'Título Original', config.showOriginalTitleInfo));

    var hideIfSameWrapper = document.createElement('div');
    hideIfSameWrapper.className = 'hide-original-if-same-wrapper';
    hideIfSameWrapper.appendChild(createCheckbox('hideOriginalTitleIfSame', labels.hideOriginalTitleIfSame || 'Ocultar Título Original se for igual ao Título', config.hideOriginalTitleIfSame));
    subOptions.appendChild(hideIfSameWrapper);

    subOptions.appendChild(createCheckbox('showPlotInfo', labels.showPlotInfo || 'Sinopse', config.showPlotInfo));
    subOptions.appendChild(createCheckbox('showPlaybackProgress', labels.showPlaybackProgress || 'Barra de Progresso de Reprodução', config.showPlaybackProgress));

    section.appendChild(subOptions);

    bindCheckboxKontrol('#showDescriptions', '.desc-sub-options');
    bindCheckboxKontrol('#showOriginalTitleInfo', '.hide-original-if-same-wrapper');

    var description = document.createElement('div');
    description.className = 'description-text';
    description.textContent = labels.descriptionsDescription || 'Este ajuste controla a visibilidade da sinopse, slogan, título e informações de título original do conteúdo.';
    section.appendChild(description);

    panel.appendChild(section);
    return panel;
}


export  function createProviderPanel(config, labels) {
    var panel = document.createElement('div');
    panel.id = 'provider-panel';
    panel.className = 'settings-panel';

    var section = createSection(labels.providerHeader || 'Links Externos / Configurações de Provedores');
    section.appendChild(createCheckbox('showProviderInfo', labels.showProviderInfo || 'Mostrar Links de Metadados', config.showProviderInfo));

    var castModuleCheckbox = createCheckbox(
      'enableCastModule',
      labels.enableCastModule || 'Ativar módulo Cast',
      config.enableCastModule
    );
    section.appendChild(castModuleCheckbox);

    var castModuleSubOptions = document.createElement('div');
    castModuleSubOptions.className = 'sub-options cast-module-sub-options';
    castModuleSubOptions.appendChild(createCheckbox('showCast', labels.showCast || 'Mostrar Chromecast', config.showCast));
    castModuleSubOptions.appendChild(createCheckbox(
      'allowSharedCastViewerForUsers',
      labels.allowSharedCastViewerForUsers || 'Permitir que todos os usuários vejam quem está assistindo o quê no módulo Cast',
      config.allowSharedCastViewerForUsers
    ));
    section.appendChild(castModuleSubOptions);
    bindCheckboxKontrol('#enableCastModule', '.cast-module-sub-options');

    var settingsLinkDiv = document.createElement('div');
    settingsLinkDiv.id = 'settingsLinkContainer';
    settingsLinkDiv.appendChild(createCheckbox('showSettingsLink', labels.showSettingsLink || 'Mostrar Atalho de Configurações', config.showSettingsLink));
    section.appendChild(settingsLinkDiv);

    var trailerIconDiv = document.createElement('div');
    trailerIconDiv.appendChild(createCheckbox('showTrailerIcon', labels.showTrailerIcon || 'Mostrar Ícone de Trailer', config.showTrailerIcon));
    section.appendChild(trailerIconDiv);

    var description = document.createElement('div');
    description.className = 'description-text';
    description.textContent = labels.providerDescription || 'Este ajuste controla a visibilidade dos links de metadados externos.';
    section.appendChild(description);

    var castModuleInput = castModuleCheckbox.querySelector('input');
    var showCastInput = castModuleSubOptions.querySelector('input[name="showCast"]');
    var sharedViewerInput = castModuleSubOptions.querySelector('input[name="allowSharedCastViewerForUsers"]');

    var syncCastOptionsWithModule = function() {
      if (!castModuleInput) return;
      if (!castModuleInput.checked) {
        if (showCastInput) {
          showCastInput.checked = false;
        }
        if (sharedViewerInput) {
          sharedViewerInput.checked = false;
        }
      }
    };

    if (castModuleInput) {
      castModuleInput.addEventListener('change', syncCastOptionsWithModule);
      syncCastOptionsWithModule();
    }

    fetchJmsPluginConfig()
      .then(function(pluginConfig) {
        var pluginEnableCastModule =
          (pluginConfig && (pluginConfig.enableCastModule !== undefined ? pluginConfig.enableCastModule : pluginConfig.EnableCastModule));
        var pluginAllowSharedCastViewerForUsers =
          (pluginConfig && (pluginConfig.allowSharedCastViewerForUsers !== undefined ? pluginConfig.allowSharedCastViewerForUsers : pluginConfig.AllowSharedCastViewerForUsers));

        if (castModuleInput) {
          castModuleInput.checked = pluginEnableCastModule !== false;
          castModuleInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (sharedViewerInput) {
          sharedViewerInput.checked = pluginAllowSharedCastViewerForUsers === true;
        }
        syncCastOptionsWithModule();
      })
      .catchfunction(() {});

    if (config && config.currentUserIsAdmin !== true) {
      [castModuleInput, sharedViewerInput].forEach(function((input) {
        if (!input) return;
        input.disabled = true;
        input.style.opacity = '0.6';
      });
    }

    panel.appendChild(section);
    return panel;
}

export function createAboutPanel(labels) {
  var panel = document.createElement('div');
  panel.id = 'about-panel';
  panel.className = 'settings-panel';

  var section = createSection('NEXUS POBREFLIX');

  var info = document.createElement('div');
  info.className = 'nexus-info';
  info.textContent = 'Sobre';
  section.appendChild(info);

  var aboutContent = document.createElement('div');
  aboutContent.className = 'about-content';

  var creatorInfo = document.createElement('p');
  creatorInfo.textContent = "Nexus PobreFlix — Motor Visual Industrial";
  creatorInfo.style.fontWeight = 'bold';
  creatorInfo.style.marginBottom = '20px';

  var supportInfo = document.createElement('p');
  supportInfo.textContent = 'Desenvolvido por ONeithan. Para suporte e atualizações acesse o repositório:';
  supportInfo.style.marginBottom = '10px';

  var githubLink = document.createElement('a');
  githubLink.href = 'https://github.com/ONeithan/Nexus-PobreFlix';
  githubLink.target = '_blank';
  githubLink.textContent = 'GitHub: ONeithan/Nexus-PobreFlix';
  githubLink.style.display = 'block';
  githubLink.style.marginBottom = '10px';
  githubLink.style.color = '#7B2FBE';

  var emailLink = document.createElement('a');
  emailLink.href = 'https://github.com/ONeithan';
  emailLink.target = '_blank';
  emailLink.innerHTML = "Nexus Codex: @ONeithan";
  emailLink.style.display = 'block';
  emailLink.style.color = '#7B2FBE';

  var updateWrap = document.createElement('div');
  updateWrap.className = 'update-check-wrapper';
  updateWrap.style.marginTop = '16px';

  var cfg = getConfig.() || {};
  var currentVersion =
    cfg.extensionVersion || cfg.version || (typeof window !== "undefined" && window.JMS_VERSION) || "0.0.0";

  var currentP = document.createElement('p');
  currentP.className = 'current-version';
  currentP.style.margin = '8px 0';
  currentP.textContent = (labels.currentVersionText || 'Versão Instalada') + ": " + (currentVersion);
  updateWrap.appendChild(currentP);

  var statusP = document.createElement('p');
  statusP.className = 'update-status';
  statusP.style.margin = '6px 0';
  statusP.style.minHeight = '20px';
  updateWrap.appendChild(statusP);

  var checkBtn = document.createElement('button');
  checkBtn.type = 'button';
  checkBtn.className = 'btn check-update-btn';
  checkBtn.title = labels.checkUpdateTitle || 'Verificar versão mais recente no GitHub';
  checkBtn.textContent = labels.checkUpdateText || 'Verificar Atualização';
  checkBtn.style.padding = '8px 12px';
  checkBtn.style.borderRadius = '8px';
  checkBtn.style.border = '1px solid var(--theme-accent, #00a8ff)';
  checkBtn.style.cursor = 'pointer';
  checkBtn.style.background = 'transparent';
  checkBtn.style.color = 'var(--theme-accent, #00a8ff)';
  checkBtn.style.fontWeight = '600';

  var resultSpan = document.createElement('span');
  resultSpan.className = 'update-result-link';
  resultSpan.style.marginLeft = '12px';

  var btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.alignItems = 'center';
  btnRow.append(checkBtn, resultSpan);

  updateWrap.appendChild(btnRow);

  var checking = false;
  checkBtn.addEventListenerfunction('click', () {
    if (checking) return;
    checking = true;
    var prev = checkBtn.textContent;
    checkBtn.textContent = (labels.checkingText || 'Verificando…');
    checkBtn.disabled = true;
    statusP.textContent = '';
    resultSpan.textContent = '';

    try {
      var { version: latest, html_url } = fetchLatestGitHubVersion("ONeithan", "Nexus-PobreFlix");
      if (!latest) {
        statusP.textContent = labels.updateUnknown || 'Não foi possível obter informações da versão.';
      } else {
        var cmp = compareSemver(latest, currentVersion);
        if (cmp > 0) {
          statusP.textContent = (labels.updateAvailable || 'Nova versão disponível') + ": " + (latest);
          var a = document.createElement('a');
          a.href = html_url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = labels.viewOnGithub || 'Ver no GitHub / Baixar';
          a.style.marginLeft = '8px';
          resultSpan.replaceChildren(a);
        } else if (cmp === 0) {
          statusP.textContent = labels.upToDate || 'Você está atualizado.';
        } else {
          statusP.textContent = (labels.localNewer || 'A versão local parece ser mais recente') + " (" + (currentVersion) + " > " + (latest) + ")";
          var a = document.createElement('a');
          a.href = html_url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = labels.viewOnGithub || 'Ver no GitHub';
          a.style.marginLeft = '8px';
          resultSpan.replaceChildren(a);
        }
      }
    } catch (err) {
      statusP.textContent = (labels.updateError || 'Ocorreu um erro durante a verificação.');
      if (window.console) console.warn('Update check error:', err);
    } finally {
      checkBtn.textContent = prev;
      checkBtn.disabled = false;
      checking = false;
    }
  });

  aboutContent.append(creatorInfo, supportInfo, githubLink, emailLink, updateWrap);
  section.appendChild(aboutContent);

  panel.appendChild(section);
  return panel;
}

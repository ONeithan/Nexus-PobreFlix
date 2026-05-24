import { getConfig } from "../config.js";
import { compareSemver, fetchLatestGitHubVersion } from "../update.js";
import { createCheckbox, createSection, createImageTypeSelect, bindCheckboxKontrol, bindTersCheckboxKontrol } from "./shared.js";
import { clearQualityBadgesCacheAndRefresh } from "../qualityBadges.js";
import { fetchJmsPluginConfig } from "../jmsPluginConfig.js";

export function createStatusRatingPanel(config, labels) {
        const panel = document.createElement('div');
        panel.id = 'status-rating-panel';
        panel.className = 'settings-panel';

        const statusSection = createSection(labels.showStatusInfo || 'Durum Bilgileri');
        const statusCheckbox = createCheckbox('showStatusInfo', labels.showStatusInfo || 'Durum Bilgilerini Göster', config.showStatusInfo);
        statusSection.appendChild(statusCheckbox);

        const statusSubOptions = document.createElement('div');
        statusSubOptions.className = 'sub-options status-sub-options';
        statusSubOptions.appendChild(createCheckbox('showTypeInfo', labels.showTypeInfo || 'Medya Türü', config.showTypeInfo));
        statusSubOptions.appendChild(createCheckbox('showWatchedInfo', labels.showWatchedInfo || 'İzlenme', config.showWatchedInfo));
        statusSubOptions.appendChild(createCheckbox('showRuntimeInfo', labels.showRuntimeInfo || 'Süre', config.showRuntimeInfo));
        statusSubOptions.appendChild(createCheckbox('showQualityInfo', labels.showQualityInfo || 'Kalite', config.showQualityInfo));

        const qualityDetailSubOptions = document.createElement('div');
        qualityDetailSubOptions.className = 'sub-options quality-detail-options';
        qualityDetailSubOptions.appendChild(createCheckbox('showQualityDetail', labels.showQualityDetail || 'Kalite Detayı', config.showQualityDetail));
        statusSubOptions.appendChild(qualityDetailSubOptions);
        statusSection.appendChild(statusSubOptions);

        statusSubOptions.appendChild(createCheckbox('enableQualityBadges', labels.enableQualityBadges || 'Posterlerin üzerinde kalite etiketi göster', config.enableQualityBadges));

        const badgeCacheControls = document.createElement('div');
        badgeCacheControls.className = 'inline-actions quality-badge-actions';

        const btnClear = document.createElement('button');
        btnClear.type = 'button';
        btnClear.className = 'btn btn-warning';
        btnClear.title = (labels.clearQualityCacheTitle || 'Kalite rozet önbelleğini temizle');
        btnClear.textContent = (labels.clearQualityCache || 'Kalite rozet önbelleğini temizle');
        btnClear.addEventListener('click', () => {
            try {
                clearQualityBadgesCacheAndRefresh();
                (window.showToast?.(labels.qualityCacheCleared || 'Kalite rozet önbelleği temizlendi ve yeniden oluşturuldu.'))
                ?? alert(labels.qualityCacheCleared || 'Kalite rozet önbelleği temizlendi ve yeniden oluşturuldu.');
            } catch (e) {
                (window.showToast?.(labels.qualityCacheClearError || 'Önbellek temizlenirken bir hata oluştu.'))
                ?? alert(labels.qualityCacheClearError || 'Önbellek temizlenirken bir hata oluştu.');
                console.warn('clearQualityBadgesCacheAndRefresh error:', e);
            }
        });

        badgeCacheControls.append(btnClear);
        statusSubOptions.appendChild(badgeCacheControls);

        bindCheckboxKontrol('#showStatusInfo', '.status-sub-options');
        bindCheckboxKontrol('#showQualityInfo', '.quality-detail-options');

        const ratingSection = createSection(labels.ratingInfoHeader || 'Puan Bilgileri');
        const ratingCheckbox = createCheckbox('showRatingInfo', labels.ratingInfo || 'Derecelendirmeleri Göster', config.showRatingInfo);
        ratingSection.appendChild(ratingCheckbox);

        const ratingSubOptions = document.createElement('div');
        ratingSubOptions.className = 'sub-options rating-sub-options';
        ratingSubOptions.appendChild(createCheckbox('showCommunityRating', labels.showCommunityRating || 'Topluluk', config.showCommunityRating));
        ratingSubOptions.appendChild(createCheckbox('showCriticRating', labels.showCriticRating || 'Rotten Tomato', config.showCriticRating));
        ratingSubOptions.appendChild(createCheckbox('showOfficialRating', labels.showOfficialRating || 'Sertifikasyon', config.showOfficialRating));
        ratingSubOptions.appendChild(createCheckbox('showMatchPercentage', labels.showMatchPercentage || 'Öneri', config.showMatchPercentage));
        ratingSection.appendChild(ratingSubOptions);

        bindCheckboxKontrol('#showRatingInfo', '.rating-sub-options');

        const metaIconColorsCheckbox = createCheckbox('metaIconColors', labels.metaIconColors || 'Metaveri ikonlarında renk kullan', config.metaIconColors);
        ratingSection.appendChild(metaIconColorsCheckbox);

        const description = document.createElement('div');
        description.className = 'description-text';
        description.textContent = labels.statusRatingDescription || 'Bu ayar, içeriğin kalite, izlenme durumu, medya türü, süre ve puanlama bilgilerinin görünürlüğünü kontrol eder.';
        ratingSection.appendChild(description);

        panel.append(statusSection, ratingSection);
        return panel;
    }

export function createActorPanel(config, labels) {
        const panel = document.createElement('div');
        panel.id = 'actor-panel';
        panel.className = 'settings-panel';

        const section = createSection(labels.actorInfo || 'Artist Bilgileri');

        const actorAllCheckbox = createCheckbox('showActorAll', labels.showActorAll || 'Hiçbiri', config.showActorAll);
        section.appendChild(actorAllCheckbox);

        const actorCheckbox = createCheckbox('showActorInfo', labels.showActorInfo || 'Artist İsimlerini Göster', config.showActorInfo);
        const actorCheckboxInput = actorCheckbox.querySelector('input');
        actorCheckboxInput.setAttribute('data-group', 'actor');
        section.appendChild(actorCheckbox);

        const actorSubOptions = document.createElement('div');
        actorSubOptions.className = 'sub-options actor-sub-options';
        const actorImgCheckbox = createCheckbox('showActorImg', labels.showActorImg || 'Artist Resimlerini Göster', config.showActorImg);
        const actorImgCheckboxInput = actorImgCheckbox.querySelector('input');
        actorImgCheckboxInput.setAttribute('data-group', 'actor');
        actorSubOptions.appendChild(actorImgCheckbox);
        section.appendChild(actorSubOptions);

        const actorRolOptions = document.createElement('div');
        actorRolOptions.className = 'sub-options actor-rol-options';
        const actorRoleCheckbox = createCheckbox('showActorRole', labels.showActorRole || 'Artist Rollerini Göster', config.showActorRole);
        const actorRoleCheckboxInput = actorRoleCheckbox.querySelector('input');
        actorRoleCheckboxInput.setAttribute('data-group', 'actor');
        actorRolOptions.appendChild(actorRoleCheckbox);
        section.appendChild(actorRolOptions);

        const artistLimitDiv = document.createElement('div');
        artistLimitDiv.className = 'setting-item artist-limit-container';
        const artistLimitLabel = document.createElement('label');
        artistLimitLabel.textContent = labels.artistLimit || 'Gösterilecek Aktör Sayısı:';
        const artistLimitInput = document.createElement('input');
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

        const description = document.createElement('div');
        description.className = 'description-text';
        description.textContent = labels.actorInfoDescription || 'Bu ayar, içeriğin ilk 3 artist bilgilerinin görünürlüğünü kontrol eder.';
        section.appendChild(description);

        panel.appendChild(section);

    setTimeout(() => {
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
        const panel = document.createElement('div');
        panel.id = 'director-panel';
        panel.className = 'settings-panel';

        const section = createSection(labels.directorWriter || 'Yönetmen ve Yazar Ayarları');
        const directorCheckbox = createCheckbox('showDirectorWriter', labels.showDirectorWriter || 'Yönetmen ve Yazar Bilgilerini Göster', config.showDirectorWriter);
        section.appendChild(directorCheckbox);

        const subOptions = document.createElement('div');
        subOptions.className = 'sub-options director-sub-options';
        subOptions.appendChild(createCheckbox('showDirector', labels.showDirector || 'Yönetmen', config.showDirector));
        subOptions.appendChild(createCheckbox('showWriter', labels.showWriter || 'Yazar', config.showWriter));
        section.appendChild(subOptions);

        bindCheckboxKontrol('#showDirectorWriter', '.director-sub-options');

        const description = document.createElement('div');
        description.className = 'description-text';
        description.textContent = labels.directorWriterDescription || 'Bu ayar, içeriğin yazar ve yönetmen görünürlüğünü kontrol eder. (Yazar bilgisi sadece aşağıdaki listede var ise)';
        section.appendChild(description);

        const writersHeader = document.createElement('h2');
        writersHeader.textContent = labels.writersListHeader || 'Yazarlar Listesi';
        section.appendChild(writersHeader);

        const writersDiv = document.createElement('div');
        writersDiv.className = 'setting-item writersLabel';
        const writersLabel = document.createElement('label');
        writersLabel.textContent = labels.writersListLabel || 'İsimleri virgül ile ayırınız:';
        const writersInput = document.createElement('textarea');
        writersInput.id = 'allowedWritersInput';
        writersInput.name = 'allowedWriters';
        writersInput.rows = 4;
        writersInput.placeholder = labels.writersListPlaceholder || 'Örnek: Quentin TARANTINO, Nuri Bilge CEYLAN';
        writersInput.value = config.allowedWriters ? config.allowedWriters.join(', ') : '';
        writersLabel.htmlFor = 'writersInput';
        writersInput.id = 'writersInput';
        writersDiv.append(writersLabel, writersInput);
        section.appendChild(writersDiv);

        const girisSureDiv = document.createElement('div');
        girisSureDiv.className = 'setting-item writersLabel';
        const girisSureLabel = document.createElement('label');
        girisSureLabel.textContent = labels.girisSure || 'Giriş Süresi (ms):';
        const girisSureInput = document.createElement('input');
        girisSureInput.type = 'number';
        girisSureInput.value = config.girisSure || 1000;
        girisSureInput.name = 'girisSure';
        girisSureInput.min = 50;
        girisSureInput.step = 50;

        girisSureLabel.htmlFor = 'girisSureInput';
        girisSureInput.id = 'girisSureInput';
        girisSureDiv.append(girisSureLabel, girisSureInput);
        section.appendChild(girisSureDiv);

        const aktifSureDiv = document.createElement('div');
        aktifSureDiv.className = 'setting-item writersLabel';
        const aktifSureLabel = document.createElement('label');
        aktifSureLabel.textContent = labels.aktifSure || 'Aktiflik Süresi (ms):';
        const aktifSureInput = document.createElement('input');
        aktifSureInput.type = 'number';
        aktifSureInput.value = config.aktifSure || 5000;
        aktifSureInput.name = 'aktifSure';
        aktifSureInput.min = 50;
        aktifSureInput.step = 50;
        aktifSureLabel.htmlFor = 'aktifSureInput';
        aktifSureInput.id = 'aktifSureInput';
        aktifSureDiv.append(aktifSureLabel, aktifSureInput);
        section.appendChild(aktifSureDiv);

        panel.appendChild(section);
        return panel;
    }

export function createInfoPanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'info-panel';
    panel.className = 'settings-panel';

    const section = createSection(labels.infoHeader || 'Tür, Yıl ve Ülke Bilgileri');
    const infoCheckbox = createCheckbox('showInfo', labels.showInfo || 'Tür, Yıl ve Ülke Bilgilerini Göster', config.showInfo);
    section.appendChild(infoCheckbox);

    const subOptions = document.createElement('div');
    subOptions.className = 'sub-options info-sub-options';
    subOptions.appendChild(createCheckbox('showGenresInfo', labels.showGenresInfo || 'Tür', config.showGenresInfo));
    subOptions.appendChild(createCheckbox('showYearInfo', labels.showYearInfo || 'Yıl', config.showYearInfo));
    subOptions.appendChild(createCheckbox('showCountryInfo', labels.showCountryInfo || 'Ülke', config.showCountryInfo));
    section.appendChild(subOptions);

    bindCheckboxKontrol('#showInfo', '.info-sub-options');

    const description = document.createElement('div');
    description.className = 'description-text';
    description.textContent = labels.infoDescription || 'Bu ayar, içeriğin türü, yapım yılı ve yapımcı ülke bilgilerinin görünürlüğünü kontrol eder.';
    section.appendChild(description);

    panel.appendChild(section);
    return panel;
}


export function createLogoTitlePanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'logo-title-panel';
    panel.className = 'settings-panel';

    const section = createSection(labels.logoOrTitleHeader || 'Logo / Başlık Ayarları');
    const logoCheckbox = createCheckbox('showLogoOrTitle', labels.showLogoOrTitle || 'Logo Görselini Göster', config.showLogoOrTitle);
    section.appendChild(logoCheckbox);

    const displayOrderDiv = document.createElement('div');
    displayOrderDiv.className = 'sub-options logo-sub-options';
    displayOrderDiv.id = 'displayOrderContainer';
    const displayOrderLabel = document.createElement('label');
    const displayOrderSpan = document.createElement('span');
    displayOrderSpan.textContent = labels.displayOrderlabel || 'Görüntüleme Sırası:';
    const displayOrderInput = document.createElement('input');
    displayOrderInput.type = 'text';
    displayOrderInput.id = 'displayOrderInput';
    displayOrderInput.name = 'displayOrder';
    displayOrderInput.placeholder = 'logo,disk,originalTitle';
    displayOrderInput.value = config.displayOrder || 'logo,disk,originalTitle';
    const displayOrderSmall = document.createElement('small');
    displayOrderSmall.textContent = labels.displayOrderhelp || '(Örnek: logo,disk,originalTitle)';
    displayOrderLabel.append(displayOrderSpan, displayOrderInput, displayOrderSmall);
    displayOrderDiv.appendChild(displayOrderLabel);
    section.appendChild(displayOrderDiv);

    const titleOnlyCheckbox = createCheckbox('showTitleOnly', labels.showTitleOnly || 'Logo Yerine Orijinal Başlık Göster', config.showTitleOnly);
    const titleOnlyDiv = document.createElement('div');
    titleOnlyDiv.className = 'sub-options title-sub-options';
    titleOnlyDiv.id = 'showTitleOnlyLabel';
    titleOnlyDiv.appendChild(titleOnlyCheckbox);
    section.appendChild(titleOnlyDiv);

    const discOnlyCheckbox = createCheckbox('showDiscOnly', labels.showDiscOnly || 'Logo Yerine Disk Görseli Göster', config.showDiscOnly);
    const discOnlyDiv = document.createElement('div');
    discOnlyDiv.className = 'sub-options disc-sub-options';
    discOnlyDiv.id = 'showDiscOnlyLabel';
    discOnlyDiv.appendChild(discOnlyCheckbox);
    section.appendChild(discOnlyDiv);

    function setupMutuallyExclusive(checkbox1, checkbox2) {
        const cb1 = checkbox1.querySelector('input');
        const cb2 = checkbox2.querySelector('input');

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

    const description = document.createElement('div');
    description.className = 'description-text';
    description.textContent = labels.logoOrTitleDescription || 'Bu ayar, slider üzerinde logo veya orijinal başlık görünürlüğünü kontrol eder.';
    section.appendChild(description);

    panel.appendChild(section);
    return panel;
}

export function createDescriptionPanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'description-panel';
    panel.className = 'settings-panel';

    const section = createSection(labels.descriptionsHeader || 'Açıklama Ayarları');
    const descCheckbox = createCheckbox('showDescriptions', labels.showDescriptions || 'Bilgileri Göster', config.showDescriptions);
    section.appendChild(descCheckbox);

    const subOptions = document.createElement('div');
    subOptions.className = 'sub-options desc-sub-options';
    subOptions.appendChild(createCheckbox('showSloganInfo', labels.showSloganInfo || 'Slogan', config.showSloganInfo));
    subOptions.appendChild(createCheckbox('showTitleInfo', labels.showTitleInfo || 'Başlık', config.showTitleInfo));
    subOptions.appendChild(createCheckbox('showOriginalTitleInfo', labels.showOriginalTitleInfo || 'Orijinal Başlık', config.showOriginalTitleInfo));

    const hideIfSameWrapper = document.createElement('div');
    hideIfSameWrapper.className = 'hide-original-if-same-wrapper';
    hideIfSameWrapper.appendChild(createCheckbox('hideOriginalTitleIfSame', labels.hideOriginalTitleIfSame || 'Başlık ile Aynı İse Orijinal Başlığı Gösterme', config.hideOriginalTitleIfSame));
    subOptions.appendChild(hideIfSameWrapper);

    subOptions.appendChild(createCheckbox('showPlotInfo', labels.showPlotInfo || 'Konu Metni', config.showPlotInfo));
    subOptions.appendChild(createCheckbox('showPlaybackProgress', labels.showPlaybackProgress || 'Oynatma İlerleme Çubuğu', config.showPlaybackProgress));

    section.appendChild(subOptions);

    bindCheckboxKontrol('#showDescriptions', '.desc-sub-options');
    bindCheckboxKontrol('#showOriginalTitleInfo', '.hide-original-if-same-wrapper');

    const description = document.createElement('div');
    description.className = 'description-text';
    description.textContent = labels.descriptionsDescription || 'Bu ayar, içeriğin konu, slogan, başlık ve orijinal başlık bilgilerinin görünürlüğünü kontrol eder.';
    section.appendChild(description);

    panel.appendChild(section);
    return panel;
}


export  function createProviderPanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'provider-panel';
    panel.className = 'settings-panel';

    const section = createSection(labels.providerHeader || 'Dış Bağlantılar / Sağlayıcı Ayarları');
    section.appendChild(createCheckbox('showProviderInfo', labels.showProviderInfo || 'Metaveri Bağlantıları Göster', config.showProviderInfo));

    const castModuleCheckbox = createCheckbox(
      'enableCastModule',
      labels.enableCastModule || 'Cast modülünü etkinleştir',
      config.enableCastModule
    );
    section.appendChild(castModuleCheckbox);

    const castModuleSubOptions = document.createElement('div');
    castModuleSubOptions.className = 'sub-options cast-module-sub-options';
    castModuleSubOptions.appendChild(createCheckbox('showCast', labels.showCast || 'Chromecast\'ı Göster', config.showCast));
    castModuleSubOptions.appendChild(createCheckbox(
      'allowSharedCastViewerForUsers',
      labels.allowSharedCastViewerForUsers || 'Tüm kullanıcılar cast modülünde kimin ne izlediğini görebilsin',
      config.allowSharedCastViewerForUsers
    ));
    section.appendChild(castModuleSubOptions);
    bindCheckboxKontrol('#enableCastModule', '.cast-module-sub-options');

    const settingsLinkDiv = document.createElement('div');
    settingsLinkDiv.id = 'settingsLinkContainer';
    settingsLinkDiv.appendChild(createCheckbox('showSettingsLink', labels.showSettingsLink || 'Ayarlar Kısayolunu Göster', config.showSettingsLink));
    section.appendChild(settingsLinkDiv);

    const trailerIconDiv = document.createElement('div');
    trailerIconDiv.appendChild(createCheckbox('showTrailerIcon', labels.showTrailerIcon || 'Fragman İkonunu Göster', config.showTrailerIcon));
    section.appendChild(trailerIconDiv);

    const description = document.createElement('div');
    description.className = 'description-text';
    description.textContent = labels.providerDescription || 'Bu ayar, metaveri bağlantılarının görünürlüğünü kontrol eder.';
    section.appendChild(description);

    const castModuleInput = castModuleCheckbox.querySelector('input');
    const showCastInput = castModuleSubOptions.querySelector('input[name="showCast"]');
    const sharedViewerInput = castModuleSubOptions.querySelector('input[name="allowSharedCastViewerForUsers"]');

    const syncCastOptionsWithModule = () => {
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
      .then((pluginConfig) => {
        const pluginEnableCastModule =
          pluginConfig?.enableCastModule ?? pluginConfig?.EnableCastModule;
        const pluginAllowSharedCastViewerForUsers =
          pluginConfig?.allowSharedCastViewerForUsers ?? pluginConfig?.AllowSharedCastViewerForUsers;

        if (castModuleInput) {
          castModuleInput.checked = pluginEnableCastModule !== false;
          castModuleInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (sharedViewerInput) {
          sharedViewerInput.checked = pluginAllowSharedCastViewerForUsers === true;
        }
        syncCastOptionsWithModule();
      })
      .catch(() => {});

    if (config?.currentUserIsAdmin !== true) {
      [castModuleInput, sharedViewerInput].forEach((input) => {
        if (!input) return;
        input.disabled = true;
        input.style.opacity = '0.6';
      });
    }

    panel.appendChild(section);
    return panel;
}

export function createAboutPanel(labels) {
  const panel = document.createElement('div');
  panel.id = 'about-panel';
  panel.className = 'settings-panel';
  panel.style.background = 'linear-gradient(135deg, rgba(88, 28, 135, 0.2) 0%, rgba(15, 23, 42, 0.4) 100%)';
  panel.style.borderRadius = '12px';
  panel.style.padding = '20px';
  panel.style.border = '1px solid rgba(168, 85, 247, 0.3)';

  const section = createSection('SOBRE O NEXUS POBREFLIX');

  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '15px';

  container.innerHTML = `
    <div class="jms-about-logo-container" style="text-align: center; margin-bottom: 20px; padding: 15px 0;">
      <img src="../Plugins/JMSFusion/assets/LogoPng" 
           alt="Nexus PobreFlix Logo" 
           style="max-width: 240px; height: auto; filter: drop-shadow(0 0 16px rgba(122, 92, 255, 0.45));" />
    </div>

    <div class="jms-card-head" style="border-bottom: 1px solid rgba(168, 85, 247, 0.3); padding-bottom: 12px; margin-bottom: 15px;">
      <h3 style="margin: 0; color: #fff; font-size: 1.3em;">Sobre o Nexus PobreFlix</h3>
      <p style="margin: 6px 0 0 0; color: #cbd5e1; font-size: 0.95em;">A experiência visual definitiva e ultra-premium para o seu ecossistema Jellyfin.</p>
    </div>

    <div style="margin-bottom: 20px; line-height: 1.6; font-size: 14px; color: #cbd5e1; text-align: justify;">
      <p style="margin: 0 0 12px 0;">
        O <strong>Nexus PobreFlix</strong> é uma evolução estética sofisticada construída como um <strong>Fork de Alta Performance</strong> 
        a partir do projeto original <a href="https://github.com/G-grbz/Jellyfin-Media-Slider" target="_blank" style="color: #a855f7; font-weight: 700; text-decoration: none;">Jellyfin Media Slider (JMSFusion)</a>, 
        criado com genialidade e maestria por <strong>G-Grbz</strong>.
      </p>
      <p style="margin: 0 0 12px 0;">
        Dedicamos todos os créditos fundamentais de base, arquitetura de sliders, injeção de scripts e engenharia inicial de componentes ao autor original <strong>G-Grbz</strong>. 
        Expressamos nossa eterna admiração e profunda gratidão pelo seu incrível trabalho open-source, que serviu como a fundação estrutural para este ecossistema.
      </p>
      <p style="margin: 0 0 12px 0;">
        Esta edição personalizada (Nexus Edition) foi projetada, customizada e refinada por <strong>ONeithan</strong>, introduzindo 
        tradução absoluta para Português do Brasil, otimização de performance no carregamento, correções profundas de layout de UX, 
        estilizações premium sob a identidade visual roxa e melhorias exclusivas de acessibilidade e controle.
      </p>
    </div>

    <div class="jms-env-box" style="margin-top: 15px; border-top: 1px solid rgba(168, 85, 247, 0.3); padding-top: 20px; display: flex; flex-direction: column; gap: 12px;">
      <div class="jms-env-item" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(168, 85, 247, 0.15); padding-bottom: 8px;">
        <span class="jms-env-label" style="color: #94a3b8; font-size: 0.9em;">Versão do Fork</span>
        <code style="background: rgba(168, 85, 247, 0.2); padding: 3px 8px; border-radius: 4px; color: #fff; font-size: 0.85em;">1.0.0.1 (Nexus Edition)</code>
      </div>
      <div class="jms-env-item" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(168, 85, 247, 0.15); padding-bottom: 8px;">
        <span class="jms-env-label" style="color: #94a3b8; font-size: 0.9em;">Autor do Fork</span>
        <strong style="color: #fff; font-size: 0.95em;">ONeithan</strong>
      </div>
      <div class="jms-env-item" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(168, 85, 247, 0.15); padding-bottom: 8px;">
        <span class="jms-env-label" style="color: #94a3b8; font-size: 0.9em;">Autor do Projeto Base (Créditos Totais)</span>
        <strong style="color: #fff; font-size: 0.95em;">G-Grbz (JMSFusion)</strong>
      </div>
      <div class="jms-env-item" style="display: flex; flex-direction: column; gap: 8px;">
        <span class="jms-env-label" style="color: #94a3b8; font-size: 0.9em;">Links Oficiais</span>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px;">
          <a href="https://github.com/ONeithan/Nexus-PobreFlix" target="_blank" style="flex: 1; text-align: center; text-decoration: none; background: rgba(168, 85, 247, 0.3); color: #fff; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(168, 85, 247, 0.5); font-weight: bold; font-size: 0.85em; transition: background 0.2s;">Repositório do Fork (ONeithan)</a>
          <a href="https://github.com/G-grbz/Jellyfin-Media-Slider" target="_blank" style="flex: 1; text-align: center; text-decoration: none; background: rgba(30, 41, 59, 0.5); color: #cbd5e1; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); font-weight: bold; font-size: 0.85em; transition: background 0.2s;">Repositório Original (G-Grbz)</a>
        </div>
      </div>
    </div>
  `;

  section.appendChild(container);
  panel.appendChild(section);

  return panel;
}

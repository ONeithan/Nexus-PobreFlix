import { getConfig } from "../config.js";
import { createCheckbox, createImageTypeSelect, bindCheckboxKontrol, bindTersCheckboxKontrol, createSection } from "./shared.js";
import { applySettings, applyRawConfig } from "./applySettings.js";

var LYRICS_JOB_KEY = 'jmsf_lyrics_job_running';

var __lyricsLabels = {};

function createLyricsSummaryModal(labels) {
    if (document.getElementById('lyrics-summary-modal')) return;

    var modal = document.createElement('div');
    modal.id = 'lyrics-summary-modal';
    modal.className = 'settings-modal';
    modal.style.display = 'none';

    modal.addEventListenerfunction('click', (e) {
        if (e.target === modal) modal.style.display = 'none';
    });

    var content = document.createElement('div');
    content.className = 'settings-modal-content';
    content.style.maxWidth = '500px';

    var close = document.createElement('span');
    close.className = 'settings-close';
    close.innerHTML = '&times;';
    close.onclick = function() modal.style.display = 'none';

    var h2 = document.createElement('h2');
    h2.textContent = labels.lyricsSummaryTitle || "Resumo das Letras";

    var summaryContent = document.createElement('div');
    summaryContent.id = 'lyricsSummaryContent';
    summaryContent.style.lineHeight = '1.6';
    summaryContent.style.margin = '15px 0';

    var note = document.createElement('div');
    note.className = 'setting-item';
    note.style.marginTop = '20px';
    note.style.padding = '10px';
    note.style.background = 'rgba(255, 193, 7, 0.1)';
    note.style.borderLeft = '4px solid #ffc107';
    note.innerHTML = labels.lyricsSyncNote || '<strong>Nota:</strong> Lembre-se de sincronizar as letras!';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = labels.close || 'Fechar';
    closeBtn.style.marginTop = '15px';
    closeBtn.onclick = function() modal.style.display = 'none';

    content.append(close, h2, summaryContent, note, closeBtn);
    modal.appendChild(content);
    document.body.appendChild(modal);
}

function showLyricsSummaryModal(summary, labels) {
    createLyricsSummaryModal(labels);
    var modal = document.getElementById('lyrics-summary-modal');
    var content = document.getElementById('lyricsSummaryContent');

    if (!modal || !content) return;

    var L = labels || {};
    var tOk = L.lyricsSummaryOk || "Sucesso";
    var tSyn = L.lyricsSummarySynced || "Sincronizada";
    var tPln = L.lyricsSummaryPlain || "Simples";
    var tFail = L.lyricsSummaryFail || "Falha";

    var ok = (summary.ok || ((summary.synced || 0) + (summary.plain || 0)));
    var synced = summary.synced || 0;
    var plain = summary.plain || 0;
    var fail = summary.fail || 0;

    content.innerHTML = "\n        <div style=\"margin-bottom: 10px;\">\n            " + (tOk) + ": <b style=\"color: #27ae60;\">" + (ok) + "</b>\n        </div>\n        <div style=\"margin-bottom: 10px;\">\n            " + (tSyn) + ": <b>" + (synced) + "</b>\n        </div>\n        <div style=\"margin-bottom: 10px;\">\n            " + (tPln) + ": <b>" + (plain) + "</b>\n        </div>\n        <div style=\"margin-bottom: 10px;\">\n            " + (tFail) + ": <b style=\"color: #e74c3c;\">" + (fail) + "</b>\n        </div>\n    ";

    modal.style.display = 'block';
}

function getJFHeaders() {
  var token = null, userId = null;
  try { token = window.ApiClient._serverInfo.AccessToken || window.ApiClient.accessToken.(); } catch (e) {}
  try { userId = window.ApiClient._serverInfo.UserId || window.ApiClient._currentUserId; } catch (e) {}
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Emby-Token': token } : {}),
    ...(userId ? { 'X-Emby-UserId': userId, 'X-MediaBrowser-UserId': userId } : {}),
  };
}

function readAdminValue(value) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}

function readAdminFromUser(user) {
  if (!user || typeof user !== "object") return null;

  var policy = user.Policy || user.UserPolicy || null;
  var candidates = [
    policy.IsAdministrator,
    policy.IsAdmin,
    policy.IsAdminUser,
    user.IsAdministrator,
    user.isAdministrator,
    user.IsAdmin,
    user.isAdmin,
  ];

  for (var candidate of candidates) {
    var normalized = readAdminValue(candidate);
    if (normalized !== null) return normalized;
  }

  return null;
}

function detectIsAdmin() {
  try {
    if (!window.ApiClient) return true;

    var liveAdmin = readAdminFromUser(window.ApiClient._currentUser);
    if (liveAdmin !== null) return liveAdmin;

    var user = window.ApiClient.getCurrentUser();
    var currentAdmin = readAdminFromUser(user);
    return currentAdmin !== false;
  } catch (e) { return true; }
}

function attachLyricsModal(labels) {
  if (document.getElementById('lyrics-modal')) return;

  var modal = document.createElement('div');
  modal.id = 'lyrics-modal';
  modal.className = 'settings-modal';
  modal.style.display = 'none';

  modal.addEventListenerfunction('click', (e) {
    if (e.target === modal) modal.style.display = 'none';
  });

  var content = document.createElement('div');
  content.className = 'settings-modal-content';
  content.style.maxWidth = '680px';

  var close = document.createElement('span');
  close.className = 'settings-close';
  close.innerHTML = '&times;';
  close.onclick = function() modal.style.display = 'none';

  var h2 = document.createElement('h2');
  h2.textContent = labels.lyricsHeader || "Letras das Músicas";

  var progWrap = document.createElement('div');
  progWrap.className = 'setting-item';
  var progLbl = document.createElement('div');
  progLbl.textContent = (labels.lyricsProgress || "Progresso") + ": ";
  var progBarOuter = document.createElement('div');
  progBarOuter.style.height = '10px';
  progBarOuter.style.background = 'rgba(255,255,255,0.15)';
  progBarOuter.style.borderRadius = '6px';
  var progBar = document.createElement('div');
  progBar.id = 'lyricsProgressBar';
  progBar.style.height = '10px';
  progBar.style.width = '0%';
  progBar.style.borderRadius = '6px';
  progBar.style.transition = 'width 0.3s ease';
  progBarOuter.appendChild(progBar);
  var progTxt = document.createElement('div');
  progTxt.id = 'lyricsProgressText';
  progTxt.style.marginTop = '6px';
  progWrap.append(progLbl, progBarOuter, progTxt);

  var status = document.createElement('div');
  status.id = 'lyricsStatus';
  status.className = 'setting-item';
  status.textContent = labels.lyricsIdle || "Pronto";

  var btnRow = document.createElement('div');
  btnRow.className = 'btn-item';
  var startBtn = document.createElement('button');
  startBtn.id = 'lyricsStart';
  startBtn.textContent = labels.lyricsStart || "Iniciar";
  var cancelBtn = document.createElement('button');
  cancelBtn.id = 'lyricsCancel';
  cancelBtn.textContent = labels.lyricsCancel || "Cancelar";
  cancelBtn.disabled = true;
  btnRow.append(startBtn, cancelBtn);

  var logWrap = document.createElement('div');
  logWrap.className = 'setting-item';
  var logLabel = document.createElement('div');
  logLabel.textContent = labels.lyricsLog || "Log";
  var logBox = document.createElement('pre');
  logBox.id = 'lyricsLog';
  logBox.style.maxHeight = '400px';
  logBox.style.overflow = 'auto';
  logBox.style.whiteSpace = 'pre-wrap';
  logWrap.append(logLabel, logBox);

  content.append(close, h2, status, progWrap, btnRow, logWrap);
  modal.appendChild(content);
  document.body.appendChild(modal);

  startBtn.addEventListenerfunction('click', () startLyricsJob(labels, { startBtn, cancelBtn, status, progBar, progTxt, logBox }));
  cancelBtn.addEventListenerfunction('click', () cancelLyricsJob(labels));
}

function openLyricsModal(labels, opts = {}) {
  __lyricsLabels = labels || {};
  var { autoStart = false } = opts;

  var modal = document.getElementById('lyrics-modal');
  if (!modal) return;
  modal.style.display = 'block';

  var { startBtn, cancelBtn, status, progBar, progTxt, logBox } = grabLyricsModalRefs();
  function(() {
    try {
      var r = fetch('/NexusPobreFlix/lyrics/status', { headers: getJFHeaders() });
      var j = r.json();

      if (j.running) {
        status.textContent = (labels.lyricsRunning || "Executando") + (j.currentStep ? " • " + (j.currentStep) : '');
        if (cancelBtn) cancelBtn.disabled = false;
        if (startBtn)  startBtn.disabled  = true;

        if (typeof j.progress === 'number') {
          var p = Math.max(0, Math.min(100, j.progress));
          progBar.style.width = p + '%';
          progTxt.textContent = p.toFixed(1) + '%';
        }
        if (Array.isArray(j.log)) {
          logBox.textContent = j.log.join('\n');
          logBox.scrollTop = logBox.scrollHeight;
        }

        pollLyricsStatus({ startBtn, cancelBtn, status, progBar, progTxt, logBox });
      } else {
        if (autoStart) {
          startLyricsJob(labels, { startBtn, cancelBtn, status, progBar, progTxt, logBox });
        } else {
          if (cancelBtn) cancelBtn.disabled = true;
          if (startBtn)  startBtn.disabled  = false;
          status.textContent = labels.lyricsIdle || "Pronto";
        }
      }
    } catch {
      if (cancelBtn) cancelBtn.disabled = true;
      if (startBtn)  startBtn.disabled  = false;
      if (autoStart) {
        startLyricsJob(labels, { startBtn, cancelBtn, status, progBar, progTxt, logBox });
      }
    }
  })();

  var jobStamp = getLyricsJobFlag();
  if (jobStamp) {
    status.textContent = (labels.lyricsRunning || "Executando") + " • " + (labels.lyricsResumeHint || "Tarefa em andamento detectada.");
  }
}

function grabLyricsModalRefs() {
  return {
    startBtn: document.getElementById('lyricsStart'),
    cancelBtn: document.getElementById('lyricsCancel'),
    status: document.getElementById('lyricsStatus'),
    progBar: document.getElementById('lyricsProgressBar'),
    progTxt: document.getElementById('lyricsProgressText'),
    logBox: document.getElementById('lyricsLog')
  };
}

function setLyricsJobFlag(on) {
  try { on ? localStorage.setItem(LYRICS_JOB_KEY, String(Date.now())) : localStorage.removeItem(LYRICS_JOB_KEY); } catch {}
}
function getLyricsJobFlag() {
  try { return localStorage.getItem(LYRICS_JOB_KEY); } catch { return null; }
}

function startLyricsJob(labels, refs) {
  var { startBtn, cancelBtn, status, progBar, progTxt, logBox } = refs;
  startBtn.disabled = true;
  cancelBtn.disabled = false;
  status.textContent = labels.lyricsRunning || "Executando";

  var body = {
    mode: localStorage.getItem('lyricsMode') || 'prefer-synced',
    overwrite: localStorage.getItem('lyricsOverwrite') || 'skip'
  };

  try {
    var r = fetch('/NexusPobreFlix/lyrics/run', {
      method: 'POST',
      headers: getJFHeaders(),
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      startBtn.disabled = false;
      cancelBtn.disabled = true;
      var j = r.json().catchfunction(()({}));
      status.textContent = j.error || "Erro: " + (r.status);
      return;
    }
    setLyricsJobFlag(true);
    pollLyricsStatus({ startBtn, cancelBtn, status, progBar, progTxt, logBox });
  } catch (e) {
    startBtn.disabled = false;
    cancelBtn.disabled = true;
    status.textContent = 'Erro de rede';
  }
}

function cancelLyricsJob(labels) {
  var { startBtn, cancelBtn, status } = grabLyricsModalRefs();
  try {
    fetch('/NexusPobreFlix/lyrics/cancel', { method: 'POST', headers: getJFHeaders() });
  } catch {}
  status.textContent = labels.lyricsCancel || 'Cancelar';
}

var lyricsPollTimer = null;

function pollLyricsStatus(refs) {
    var { startBtn, cancelBtn, status, progBar, progTxt, logBox } = refs;
    var L = __lyricsLabels || {};

    clearTimeout(lyricsPollTimer);

    try {
        var r = fetch('/NexusPobreFlix/lyrics/status', { headers: getJFHeaders() });
        var j = r.json();
        if (!j.ok) throw new Error('status not ok');

        if (Array.isArray(j.log)) {
            logBox.textContent = j.log.join('\n');
            logBox.scrollTop = logBox.scrollHeight;
        }

        if (typeof j.progress === 'number') {
            var p = Math.max(0, Math.min(100, j.progress));
            progBar.style.width = p + '%';
            progTxt.textContent = p.toFixed(1) + '%';
        }

        if (j.running) {
            status.textContent = (L.lyricsRunning || "Executando") + (j.currentStep ? " • " + (j.currentStep) : '');
            if (cancelBtn) cancelBtn.disabled = false;
            if (startBtn) startBtn.disabled = true;
            lyricsPollTimer = setTimeoutfunction(() pollLyricsStatus(refs), 1500);
        } else {
            setLyricsJobFlag(false);
            if (cancelBtn) cancelBtn.disabled = true;
            if (startBtn) startBtn.disabled = false;
            status.textContent = (L.lyricsCompleted || "Concluído");

            var S = j.summary || null;
            if (S) {
                showLyricsSummaryModal(S, L);
            }
        }
    } catch (e) {
        lyricsPollTimer = setTimeoutfunction(() pollLyricsStatus(refs), 2000);
    }
}

export function createMusicPanel(config, labels) {
    var panel = document.createElement('div');
    panel.id = 'music-panel';
    panel.className = 'settings-panel';

    var section = createSection(labels.gmmpSettings || 'Configurações do Nexus Music');

    var notificationToggleDiv = document.createElement('div');
    notificationToggleDiv.className = 'setting-item';

    var enabledGmmpInput = document.createElement('input');
    enabledGmmpInput.type = 'checkbox';
    enabledGmmpInput.checked = config.enabledGmmp !== false;
    enabledGmmpInput.name = 'enabledGmmp';
    enabledGmmpInput.id = 'enabledGmmp';

    var enabledGmmpLabel = document.createElement('label');
    enabledGmmpLabel.textContent = labels.enabledGmmp || 'Habilitar Nexus Music';
    enabledGmmpLabel.htmlFor = 'enabledGmmp';

    var notificationToggleInput = document.createElement('input');
    notificationToggleInput.type = 'checkbox';
    notificationToggleInput.checked = config.notificationsEnabled !== false;
    notificationToggleInput.name = 'notificationsEnabled';
    notificationToggleInput.id = 'notificationsEnabled';

    var notificationToggleLabel = document.createElement('label');
    notificationToggleLabel.textContent = labels.notificationsEnabled || 'Mostrar Notificações:';
    notificationToggleLabel.htmlFor = 'notificationsEnabled';

    notificationToggleDiv.append(enabledGmmpInput, enabledGmmpLabel, notificationToggleInput, notificationToggleLabel);
    section.appendChild(notificationToggleDiv);

    var albumArtBgDiv = document.createElement('div');
    albumArtBgDiv.className = 'setting-item';

    var albumArtBgLabel = document.createElement('label');
    albumArtBgLabel.textContent = labels.useAlbumArtAsBackground || 'Usar capa do álbum como fundo:';

    var albumArtBgInput = document.createElement('input');
    albumArtBgInput.type = 'checkbox';
    albumArtBgInput.checked = config.useAlbumArtAsBackground || false;
    albumArtBgInput.name = 'useAlbumArtAsBackground';
    albumArtBgInput.id = 'useAlbumArtAsBackground';

    albumArtBgLabel.htmlFor = 'albumArtBgInput';
    albumArtBgInput.id = 'albumArtBgInput';
    albumArtBgDiv.append(albumArtBgLabel, albumArtBgInput);
    section.appendChild(albumArtBgDiv);

    var blurDiv = document.createElement('div');
    blurDiv.className = 'setting-item';

    var blurLabel = document.createElement('label');
    blurLabel.textContent = labels.backgroundBlur || 'Desfoque do fundo:';
    blurLabel.htmlFor = 'albumArtBackgroundBlur';

    var blurInput = document.createElement('input');
    blurInput.type = 'range';
    blurInput.min = '0';
    blurInput.max = '20';
    blurInput.step = '1';
    blurInput.value = config.albumArtBackgroundBlur || 10;
    blurInput.name = 'albumArtBackgroundBlur';
    blurInput.id = 'albumArtBackgroundBlur';

    var blurValue = document.createElement('span');
    blurValue.className = 'range-value';
    blurValue.textContent = blurInput.value + 'px';

    blurInput.addEventListenerfunction('input', () {
        blurValue.textContent = blurInput.value + 'px';
    });

    blurDiv.append(blurLabel, blurInput, blurValue);
    section.appendChild(blurDiv);

    var opacityDiv = document.createElement('div');
    opacityDiv.className = 'setting-item';

    var opacityLabel = document.createElement('label');
    opacityLabel.textContent = labels.backgroundOpacity || 'Opacidade do fundo:';
    opacityLabel.htmlFor = 'albumArtBackgroundOpacity';

    var opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0';
    opacityInput.max = '1';
    opacityInput.step = '0.1';
    opacityInput.value = config.albumArtBackgroundOpacity || 0.5;
    opacityInput.name = 'albumArtBackgroundOpacity';
    opacityInput.id = 'albumArtBackgroundOpacity';

    var opacityValue = document.createElement('span');
    opacityValue.className = 'range-value';
    opacityValue.textContent = opacityInput.value;

    opacityInput.addEventListenerfunction('input', () {
        opacityValue.textContent = opacityInput.value;
    });

    opacityDiv.append(opacityLabel, opacityInput, opacityValue);
    section.appendChild(opacityDiv);

    var styleDiv = document.createElement('div');
    styleDiv.className = 'setting-item';
    var styleLabel = document.createElement('label');
    styleLabel.textContent = labels.playerStyle || 'Estilo do Player:';
    var styleSelect = document.createElement('select');
    styleSelect.name = 'playerStyle';

    var styles = [
        { value: 'player', label: labels.estiloHorizontal || 'Estilo Horizontal' },
        { value: 'newplayer', label: labels.estiloVertical || 'Estilo Vertical' }
    ];

    styles.forEach(function(style) {
        var option = document.createElement('option');
        option.value = style.value;
        option.textContent = style.label;
        if (style.value === (config.playerStyle || 'player')) {
            option.selected = true;
        }
        styleSelect.appendChild(option);
    });

    styleLabel.htmlFor = 'styleSelect';
    styleSelect.id = 'styleSelect';
    styleDiv.append(styleLabel, styleSelect);
    section.appendChild(styleDiv);

    var themeDiv = document.createElement('div');
    themeDiv.className = 'setting-item';
    var themeLabel = document.createElement('label');
    themeLabel.textContent = labels.playerTheme || 'Tema do Player:';
    var themeSelect = document.createElement('select');
    themeSelect.name = 'playerTheme';

    var themes = [
        { value: 'dark', label: labels.darkTheme || 'Tema Escuro' },
        { value: 'light', label: labels.lightTheme || 'Tema Claro' }
    ];

    themes.forEach(function(theme) {
        var option = document.createElement('option');
        option.value = theme.value;
        option.textContent = theme.label;
        if (theme.value === (config.playerTheme || 'dark')) {
            option.selected = true;
        }
        themeSelect.appendChild(option);
    });

    themeLabel.htmlFor = 'themeSelect';
    themeSelect.id = 'themeSelect';
    themeDiv.append(themeLabel, themeSelect);
    section.appendChild(themeDiv);

    var dateLocaleDiv = document.createElement('div');
    dateLocaleDiv.className = 'setting-item';
    var dateLocaleLabel = document.createElement('label');
    dateLocaleLabel.textContent = labels.dateLocale || 'Formato de Data:';
    var dateLocaleSelect = document.createElement('select');
    dateLocaleSelect.name = 'dateLocale';

    var locales = [
    { value: 'en-US', label: '🇺🇸 English (US)' },
    { value: 'en-GB', label: '🇬🇧 English (UK)' },
    { value: 'de-DE', label: '🇩🇪 Deutsch' },
    { value: 'fr-FR', label: '🇫🇷 Français' },
    { value: 'es-ES', label: '🇪🇸 Español' },
    { value: 'it-IT', label: '🇮🇹 Italiano' },
    { value: 'ru-RU', label: '🇷🇺 Русский' },
    { value: 'ja-JP', label: '🇯🇵 日本語' },
    { value: 'zh-CN', label: '🇨🇳 简体中文' },
    { value: 'pt-PT', label: '🇵🇹 Português (Portugal)' },
    { value: 'pt-BR', label: '🇧🇷 Português (Brasil)' },
    { value: 'nl-NL', label: '🇳🇱 Nederlands' },
    { value: 'sv-SE', label: '🇸🇪 Svenska' },
    { value: 'pl-PL', label: '🇵🇱 Polski' },
    { value: 'uk-UA', label: '🇺🇦 Українська' },
    { value: 'ko-KR', label: '🇰🇷 한국어' },
    { value: 'ar-SA', label: '🇸🇦 العربية' },
    { value: 'hi-IN', label: '🇮🇳 हिन्दी' },
    { value: 'fa-IR', label: '🇮🇷 فارسی' },
];

    locales.forEach(function(locale) {
        var option = document.createElement('option');
        option.value = locale.value;
        option.textContent = locale.label;
        if (locale.value === config.dateLocale) {
            option.selected = true;
        }
        dateLocaleSelect.appendChild(option);
    });

    dateLocaleLabel.htmlFor = 'dateLocaleSelect';
    dateLocaleSelect.id = 'dateLocaleSelect';
    dateLocaleDiv.append(dateLocaleLabel, dateLocaleSelect);
    section.appendChild(dateLocaleDiv);

    var musicLimitDiv = document.createElement('div');
    musicLimitDiv.className = 'setting-item';
    var musicLimitLabel = document.createElement('label');
    musicLimitLabel.textContent = labels.limiteMusica || 'Itens na Playlist:';
    var musicLimitInput = document.createElement('input');
    musicLimitInput.type = 'number';
    musicLimitInput.value = config.limiteMusica || 30;
    musicLimitInput.name = 'limiteMusica';
    musicLimitInput.min = 1;
    musicLimitLabel.htmlFor = 'musicLimitInput';
    musicLimitInput.id = 'musicLimitInput';
    musicLimitDiv.append(musicLimitLabel, musicLimitInput);
    section.appendChild(musicLimitDiv);

    var nextTrackDiv = document.createElement('div');
    nextTrackDiv.className = 'setting-item';
    var nextTrackLabel = document.createElement('label');
    nextTrackLabel.textContent = labels.nextTrack || 'Limite de Músicas da Fila';
    var nextTrackInput = document.createElement('input');
    nextTrackInput.type = 'number';
    nextTrackInput.value = config.nextTrack || 30;
    nextTrackInput.name = 'nextTrack';
    nextTrackInput.min = 0;
    nextTrackLabel.htmlFor = 'nextTrackInput';
    nextTrackInput.id = 'nextTrackInput';
    nextTrackDiv.append(nextTrackLabel, nextTrackInput);
    section.appendChild(nextTrackDiv);

    var songLimitDiv = document.createElement('div');
    songLimitDiv.className = 'setting-item';
    var songLimitLabel = document.createElement('label');
    songLimitLabel.textContent = labels.limiteFaixa || 'Músicas por página:';
    var songLimitInput = document.createElement('input');
    songLimitInput.type = 'number';
    songLimitInput.value = config.limiteFaixa || 200;
    songLimitInput.name = 'limiteFaixa';
    songLimitInput.min = 1;
    songLimitLabel.htmlFor = 'songLimitInput';
    songLimitInput.id = 'songLimitInput';
    songLimitDiv.append(songLimitLabel, songLimitInput);
    section.appendChild(songLimitDiv);

    var albumLimitDiv = document.createElement('div');
    albumLimitDiv.className = 'setting-item';
    var albumLimitLabel = document.createElement('label');
    albumLimitLabel.textContent = labels.limiteAlbum || 'Álbuns por página:';
    var albumLimitInput = document.createElement('input');
    albumLimitInput.type = 'number';
    albumLimitInput.value = config.limiteAlbum || 20;
    albumLimitInput.name = 'limiteAlbum';
    albumLimitInput.min = 1;
    albumLimitLabel.htmlFor = 'albumLimitInput';
    albumLimitInput.id = 'albumLimitInput';
    albumLimitDiv.append(albumLimitLabel, albumLimitInput);
    section.appendChild(albumLimitDiv);

    var id3LimitDiv = document.createElement('div');
    id3LimitDiv.className = 'setting-item';
    var id3LimitLabel = document.createElement('label');
    id3LimitLabel.textContent = labels.limiteId3 || 'Limite de Grupos:';
    id3LimitLabel.title = labels.limiteId3Title || 'Limite de consultas ID3 simultâneas.';
    var id3LimitInput = document.createElement('input');
    id3LimitInput.type = 'number';
    id3LimitInput.value = config.limiteId3 || 5;
    id3LimitInput.name = 'limiteId3';
    id3LimitInput.min = 1;
    id3LimitInput.max = 200;
    id3LimitInput.title = labels.limiteId3Title || 'Id3 etiket sorgulamanın eş zamanlı olarak kaç tane yapılacağı belirleyen değer';
    id3LimitLabel.htmlFor = 'id3LimitInput';
    id3LimitInput.id = 'id3LimitInput';
    id3LimitDiv.append(id3LimitLabel, id3LimitInput);
    section.appendChild(id3LimitDiv);

    var cacheTagsDiv = document.createElement('div');
    cacheTagsDiv.className = 'setting-item';
    var cacheTagsLabel = document.createElement('label');
    cacheTagsLabel.textContent = labels.limiteCacheTagsId3 || 'Cache de Tags:';
    var cacheTagsInput = document.createElement('input');
    cacheTagsInput.type = 'number';
    cacheTagsInput.value = config.limiteCacheTagsId3 || 500;
    cacheTagsInput.name = 'limiteCacheTagsId3';
    cacheTagsInput.min = 50;
    cacheTagsInput.id = 'cacheTagsInput';
    cacheTagsDiv.append(cacheTagsLabel, cacheTagsInput);
    section.appendChild(cacheTagsDiv);

    var cacheImagesDiv = document.createElement('div');
    cacheImagesDiv.className = 'setting-item';
    var cacheImagesLabel = document.createElement('label');
    cacheImagesLabel.textContent = labels.limiteCacheImagensId3 || 'Cache de Imagens:';
    var cacheImagesInput = document.createElement('input');
    cacheImagesInput.type = 'number';
    cacheImagesInput.value = config.limiteCacheImagensId3 || 200;
    cacheImagesInput.name = 'limiteCacheImagensId3';
    cacheImagesInput.min = 20;
    cacheImagesInput.id = 'cacheImagesInput';
    cacheImagesDiv.append(cacheImagesLabel, cacheImagesInput);
    section.appendChild(cacheImagesDiv);

    var useBase64Div = document.createElement('div');
    useBase64Div.className = 'setting-item';
    var useBase64Label = document.createElement('label');
    useBase64Label.textContent = labels.usarBase64ImagensId3 || 'Usar Base64 para Imagens:';
    var useBase64Input = document.createElement('input');
    useBase64Input.type = 'checkbox';
    useBase64Input.checked = config.usarBase64ImagensId3 === true;
    useBase64Input.name = 'usarBase64ImagensId3';
    useBase64Input.id = 'useBase64Input';
    useBase64Div.append(useBase64Label, useBase64Input);
    section.appendChild(useBase64Div);

    var maxExcludeIdsForUriDiv = document.createElement('div');
    maxExcludeIdsForUriDiv.className = 'setting-item';
    var maxExcludeIdsForUriLabel = document.createElement('label');
    maxExcludeIdsForUriLabel.textContent = labels.maxExcludeIdsForUri || 'Máximo de IDs';
    maxExcludeIdsForUriLabel.title = labels.maxExcludeIdsForTitle || 'Limite para evitar URLs gigantes na API. Recomendado: 50-200.';
    var maxExcludeIdsForUriInput = document.createElement('input');
    maxExcludeIdsForUriInput.type = 'number';
    maxExcludeIdsForUriInput.value = config.maxExcludeIdsForUri || 100;
    maxExcludeIdsForUriInput.title = labels.maxExcludeIdsForTitle || 'Bu değer, Liste yenilemek için API isteğinde aynı anda gönderilebilecek "Hariç Tutulacak Geçmiş Liste Sayısı" listesinin maksimum uzunluğunu belirler. Büyük değerler sunucu isteklerinin boyutunu aşarak hatalara neden olabilir. İsteklerin hatasız çalışması için genellikle 50-200 arası bir değer önerilir.';
    maxExcludeIdsForUriInput.name = 'maxExcludeIdsForUri';
    maxExcludeIdsForUriInput.min = 1;
    maxExcludeIdsForUriLabel.htmlFor = 'maxExcludeIdsForUriInput';
    maxExcludeIdsForUriInput.id = 'maxExcludeIdsForUriInput';
    maxExcludeIdsForUriDiv.append(maxExcludeIdsForUriLabel, maxExcludeIdsForUriInput);
    section.appendChild(maxExcludeIdsForUriDiv);

    var historyLimitDiv = document.createElement('div');
    historyLimitDiv.className = 'setting-item';
    var historyLimitLabel = document.createElement('label');
    historyLimitLabel.textContent = labels.limiteHistorico || 'Ignorar Histórico';
    historyLimitLabel.title = labels.limiteHistoricoTitle || 'Evita repetir músicas já tocadas recentemente.';
    var historyLimitInput = document.createElement('input');
    historyLimitInput.type = 'number';
    historyLimitInput.value = config.limiteHistorico || 10;
    historyLimitInput.name = 'limiteHistorico';
    historyLimitInput.title = labels.limiteHistoricoTitle || 'Yeni listelere, geçmiş listeler içerisindeki şarkıları dahil etmemek için limit belirleyin';
    historyLimitInput.min = 1;
    historyLimitLabel.htmlFor = 'historyLimitInput';
    historyLimitInput.id = 'historyLimitInput';
    historyLimitDiv.append(historyLimitLabel, historyLimitInput);
    section.appendChild(historyLimitDiv);

    var groupLimitDiv = document.createElement('div');
    groupLimitDiv.className = 'setting-item';
    var groupLimitLabel = document.createElement('label');
    groupLimitLabel.textContent = labels.limiteLote || 'Limite de Lote:';
    groupLimitLabel.title = labels.limiteLoteTitle || 'Limite de itens por lote na playlist.';
    var groupLimitInput = document.createElement('input');
    groupLimitInput.type = 'number';
    groupLimitInput.value = config.limiteLote || 100;
    groupLimitInput.name = 'limiteLote';
    groupLimitInput.min = 1;
    groupLimitInput.max = 400;
    groupLimitInput.title = labels.limiteLoteTitle || 'Mevcut oynatma listesine ekleme yapılırken gruplama limiti';
    groupLimitLabel.htmlFor = 'groupLimitInput';
    groupLimitInput.id = 'groupLimitInput';
    groupLimitDiv.append(groupLimitLabel, groupLimitInput);
    section.appendChild(groupLimitDiv);

    var nextTracksSourceDiv = document.createElement('div');
    nextTracksSourceDiv.className = 'setting-item';
    var nextTracksSourceLabel = document.createElement('label');
    nextTracksSourceLabel.textContent = labels.nextTracksSource || 'Fonte da Fila:';
    var nextTracksSourceSelect = document.createElement('select');
    nextTracksSourceSelect.name = 'nextTracksSource';

    var sources = [
        { value: 'playlist', label: labels.playlist || 'Playlist' },
        { value: 'top', label: labels.topTracks || 'Mais Tocadas' },
        { value: 'recent', label: labels.recentTracks || 'Recentes' },
        { value: 'latest', label: labels.latestTracks || 'Novidades' },
        { value: 'favorites', label: labels.favorites || 'Favoritos' }
    ];

    sources.forEach(function(source) {
    var option = document.createElement('option');
    option.value = source.value;
    option.textContent = source.label;
    if (source.value === (config.nextTracksSource || 'playlist')) {
        option.selected = true;
    }
    nextTracksSourceSelect.appendChild(option);
});

    nextTracksSourceLabel.htmlFor = 'nextTracksSourceSelect';
    nextTracksSourceSelect.id = 'nextTracksSourceSelect';
    nextTracksSourceDiv.append(nextTracksSourceLabel, nextTracksSourceSelect);
    section.appendChild(nextTracksSourceDiv);

    var topTrackDiv = document.createElement('div');
    topTrackDiv.className = 'setting-item';
    var topTrackLabel = document.createElement('label');
    topTrackLabel.textContent = labels.topLimit || 'Limite da Pool';
    var topTrackInput = document.createElement('input');
    topTrackInput.type = 'number';
    topTrackInput.value = config.topTrack || 30;
    topTrackInput.name = 'topTrack';
    topTrackInput.min = 0;
    topTrackLabel.htmlFor = 'topTrackInput';
    topTrackInput.id = 'topTrackInput';
    topTrackDiv.append(topTrackLabel, topTrackInput);
    section.appendChild(topTrackDiv);

    panel.appendChild(section);

    var lyricsSection = createSection(labels.lyricsHeader || "Letras das Músicas");
    var adminWarn = document.createElement('div');
    adminWarn.className = 'setting-item';
    adminWarn.style.display = 'none';
    adminWarn.style.color = '#c0392b';
    adminWarn.textContent = labels.lyricsAdminOnly || "Apenas administradores podem usar.";
    lyricsSection.appendChild(adminWarn);

    var modeDiv = document.createElement('div');
    modeDiv.className = 'setting-item';
    var modeLabel = document.createElement('label');
    modeLabel.textContent = labels.lyricsType || "Tipo de Download";
    modeLabel.htmlFor = 'lyricsMode';
    var modeSelect = document.createElement('select');
    modeSelect.name = 'lyricsMode';
    modeSelect.id = 'lyricsMode';

    [
      { v: 'synced', t: labels.lyricsSynced || 'Sincronizada (.lrc)' },
      { v: 'plain', t: labels.lyricsPlain || 'Simples (.txt)' },
      { v: 'prefer-synced', t: labels.lyricsPreferSynced || 'Prefere Sincronizada' },
      { v: 'prefer-plain', t: labels.lyricsPreferPlain || 'Prefere Simples' },
    ].forEach(function(o) {
      var opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      if ((localStorage.getItem('lyricsMode') || 'prefer-synced') === o.v) opt.selected = true;
      modeSelect.appendChild(opt);
    });
    modeSelect.addEventListener('change', function(e) localStorage.setItem('lyricsMode', e.target.value));
    modeDiv.append(modeLabel, modeSelect);
    lyricsSection.appendChild(modeDiv);

    var owDiv = document.createElement('div');
    owDiv.className = 'setting-item';
    var owLabel = document.createElement('label');
    owLabel.textContent = labels.lyricsOverwrite || "Se o arquivo existir";
    owLabel.htmlFor = 'lyricsOverwrite';
    var owSelect = document.createElement('select');
    owSelect.name = 'lyricsOverwrite';
    owSelect.id = 'lyricsOverwrite';

    [
      { v: 'skip', t: labels.lyricsOverwriteSkip || 'Pular (recomendado)' },
      { v: 'replace', t: labels.lyricsOverwriteReplace || 'Substituir' },
    ].forEach(function(o) {
      var opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      if ((localStorage.getItem('lyricsOverwrite') || 'skip') === o.v) opt.selected = true;
      owSelect.appendChild(opt);
    });
    owSelect.addEventListener('change', function(e) localStorage.setItem('lyricsOverwrite', e.target.value));
    owDiv.append(owLabel, owSelect);
    lyricsSection.appendChild(owDiv);

    var runDiv = document.createElement('div');
    runDiv.className = 'setting-item';
    var runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.id = 'lyricsRunBtn';
    runBtn.textContent = labels.lyricsFindButton || "Baixar letras das músicas";
    runDiv.appendChild(runBtn);
    lyricsSection.appendChild(runDiv);

    section.appendChild(lyricsSection);
    attachLyricsModal(labels);
    detectIsAdmin().then(function(isAdmin) {
      if (!isAdmin) {
        adminWarn.style.display = 'block';
        runBtn.disabled = true;
        runBtn.style.opacity = '0.5';
      }
    });

    runBtn.addEventListenerfunction('click', () {
      openLyricsModal(labels, { autoStart: true });
    });

    var onThemeChanged = function() {
      var cfgNow = getConfig();
      var sel = panel.querySelector('#themeSelect');
      if (sel) sel.value = cfgNow.playerTheme || 'dark';
    };
    window.addEventListener('app:theme-changed', onThemeChanged);

    var obs = new MutationObserverfunction(() {
      if (!document.body.contains(panel)) {
        window.removeEventListener('app:theme-changed', onThemeChanged);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return panel;
    }

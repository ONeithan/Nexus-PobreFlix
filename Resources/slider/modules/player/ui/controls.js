import { musicPlayerState, saveUserSettings } from "../core/state.js";
import { getConfig } from "../../config.js";
import { showNotification } from "./notification.js";
import { shuffleArray } from "../utils/domUtils.js";
import { updatePlaylistModal } from "./playlistModal.js";
import { playNext, playPrevious, togglePlayPause } from '../player/playback.js';
import { updateNextTracks } from "./playerUI.js";
import { togglePlayerVisibility } from "../utils/mainIndex.js";
import { getRepeatOneIconHtml } from "../../customIcons.js";

var config = getConfig();

var keyboardControlsActive = false;
var keyboardHandler = null;
var controlsAbort = null;
var volumeAbort = null;
var volumeNotifyLast = 0;
var VOLUME_NOTIFY_INTERVAL = 150;

function areVolumeControlsReady() {
  return (
    musicPlayerState.audio &&
    musicPlayerState.volumeBtn &&
    musicPlayerState.volumeSlider
  );
}

export function enableKeyboardControls() {
  if (keyboardControlsActive) return;

  controlsAbort = new AbortController();
  keyboardHandler = function(e) handleKeyPress(e);
  document.addEventListener('keydown', keyboardHandler, { signal: controlsAbort.signal });
  keyboardControlsActive = true;
}

export function disableKeyboardControls() {
  if (!keyboardControlsActive) return;
  try { controlsAbort.abort(); } catch {}
  controlsAbort = null;
  keyboardHandler = null;
  keyboardControlsActive = false;
}

export function updateVolumeIcon(volume) {
  if (!musicPlayerState.volumeBtn || !musicPlayerState.audio) return;

  var icon;
  if (volume === 0 || musicPlayerState.audio.muted) {
    icon = '<i class="fas fa-volume-mute"></i>';
  } else if (volume < 0.5) {
    icon = '<i class="fas fa-volume-down"></i>';
  } else {
    icon = '<i class="fas fa-volume-up"></i>';
  }
  musicPlayerState.volumeBtn.innerHTML = icon;
}

function notifyVolumeThrottled(volume, isMuted = false) {
  var now = performance.now();
  if (now - volumeNotifyLast < VOLUME_NOTIFY_INTERVAL) return;
  volumeNotifyLast = now;

  var icon = '<i class="fas fa-volume-up"></i>';
  if (volume === 0 || musicPlayerState.audio.muted || isMuted) icon = '<i class="fas fa-volume-mute"></i>';
  else if (volume < 0.5) icon = '<i class="fas fa-volume-down"></i>';

  showNotification(
    (icon) + " " + (config.languageLabels.volume || 'Volume') + ": " + (Math.round(volume * 100)) + "%",
    2000,
    'kontrol'
  );
}

function updateVolumeUI(volume, isMuted = false) {
  if (!areVolumeControlsReady()) {
    console.warn('Controles de volume não estão prontos para atualização');
    return;
  }

  updateVolumeIcon(volume);
  musicPlayerState.volumeSlider.value = volume;
  notifyVolumeThrottled(volume, isMuted);
}

export function toggleMute() {
  var { audio, volumeBtn, volumeSlider } = musicPlayerState;

  if (!audio || !volumeBtn || !volumeSlider) {
    console.error('Falha ao inicializar controles de volume');
    showNotification('<i class="fas fa-volume-mute crossed-icon"></i> Não foi possível carregar os controles de volume', 2000, 'error');
    return;
  }

  audio.muted = !audio.muted;

  if (audio.muted) {
    volumeSlider.dataset.lastVolume = volumeSlider.value;
    volumeBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
    showNotification(
      "<i class=\"fas fa-volume-mute\"></i> " + (config.languageLabels.volOff || 'Som desativado'),
      2000,
      'kontrol'
    );
  } else {
    var newVolume = parseFloat(volumeSlider.dataset.lastVolume) || 0.7;
    audio.volume = newVolume;
    volumeSlider.value = newVolume;
    updateVolumeUI(newVolume);
  }

  saveUserSettings();
}

export function changeVolume(delta) {
  if (!areVolumeControlsReady()) {
    console.error('Controles de volume não puderam ser inicializados');
    return;
  }

  var { audio, volumeSlider } = musicPlayerState;
  var currentVolume = audio.volume;
  var newVolume = Math.min(1, Math.max(0, currentVolume + delta));

  if (Math.abs(newVolume - currentVolume) < 0.001 && !audio.muted) return;

  audio.volume = newVolume;
  musicPlayerState.userSettings.volume = newVolume;

  if (newVolume > 0 && audio.muted) {
    audio.muted = false;
  }

  volumeSlider.value = newVolume;
  updateVolumeUI(newVolume);
  saveUserSettings();
}

export function setupVolumeControls() {
  var slider = musicPlayerState.volumeSlider;
  if (!slider) {
    console.warn('Slider de volume não encontrado');
    return;
  }

  if (volumeAbort) {
    try { volumeAbort.abort(); } catch {}
  }
  volumeAbort = new AbortController();

  var onInput = function(e) {
    var volume = parseFloat(e.target.value);
    if (!musicPlayerState.audio) return;

    if (Math.abs(musicPlayerState.audio.volume - volume) < 0.001 && !musicPlayerState.audio.muted) return;

    musicPlayerState.audio.volume = volume;
    musicPlayerState.userSettings.volume = volume;
    musicPlayerState.audio.muted = false;

    updateVolumeUI(volume);
    saveUserSettings();
  };

  slider.addEventListener('input', onInput, { signal: volumeAbort.signal });
}

export function toggleRepeatMode() {
  var modes = ['none', 'one', 'all'];
  var currentIndex = modes.indexOf(musicPlayerState.userSettings.repeatMode);
  var nextIndex = (currentIndex + 1) % modes.length;
  musicPlayerState.userSettings.repeatMode = modes[nextIndex];

  var repeatBtn = document.querySelector('.player-btn.repeat-btn');
  if (!repeatBtn) {
    console.warn('Botão de repetição não encontrado');
    return;
  }

  var mode = musicPlayerState.userSettings.repeatMode;

  var titles = {
    'none': config.languageLabels.repeatModOff || 'Repetição desativada',
    'one': config.languageLabels.repeatModOne || 'Repetir uma música',
    'all': config.languageLabels.repeatModAll || 'Repetir lista'
  };

  var isActive = mode !== 'none';

  repeatBtn.classList.remove('active', 'passive');
  repeatBtn.classList.add(isActive ? 'active' : 'passive');
  repeatBtn.title = titles[mode];
  repeatBtn.innerHTML = mode === 'one'
    ? getRepeatOneIconHtml()
    : '<i class="fas fa-repeat"></i>';

  var notificationMessages = {
    'none': "<i class=\"fas fa-repeat crossed-icon\"></i> " + (config.languageLabels.repeatMod || 'Modo de repetição') + ": " + (config.languageLabels.repeatModOff || 'desativado'),
    'one': (getRepeatOneIconHtml()) + " " + (config.languageLabels.repeatMod || 'Modo de repetição') + ": " + (config.languageLabels.repeatModOne || 'uma música'),
    'all': "<i class=\"fas fa-repeat\"></i> " + (config.languageLabels.repeatMod || 'Modo de repetição') + ": " + (config.languageLabels.repeatModAll || 'toda a lista')
  };

  showNotification(
    notificationMessages[mode],
    2000,
    'kontrol'
  );

  saveUserSettings();
}

export function toggleShuffle() {
  if (!musicPlayerState || !musicPlayerState.userSettings) {
    console.error('Estado do player ou configurações de usuário não carregados');
    return;
  }

  var newShuffleState = !musicPlayerState.userSettings.shuffle;
  musicPlayerState.userSettings.shuffle = newShuffleState;

  var shuffleBtn = document.querySelector('.player-btn .fa-random').parentElement;
  if (!shuffleBtn) {
    console.warn('Botão de aleatório não encontrado');
    return;
  }

  var titles = {
    true: config.languageLabels.shuffleOn || 'Aleatório ativado',
    false: config.languageLabels.shuffleOff || 'Aleatório desativado'
  };

  var notificationMessages = {
    true: (config.languageLabels.shuffle || 'Aleatório') + ": " + (config.languageLabels.shuffleOn || 'ativado'),
    false: (config.languageLabels.shuffle || 'Aleatório') + ": " + (config.languageLabels.shuffleOff || 'desativado')
  };

  shuffleBtn.classList.remove('active', 'passive');
  shuffleBtn.classList.add(newShuffleState ? 'active' : 'passive');
  shuffleBtn.title = titles[newShuffleState];
  shuffleBtn.innerHTML = '<i class="fas fa-random"></i>';

  showNotification(
    newShuffleState
      ? "<i class=\"fas fa-random\"></i> " + (notificationMessages.true)
      : "<i class=\"fas fa-random crossed-icon\"></i> " + (notificationMessages.false),
    1500,
    'kontrol'
  );

  updatePlaylistModal();
  saveUserSettings();
  updateNextTracks();
}

function createKeyboardHelpModal() {
  if (document.querySelector('#keyboardHelpModal')) return;

  var modal = document.createElement('div');
  modal.id = 'keyboardHelpModal';
  modal.style.display = 'none';

  modal.innerHTML = "\n    <h3 style=\"margin-top:0;margin-bottom:10px;\">🎹 Atalhos de Teclado</h3>\n    <ul style=\"list-style:none;padding-left:0;\">\n      <li><b>G</b>: Mostrar/ocultar player</li>\n      <li><b>↑</b> ou <b>+</b>: Aumentar volume</li>\n      <li><b>↓</b> ou <b>-</b>: Diminuir volume</li>\n      <li><b>M</b>: Ativar/desativar som</li>\n      <li><b>S</b>: Mudar modo aleatório</li>\n      <li><b>R</b>: Mudar modo de repetição</li>\n      <li><b>←</b>: Faixa anterior</li>\n      <li><b>→</b>: Próxima faixa</li>\n      <li><b>?</b>: Abrir/fechar ajuda</li>\n      <li><b>Esc</b>: Fechar ajuda</li>\n    </ul>\n  ";
  document.body.appendChild(modal);
}

function toggleKeyboardHelpModal() {
  var modal = document.querySelector('#keyboardHelpModal');
  if (!modal) return;

  var isVisible = modal.style.display === 'block';
  modal.style.display = isVisible ? 'none' : 'block';
}

export function handleKeyPress(e) {
  if (!musicPlayerState.isPlayerVisible && e.key.toLowerCase() !== 'g') return;

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key.toLowerCase()) {
    case 'g':
      e.preventDefault();
      togglePlayerVisibility();
      break;

    case 'arrowup':
    case '+':
      e.preventDefault();
      changeVolume(0.05);
      break;

    case 'arrowdown':
    case '-':
      e.preventDefault();
      changeVolume(-0.05);
      break;

    case '?':
      e.preventDefault();
      toggleKeyboardHelpModal();
      break;

    case 'escape':
      e.preventDefault();
      var modal = document.querySelector('#keyboardHelpModal');
      if (modal) modal.style.display = 'none';
      break;

    case 'm':
      e.preventDefault();
      toggleMute();
      break;

    case 's':
      e.preventDefault();
      toggleShuffle();
      break;

    case 'r':
      e.preventDefault();
      toggleRepeatMode();
      break;

    case 'arrowright':
      e.preventDefault();
      playNext();
      break;

    case 'arrowleft':
      e.preventDefault();
      playPrevious();
      break;

    case ' ':
      e.preventDefault();
      togglePlayPause();
      break;

    default:
      break;
  }
}

createKeyboardHelpModal();

export function toggleRemoveOnPlayMode() {
  var setting = !musicPlayerState.userSettings.removeOnPlay;
  musicPlayerState.userSettings.removeOnPlay = setting;
  saveUserSettings();

  var btn = document.querySelector('.remove-on-play-btn');
  if (!btn) return;

  var onTitle  = config.languageLabels.removeOnPlayOn  || "Excluir após tocar: Ativado";
  var offTitle = config.languageLabels.removeOnPlayOff || "Excluir após tocar: Desativado";
  btn.title = setting ? onTitle : offTitle;
  btn.classList.remove('active', 'passive');
  btn.classList.add(setting ? 'active' : 'passive');

  btn.innerHTML = setting
    ? '<i class="fa-solid fa-trash"></i>'
    : '<i class="fa-solid fa-trash"></i>';

  var message = setting
    ? "<i class=\"fa-solid fa-trash\"></i> " + (config.languageLabels.removeOnPlayOn || "Modo excluir após tocar ativado")
    : "<i class=\"fa-solid fa-trash crossed-icon\"></i> " + (config.languageLabels.removeOnPlayOff || "Modo excluir após tocar desativado");

  showNotification(message, 2000, 'kontrol');
}

export function initializeControlStates() {
  var repeatBtn = document.querySelector('.player-btn.repeat-btn');
  if (repeatBtn) {
    var isActive = musicPlayerState.userSettings.repeatMode !== 'none';
    repeatBtn.classList.remove('active', 'passive');
    repeatBtn.classList.add(isActive ? 'active' : 'passive');
  }

  var shuffleBtn = document.querySelector('.player-btn .fa-random').parentElement;
  if (shuffleBtn) {
    var isActive = musicPlayerState.userSettings.shuffle;
    shuffleBtn.classList.remove('active', 'passive');
    shuffleBtn.classList.add(isActive ? 'active' : 'passive');
  }

  var removeBtn = document.querySelector('.remove-on-play-btn');
  if (removeBtn) {
    var isActive = musicPlayerState.userSettings.removeOnPlay;
    removeBtn.classList.remove('active', 'passive');
    removeBtn.classList.add(isActive ? 'active' : 'passive');
  }
}

export function destroyControls() {
  try { disableKeyboardControls(); } catch {}
  try { volumeAbort.abort(); } catch {}
  volumeAbort = null;
}

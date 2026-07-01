/**
 * Nexus PobreFlix - Gamepad Support & Navigation (Xbox / Steam Deck Controller)
 * Handles D-pad/Analog navigation in TV layout and playback controls.
 */

import { resolveSliderAssetHref } from "./assetLinks.js";

let activeGamepadIndex = null;
let animationFrameId = null;
let lastInputTime = 0;
const INPUT_COOLDOWN_MS = 200; // Cooldown between navigation movements (D-pad/Axes)
const AXIS_THRESHOLD = 0.5; // Threshold for analog stick movement detection

// Keep track of button states to prevent continuous fire on single press
const previousButtonStates = {};

function loadGamepadCSS() {
  try {
    const cssHref = resolveSliderAssetHref("/slider/src/gamepad.css");
    if (!document.querySelector(`link[href^="${cssHref.split('?')[0]}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssHref;
      document.head.appendChild(link);
      console.log("[Nexus Gamepad] Style injected successfully");
    }
  } catch (err) {
    console.warn("Failed to load gamepad.css dynamically:", err);
  }
}

function initGamepadSupport() {
  if (typeof window === 'undefined') return;

  // Desativar APENAS se for o aplicativo nativo Jellyfin Media Player para evitar duplo mapeamento
  if (window.jellyfinmediaplayer) {
    console.log("[Nexus Gamepad] Jellyfin Media Player nativo detectado. Mapeamento JS desativado.");
    return;
  }

  loadGamepadCSS();

  window.addEventListener("gamepadconnected", (e) => {
    console.log("[Nexus Gamepad] Controller connected:", e.gamepad.id);
    activeGamepadIndex = e.gamepad.index;
    document.body.classList.add("jms-gamepad-mode");
    startPollingLoop();
  });

  window.addEventListener("gamepaddisconnected", (e) => {
    if (activeGamepadIndex === e.gamepad.index) {
      console.log("[Nexus Gamepad] Controller disconnected");
      activeGamepadIndex = null;
      document.body.classList.remove("jms-gamepad-mode");
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }
  });

  // Check if a gamepad is already connected at launch
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (let i = 0; i < gamepads.length; i++) {
    if (gamepads[i]) {
      console.log("[Nexus Gamepad] Detected active controller at startup:", gamepads[i].id);
      activeGamepadIndex = i;
      document.body.classList.add("jms-gamepad-mode");
      startPollingLoop();
      break;
    }
  }
}

function startPollingLoop() {
  if (animationFrameId) return;

  function poll() {
    if (activeGamepadIndex === null) return;
    
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[activeGamepadIndex];
    
    if (gp) {
      handleInputs(gp);
      animationFrameId = requestAnimationFrame(poll);
    }
  }
  
  animationFrameId = requestAnimationFrame(poll);
}

function handleInputs(gamepad) {
  const now = Date.now();
  const videoElement = document.querySelector("video");
  const isVideoPlaying = !!videoElement;

  // 1. Directional Axis Navigation (Analog Sticks) - Habilitado em todos os layouts para garantir navegação universal
  if (now - lastInputTime > INPUT_COOLDOWN_MS && !isVideoPlaying) {
    const axisX = gamepad.axes[0]; // Left stick horizontal
    const axisY = gamepad.axes[1]; // Left stick vertical

    if (axisY < -AXIS_THRESHOLD) {
      simulateKeyEvent("ArrowUp", 38);
      lastInputTime = now;
      document.body.classList.add("jms-gamepad-mode");
    } else if (axisY > AXIS_THRESHOLD) {
      simulateKeyEvent("ArrowDown", 40);
      lastInputTime = now;
      document.body.classList.add("jms-gamepad-mode");
    } else if (axisX < -AXIS_THRESHOLD) {
      simulateKeyEvent("ArrowLeft", 37);
      lastInputTime = now;
      document.body.classList.add("jms-gamepad-mode");
    } else if (axisX > AXIS_THRESHOLD) {
      simulateKeyEvent("ArrowRight", 39);
      lastInputTime = now;
      document.body.classList.add("jms-gamepad-mode");
    }
  }

  // Helper for tracking button clicks (triggers once per press)
  const isButtonPressedOnce = (btnIndex, isPressed) => {
    const wasPressed = !!previousButtonStates[btnIndex];
    previousButtonStates[btnIndex] = isPressed;
    return isPressed && !wasPressed;
  };

  // Shortcut for exiting the app via gamepad: Guide Button (16) or holding Select (8) + Start (9)
  const selectBtn = gamepad.buttons[8]?.pressed;
  const startBtn = gamepad.buttons[9]?.pressed;
  if ((selectBtn && startBtn) || gamepad.buttons[16]?.pressed) {
    console.log("[Nexus Gamepad] Exit shortcut detected. Sending exit command to host.");
    if (window.chrome?.webview) {
      window.chrome.webview.postMessage("exit_app");
    }
  }

  // 2. Button Mappings
  gamepad.buttons.forEach((btn, index) => {
    const isPressed = btn.pressed;

    if (isButtonPressedOnce(index, isPressed)) {
      document.body.classList.add("jms-gamepad-mode");

      if (isVideoPlaying) {
        // --- Atalhos de Vídeo (Funcionam em qualquer layout quando assistindo) ---
        switch (index) {
          case 0: // Button A - Toggle Play/Pause
          case 9: // Button Start/Menu - Toggle Play/Pause
            togglePlayPause(videoElement);
            break;
          case 1: // Button B - Back (Close Video Player)
            exitVideoPlayer();
            break;
          case 4: // LB - Seek backward 10s
            seekVideo(videoElement, -10);
            break;
          case 5: // RB - Seek forward 10s
            seekVideo(videoElement, 10);
            break;
          case 6: // LT - Volume Down (Volume nativo do player do navegador)
            adjustVolume(videoElement, -0.05);
            break;
          case 7: // RT - Volume Up (Volume nativo do player do navegador)
            adjustVolume(videoElement, 0.05);
            break;
        }
      } else {
        // --- Navegação Geral do Menu (Habilitada em todos os layouts para garantir compatibilidade) ---
        switch (index) {
          case 0: // Botão A - Confirmar / Selecionar (Simula Enter para navegar de forma nativa e robusta)
            simulateKeyEvent("Enter", 13);
            break;
          case 1: // Botão B - Voltar / Cancelar (Simula Escape para fechar modais/detalhes e Backspace para histórico)
            // Se houver modal ou diálogo de fechar aberto, clica nele. Caso contrário, simula Escape para fechar popups.
            const closeBtn = document.querySelector(".btnHeader-back, .btnHeader-back-active, .button-flat[data-action='back'], .btnModalClose, .btnDialogClose, .dialogCloseBtn");
            if (closeBtn) {
              console.log("[Nexus Gamepad] B Button clicked close button:", closeBtn);
              closeBtn.click();
            } else {
              console.log("[Nexus Gamepad] B Button simulating Escape/Backspace");
              simulateKeyEvent("Escape", 27);
              // Fallback para voltar na história do navegador se necessário
              setTimeout(() => {
                const isDialogStillOpen = !!document.querySelector(".btnModalClose, .btnDialogClose, .dialogCloseBtn, .dialog, .actionSheet");
                if (!isDialogStillOpen) {
                  // Se não fechou nada com Escape, simula voltar
                  simulateKeyEvent("Backspace", 8);
                }
              }, 50);
            }
            break;
          case 9: // Button Start/Menu
            togglePlayPause(videoElement);
            break;
          // D-Pad Navigation (Buttons 12, 13, 14, 15)
          case 12: // D-pad Up
            simulateKeyEvent("ArrowUp", 38);
            break;
          case 13: // D-pad Down
            simulateKeyEvent("ArrowDown", 40);
            break;
          case 14: // D-pad Left
            simulateKeyEvent("ArrowLeft", 37);
            break;
          case 15: // D-pad Right
            simulateKeyEvent("ArrowRight", 39);
            break;
        }
      }
    }
  });
}

function simulateKeyEvent(keyName, keyCode) {
  const activeEl = document.activeElement || document.body;
  
  // Create and dispatch keydown event
  const keydownEvent = new KeyboardEvent("keydown", {
    key: keyName,
    keyCode: keyCode,
    code: keyName,
    which: keyCode,
    bubbles: true,
    cancelable: true
  });
  
  activeEl.dispatchEvent(keydownEvent);
}

function simulateClick() {
  const activeEl = document.activeElement;
  if (activeEl && activeEl !== document.body) {
    console.log("[Nexus Gamepad] Clicking focused element:", activeEl);
    activeEl.click();
  }
}

function togglePlayPause(video) {
  if (!video) return;
  if (video.paused) {
    console.log("[Nexus Gamepad] Video Play");
    video.play().catch(err => console.warn(err));
  } else {
    console.log("[Nexus Gamepad] Video Pause");
    video.pause();
  }
}

function seekVideo(video, seconds) {
  if (!video) return;
  console.log(`[Nexus Gamepad] Seek ${seconds}s`);
  video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
}

function adjustVolume(video, delta) {
  if (!video) return;
  const newVol = Math.max(0, Math.min(1, video.volume + delta));
  console.log(`[Nexus Gamepad] Volume set to: ${Math.round(newVol * 100)}%`);
  video.volume = newVol;
}

function exitVideoPlayer() {
  console.log("[Nexus Gamepad] Exit video player");
  // Try triggering native Jellyfin back buttons
  const backBtn = document.querySelector(".btnHeader-back, .btnHeader-back-active, .button-flat[data-action='back']");
  if (backBtn) {
    backBtn.click();
  } else {
    // Fallback: simulate escape key and back history
    simulateKeyEvent("Escape", 27);
    setTimeout(() => {
      if (document.querySelector("video")) {
        history.back();
      }
    }, 100);
  }
}

export { initGamepadSupport };

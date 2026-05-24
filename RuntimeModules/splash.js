/**
 * Nexus PobreFlix Splash Screen
 * Industrial Grade Loading Experience — v1.0.0.1
 *
 * CORREÇÃO CRÍTICA: O observer anterior aguardava .skinHeader visível,
 * mas o CSS de login o oculta com display:none, gerando deadlock.
 * Agora detectamos o DOM pronto via múltiplos sinais independentes
 * e garantimos timeout de segurança absoluto.
 */
(function() {
    const SPLASH_ID = 'nexus-pobreflix-splash';
    // Logo local offline — sem dependência de rede externa
    const LOGO_URL = '/Plugins/JMSFusion/assets/LogoPng';

    if (document.getElementById(SPLASH_ID)) return;

    const splash = document.createElement('div');
    splash.id = SPLASH_ID;
    splash.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: radial-gradient(circle at center, #1a0b2e 0%, #050505 100%);
        z-index: 999999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transition: opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.8s;
        pointer-events: all;
    `;

    splash.innerHTML = `
        <div style="text-align: center; animation: nexusPulse 2s infinite ease-in-out;">
            <img src="${LOGO_URL}" onerror="this.style.display='none'" style="width: 280px; height: auto; filter: drop-shadow(0 0 20px rgba(122, 92, 255, 0.6)); margin-bottom: 20px;">
            <div style="color: #7a5cff; font-family: 'Montserrat', 'Segoe UI', sans-serif; font-size: 24px; font-weight: 800; letter-spacing: 0.3em; text-shadow: 0 0 15px rgba(122, 92, 255, 0.4);">
                BOA NOITE NEXUS JELLYFIN
            </div>
            <div style="color: #a78bfa; font-family: 'Segoe UI', sans-serif; font-size: 14px; margin-top: 8px; letter-spacing: 0.05em;">
                Carregando o NEXUS POBREFLIX...
            </div>
            <div id="splash-progress-wrapper" style="margin-top: 32px; width: 260px;">
                <div style="color: rgba(167, 139, 250, 0.7); font-family: monospace; font-size: 11px; display: flex; justify-content: space-between; margin-bottom: 6px;">
                    <span style="text-transform: uppercase; letter-spacing: 0.1em;">PROCESSANDO</span>
                    <span id="splash-pct">0%</span>
                </div>
                <div style="width: 100%; height: 4px; background: rgba(122,92,255,0.15); border-radius: 999px; overflow: hidden;">
                    <div id="splash-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #7a5cff, #a78bfa); border-radius: 999px; transition: width 0.3s ease;"></div>
                </div>
            </div>
            <div id="splash-status" style="color: rgba(122, 92, 255, 0.6); font-family: sans-serif; font-size: 11px; margin-top: 16px; text-transform: uppercase; letter-spacing: 0.1em;">
                Sincronizando métricas e carregamento em tempo real
            </div>
        </div>
        <style>
            @keyframes nexusPulse {
                0% { transform: scale(0.98); opacity: 0.85; }
                50% { transform: scale(1.02); opacity: 1; }
                100% { transform: scale(0.98); opacity: 0.85; }
            }
        </style>
    `;

    document.body.appendChild(splash);

    // Animação de progresso fake — garante experiência visual fluida
    let pct = 0;
    const bar = splash.querySelector('#splash-bar');
    const pctLabel = splash.querySelector('#splash-pct');
    const progressInterval = setInterval(() => {
        if (pct < 90) {
            pct += Math.random() * 8;
            if (pct > 90) pct = 90;
            if (bar) bar.style.width = pct.toFixed(0) + '%';
            if (pctLabel) pctLabel.textContent = pct.toFixed(0) + '%';
        }
    }, 300);

    let dismissed = false;
    function hideSplash() {
        if (dismissed) return;
        dismissed = true;
        clearInterval(progressInterval);
        observer.disconnect();

        // Completa a barra antes de sumir
        if (bar) bar.style.width = '100%';
        if (pctLabel) pctLabel.textContent = '100%';
        const status = document.getElementById('splash-status');
        if (status) status.innerText = 'Pronto';

        setTimeout(() => {
            splash.style.opacity = '0';
            splash.style.visibility = 'hidden';
            setTimeout(() => { try { splash.remove(); } catch {} }, 900);
        }, 400);
    }

    // Evento nativo do Jellyfin
    window.addEventListener('jellyfin:initialized', hideSplash, { once: true });

    // Observer corrigido: NÃO depende do .skinHeader (que é ocultado no login)
    // Detecta presença de elementos reais do Jellyfin no DOM
    const observer = new MutationObserver(() => {
        const ready =
            document.querySelector('.homeSectionsContainer') ||
            document.querySelector('#indexPage') ||
            document.querySelector('#loginPage') ||
            document.querySelector('.page.libraryPage') ||
            document.querySelector('.dashboardPage');

        if (ready) {
            hideSplash();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Timeout de segurança absoluto — garante que o splash SEMPRE some
    setTimeout(hideSplash, 6000);
})();

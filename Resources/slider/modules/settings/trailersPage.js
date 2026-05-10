import { createSection, createCheckbox, createTextInput } from './shared.js';
import { showNotification } from "../player/ui/notification.js";
import { getServerBase } from "../../../Plugins/NexusPobreFlix/runtime/api.js";

var LS_JOB_KEY = 'jmsf_trailer_job_running';
var TRAILER_RESOLUTION_OPTIONS = [640, 720, 1080, 1440, 2160];
var DEFAULT_TRAILER_MIN_RESOLUTION = 720;
var DEFAULT_TRAILER_MAX_RESOLUTION = 1080;
var DEFAULT_MAX_CONCURRENT_DOWNLOADS = 1;
var MIN_CONCURRENT_DOWNLOADS = 1;
var MAX_CONCURRENT_DOWNLOADS = 8;

function setJobFlag(on) {
  try { on ? localStorage.setItem(LS_JOB_KEY, String(Date.now())) : localStorage.removeItem(LS_JOB_KEY); } catch {}
}
function getJobFlag() {
  try { return !!localStorage.getItem(LS_JOB_KEY); } catch { return false; }
}

function getAuthHeaders() {
  var token = null, userId = null;
  if (window.ApiClient) {
    try { token = window.ApiClient._serverInfo.AccessToken || window.ApiClient.accessToken.(); } catch {}
    try { var u = window.ApiClient.getCurrentUser(); userId = u.Id || null; } catch {}
  }
  var h = { 'Content-Type': 'application/json' };
  if (token)  h['X-Emby-Token']  = token;
  if (userId) h['X-Emby-UserId'] = userId;
  return h;
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

function checkUserIsAdmin() {
  try {
    if (!window.ApiClient) return false;

    var liveAdmin = readAdminFromUser(window.ApiClient._currentUser);
    if (liveAdmin !== null) return liveAdmin;

    var user = window.ApiClient.getCurrentUser();
    var currentAdmin = readAdminFromUser(user);
    return currentAdmin === true;
  } catch (error) {
    console.error('Kullanıcı yetki kontrolü hatası:', error);
    return false;
  }
}

function mapEnumToWire(val) {
  if (!val) return 'skip';
  var s = String(val).toLowerCase();
  if (s.includes('replace')) return 'replace';
  if (s.includes('better'))  return 'if-better';
  return 'skip';
}
function parseIntSafe(x){ var n=Number(x); return Number.isFinite(n)?n:0; }

function normalizeBaseUrl(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, window.location.href).toString().replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function resolveAutoJfBase(config = {}) {
  var candidates = [];

  try { candidates.push(getServerBase()); } catch {}

  try {
    var api = window.ApiClient || null;
    candidates.push(typeof api.serverAddress === 'function' ? api.serverAddress() : api.serverAddress);
    candidates.push(api._serverInfo.ManualAddress);
    candidates.push(api._serverInfo.LocalAddress);
  } catch {}

  candidates.push(config.JFBase);
  candidates.push(config.jfBase);

  for (var candidate of candidates) {
    var normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }

  return '';
}

function normalizeTrailerConfigEnvelope(payload) {
  var base = payload.cfg && typeof payload.cfg === 'object' ? payload.cfg : payload;
  return base && typeof base === 'object' ? base : {};
}

function pickConfigValue(source, ...keys) {
  var cfg = normalizeTrailerConfigEnvelope(source);
  for (var key of keys) {
    if (cfg[key] != null) return cfg[key];
  }
  return undefined;
}

function coerceBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeResolutionOption(value, fallback) {
  var num = Number(value);
  if (!Number.isFinite(num)) return fallback;

  return TRAILER_RESOLUTION_OPTIONS.reducefunction((closest, option) (
    Math.abs(option - num) < Math.abs(closest - num) ? option : closest
  ), fallback);
}

function normalizeConcurrentDownloads(value, fallback = DEFAULT_MAX_CONCURRENT_DOWNLOADS) {
  var num = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(MAX_CONCURRENT_DOWNLOADS, Math.max(MIN_CONCURRENT_DOWNLOADS, num));
}

function getResolutionBounds(source) {
  var minRaw = pickConfigValue(source, 'trailerMinResolution', 'TrailerMinResolution');
  var maxRaw = pickConfigValue(source, 'trailerMaxResolution', 'TrailerMaxResolution');
  var min = normalizeResolutionOption(minRaw, DEFAULT_TRAILER_MIN_RESOLUTION);
  var max = normalizeResolutionOption(maxRaw, DEFAULT_TRAILER_MAX_RESOLUTION);
  return min <= max ? { min, max } : { min: max, max: min };
}

function fmtStr(str, params) {
  if (!params) return String(str || '');
  return String(str || '').replace(/\{(\w+)\}/g, function(_, k) (params[k] || ''));
}

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchFirst(text, patterns) {
  for (var pattern of patterns) {
    if (!pattern) continue;
    var m = text.match(pattern);
    if (m) return m;
  }
  return null;
}

function normalizeMessageArgs(args) {
  return args && typeof args === 'object' ? args : {};
}

function translateTrailerStepName(step, L) {
  var raw = String(step || '').trim();
  if (!raw) return '';
  if (/^trailers\.sh$/i.test(raw)) return L.summaryDownloaderTitle;
  if (/^trailersurl\.sh$/i.test(raw)) return L.summaryUrlNfoTitle;
  return raw;
}

function translateTrailersMessage(code, args, fallback, L) {
  var p = normalizeMessageArgs(args);
  var localizedStep = translateTrailerStepName(p.step, L) || p.step || '';

  switch (String(code || '')) {
    case 'trailers.api.user_header_required':
      return L.ctrlApiUserHeaderRequired;
    case 'trailers.api.token_header_required':
      return L.ctrlApiTokenHeaderRequired;
    case 'trailers.api.user_not_found':
      return L.shUserNotFound;
    case 'trailers.api.admin_required':
      return L.adminRequired;
    case 'trailers.api.script_execution_disabled':
      return L.ctrlApiExecutionDisabled;
    case 'trailers.api.no_task_enabled':
      return L.ctrlApiNoTaskEnabled;
    case 'trailers.api.already_running':
      return L.alreadyRunning;
    case 'trailers.api.plugin_config_unavailable':
      return L.ctrlApiPluginConfigUnavailable;
    case 'trailers.api.plugin_config_hint':
      return L.ctrlApiPluginConfigHint;
    case 'trailers.api.cancel_in_progress':
      return L.ctrlApiCancelInProgress;
    case 'trailers.api.no_running_job':
      return L.ctrlApiNoRunningJob;
    case 'trailers.api.unexpected_error':
      return L.ctrlApiUnexpectedError;
    case 'trailers.last.cancel_requested':
      return L.ctrlLastCancelRequested;
    case 'trailers.last.step_starting':
      return fmtStr(L.ctrlLastStepStarting, { step: localizedStep });
    case 'trailers.last.step_finished':
      return fmtStr(L.ctrlLastStepFinished, { step: localizedStep });
    case 'trailers.last.cancelled':
      return L.cancelled;
    case 'trailers.last.finished':
      return fmtStr(L.ctrlLastFinishedDuration, { seconds: p.seconds || '' });
    default:
      break;
  }

  if (fallback != null && fallback !== '') {
    return translateLogLine(String(fallback), L);
  }

  return '';
}

function translateTrailersLastMessage(status, L) {
  var raw = String(status.lastMessage || '').trim();
  if (!status.lastMessageCode && /^JMSF::(?:TOTAL|DONE)=/i.test(raw)) {
    return '';
  }
  return translateTrailersMessage(status.lastMessageCode, status.lastMessageArgs, raw, L);
}

function translateTrailersApiErrorText(data, L, status, rawText = '') {
  var errorText = translateTrailersMessage(data.errorCode, data.errorArgs, data.error || data.Message, L);
  var hintText = translateTrailersMessage(data.hintCode, data.hintArgs, data.hint, L);
  var detailText = typeof data.detail === 'string' ? data.detail.trim() : '';
  var parts = [errorText, hintText];
  if (detailText && !parts.includes(detailText)) parts.push(detailText);
  if (!parts.some(Boolean) && rawText) parts.push("HTTP " + (status) + ": " + (rawText));
  return parts.filter(Boolean).join(' ');
}

function formatShortTime(value) {
  if (!value) return '';
  var d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return d.toLocaleTimeString();
  }
}

function buildProgressBody(status, L) {
  var lines = [];
  var startedAt = formatShortTime(status.startedAt);
  if (startedAt) {
    lines.push((L.progressStartedAtLabel) + ": " + (startedAt));
  }

  var steps = Array.isArray(status.steps) ? status.steps : [];
  var stepCount = steps.length;
  var currentStep = String(status.currentStep || '');
  var currentStepLabel = translateTrailerStepName(currentStep, L);
  var stepIndex = currentStep ? steps.findIndexfunction((step) String(step) === currentStep) + 1 : 0;
  if (!status.running && stepCount > 0) stepIndex = stepCount;
  if (stepIndex <= 0 && status.running && stepCount > 0) stepIndex = 1;

  if (stepCount > 0) {
    var stepText = currentStepLabel
      ? (stepIndex) + "/" + (stepCount) + " (" + (currentStepLabel) + ")"
      : (stepIndex) + "/" + (stepCount);
    lines.push((L.progressStepLabel) + ": " + (stepText));
  }

  var done = Number(status.currentStepDone);
  var total = Number(status.currentStepTotal);
  if (Number.isFinite(total) && total > 0) {
    var safeDone = Number.isFinite(done) ? Math.max(0, done) : 0;
    lines.push((L.progressItemsLabel) + ": " + (safeDone) + "/" + (total));
  } else if (status.running) {
    lines.push((L.progressItemsLabel) + ": " + (L.progressItemsPending));
  }

  return lines.join('\n');
}

function translateLogLine(line, L) {
  if (!line) return line;
  var rawLine = String(line);

  line = line
    .replace(/\[INFO\]/g,  L.logInfo)
    .replace(/\[WARN\]|\[AVISO\]/g,  L.logWarn)
    .replace(/\[ERRO\]/g,  L.logError)
    .replace(/\[OK\]/g,    L.logOk)
    .replace(/\[PULAR\]/g,  L.logSkip)
    .replace(/\[BAIXAR\]/g, L.logDownload)
    .replace(/\[DEBUG\]/g, L.logDebug);

  var rules = [
    { re: /Tarefa cancelada\./i, out: L.cancelled },
    { re: /Este script requer bash/i, out: L.shRequiresBash },
    { re: /WORK_DIR não pôde ser criado/i,   out: L.shWorkdirCreateFailed },
    { re: /Erro:\s*([A-Za-z0-9_\-.]+)\s+não pôde ser preparado/i, out: function(m) fmtStr(L.shDependencyMissing, { bin: m[1] }) },
    { re: /Erro:\s*yt-dlp não pôde ser preparado\./i, out: L.shYtDlpPrepareFailed },
    { re: /Erro:\s*deno não pôde ser preparado\./i, out: L.shDenoPrepareFailed },
    { re: /Aviso:\s*ffprobe não encontrado/i,      out: L.shFfprobeMissing },
    { re: /Erro:\s*Falha ao obter token de sessão do Jellyfin/i, out: L.shSessionTokenMissing },
    { re: /Erro:\s*Configure TMDB_API_KEY/i, out: L.shSetTmdbApiKey },
    { re: /Erro:\s*Configure JF_API_KEY e TMDB_API_KEY/i, out: L.shSetApiKeys },
    { re: /OVERWRITE_POLICY inválido/i, out: L.shInvalidOverwrite },
    { re: /Usuário não encontrado/i,      out: L.shUserNotFound },
    { re: /Limite de downloads simultâneos:\s*(\d+)/i,
      out: function(m) fmtStr(L.shConcurrentDownloadLimit, { n: m[1] }) },
    { re: /\[DEBUG\]\s*Processando:\s*(.+?)\s*\(IMDb:\s*(.*?),\s*TMDb:\s*(.*?),\s*Tipo:\s*(.+?)\)/i,
      out: function(m) fmtStr(L.shProcessing, { name: m[1], imdb: m[2] || '-', tmdb: m[3] || '-', type: m[4] }) },
    { re: /Já existe: .*theme\.mp4 configurado\/mantido/i, out: L.shAlreadyExistsThemeDone },
    { re: /Já existe:/i,               out: L.shAlreadyExists },
    { re: /Será sobrescrito:/i,       out: L.shOverwriteReplace },
    { re: /Modo if-better/i,           out: L.shIfBetterMode },
    { re: /ID TMDb ausente/i,          out: L.shTmdbMissing },
    { re: /TMDb da Série ausente/i,    out: L.shSeriesTmdbMissing },
    { re: /Tipo não suportado/i,       out: L.shUnsupportedType },
    { re: /Caminho \(Path\) ausente/i, out: L.shNoPath },
    { re: /A mesma pasta já foi processada nesta execução:\s*(.+?)\s*->\s*(.+?)\s*\(([^()]*)\)\s*$/i,
      out: function(m) fmtStr(L.shDirAlreadyHandled, { dir: m[1], name: m[2], year: m[3] }) },
    { re: /Pasta sem permissão de escrita, pulando:\s*(.+?)\s*->\s*(.+?)\s*\(([^()]*)\)\s*$/i,
      out: function(m) fmtStr(L.shDirNotWritable, { dir: m[1], name: m[2], year: m[3] }) },
    { re: /Espaço insuficiente no destino/i, out: L.shInsufficientSpaceDest },
    { re: /Espaço insuficiente na pasta temporária/i, out: L.shInsufficientSpaceWork },
    { re: /Tentativa #(\d+):\s*([a-z]+):([A-Za-z0-9_\-]+)/i,
      out: function(m) fmtStr(L.shTryingCandidate, { n: m[1], site: m[2], key: m[3] }) },
    { re: /\[INDIR\]\s*(.+?)\s*\((.*?)\)\s*->\s*(.+?)\s*\[([a-z]+):([A-Za-z0-9_\-]+)\]\s*\((?:best mp4|source quality)\)/i,
      out: function(m) fmtStr(L.shDownloading, { name: m[1], year: m[2], out: m[3], site: m[4], key: m[5] }) },
    { re: /Tentativa #(\d+) do yt-dlp falhou/i,
      out: function(m) fmtStr(L.shYtDlpRetryFail, { n: m[1] }) },
    { re: /yt-dlp stderr:\s*(.+)$/i,
      out: function(m) fmtStr(L.shYtDlpStderr, { line: m[1] }) },
    { re: /yt-dlp saída:\s*(.+)$/i,
      out: function(m) fmtStr(L.shYtDlpStdout, { line: m[1] }) },
    { re: /Sem espaço em disco/i,      out: L.shNoSpaceLeft },
    { re: /Arquivo muito pequeno/i,    out: L.shFileTooSmall },
    { re: /Duração curta/i,            out: L.shDurationShort },
    { re: /Novo trailer encontrado é melhor.*substituindo/i, out: L.shIfBetterNewIsBetter },
    { re: /Trailer atual é melhor ou equivalente.*novo arquivo removido/i, out: L.shIfBetterOldIsBetter },
    { re: /Falha no mv, não foi possível escrever:\s*(.+)$/i,
      out: function(m) fmtStr(L.shMoveFailed, { path: m[1] }) },
    { re: /Adicionado e atualizado/i,  out: L.shMovedAddedRefreshed },
    { re: /Nenhum trailer baixável adequado encontrado/i, out: L.shNoDownloadableFound },
    { re: /Caminho do NFO não resolvido:\s*(.+)$/i,
      out: function(m) fmtStr(L.shNfoPathResolveFailed, { name: m[1] }) },
    { re: /Falha ao atualizar \(Refresh\):\s*(.+)$/i,
      out: function(m) (L.shRefreshFailed) + ": " + (m[1]) },
    { re: /Trailer não encontrado:\s*(.+)$/i,
      out: function(m) (L.urlNfoNotFound) + ": " + (m[1]) },
    { re: /Não foi possível criar a pasta backdrops:\s*(.+)$/i,
      out: function(m) fmtStr(L.shBackdropsDirCreateFailed, { dir: m[1] }) },
    { re: /Link simbólico criado para theme\.mp4 \(mode=symlink\):\s*(.+?)\s*->\s*(.+)$/i,
      out: function(m) fmtStr(L.shThemeSymlinkCreated, { path: m[1], target: m[2] }) },
    { re: /Link simbólico indisponível, usando hardlink como fallback \(mode=symlink\):\s*(.+)$/i,
      out: function(m) fmtStr(L.shThemeHardlinkFallback, { path: m[1] }) },
    { re: /Não foi possível criar link simbólico\/hardlink, pulando theme\.mp4 \(mode=symlink\)\./i,
      out: L.shThemeSymlinkFailed },
    { re: /Hardlink criado para theme\.mp4 \(mode=hardlink\):\s*(.+)$/i,
      out: function(m) fmtStr(L.shThemeHardlinkCreated, { path: m[1] }) },
    { re: /Hardlink indisponível, usando link simbólico como fallback \(mode=hardlink\):\s*(.+)$/i,
      out: function(m) fmtStr(L.shThemeSymlinkFallback, { path: m[1] }) },
    { re: /Não foi possível criar hardlink\/link simbólico, pulando theme\.mp4 \(mode=hardlink\)\./i,
      out: L.shThemeHardlinkFailed },
    { re: /theme\.mp4 copiado \(mode=copy\):\s*(.+)$/i,
      out: function(m) fmtStr(L.shThemeCopied, { path: m[1] }) },
    { re: /Falha ao copiar theme\.mp4 \(mode=copy\):\s*(.+)$/i,
      out: function(m) fmtStr(L.shThemeCopyFailed, { path: m[1] }) },
    { re: /backdrops\/theme\.mp4 preparado (?:→|->)\s*(.+)$/i,
      out: function(m) fmtStr(L.shThemeReady, { path: m[1] }) },
    { re: /Limpando arquivos temporários/i, out: L.shCleaningTemps },
    { re: /CONCLUÍDO:\s*processados\s*=\s*(\d+)/i, out: function(m) fmtStr(L.shFinishedCount, { n: m[1] }) },
    { re: /RESUMO\s*->\s*baixados\s*=\s*(\d+)\s*,\s*falhas\s*=\s*(\d+)(?:\s*,\s*pulados(?:\(já existiam\))?\s*=\s*(\d+))?/i,
      out: function(m) fmtStr(L.shSummaryLine, { ok: m[1], fail: m[2], skip: m[3] || '?' }) },
  ];

  for (var rule of rules) {
    var m = rawLine.match(rule.re) || line.match(rule.re);
    if (m) return typeof rule.out === 'function' ? rule.out(m) : rule.out;
  }
  return line;
}

function translateLogBlock(allText, L) {
  if (!allText) return '';
  return allText
    .split(/\r?\n/)
    .mapfunction((ln) translateLogLine(ln, L))
    .join('\n');
}

export function createTrailersPanel(config, labels) {
  var L = {
    trailersHeader: labels.trailersHeader || 'Configurações de Trailers e NFO',
    enableTrailerDownloader: labels.enableTrailerDownloader || 'Baixar trailers (trailers.sh)',
    enableTrailerUrlNfo: labels.enableTrailerUrlNfo || 'Apenas URL no NFO (trailersurl.sh)',
    jfBase: labels.jfBase || 'URL do Jellyfin (JF_BASE)',
    jfBaseAutoNote: labels.jfBaseAutoNote || 'A URL é detectada automaticamente pela sessão ativa.',
    tmdbApiKey: labels.tmdbApiKey || 'Chave API TMDb',
    preferredLang: labels.preferredLang || 'Idioma principal (PREFERRED_LANG)',
    fallbackLang: labels.fallbackLang || 'Idioma reserva (FALLBACK_LANG)',
    trailerMinResolution: labels.trailerMinResolution || 'Resolução mínima',
    trailerMaxResolution: labels.trailerMaxResolution || 'Resolução máxima',
    trailerResolutionHint: labels.trailerResolutionHint || 'Os trailers serão filtrados conforme este intervalo de resolução.',
    maxConcurrentDownloads: labels.maxConcurrentDownloads || 'Downloads simultâneos',
    maxConcurrentDownloadsHint: labels.maxConcurrentDownloadsHint || '1 = sequencial. Valores maiores iniciam múltiplos downloads.',
    overwritePolicy: labels.overwritePolicy || 'Política de Substituição',
    enableThemeLink: labels.enableThemeLink || 'Gerar theme.mp4 (Link Simbólico/Cópia)',
    themeLinkMode: labels.themeLinkMode || 'Modo de Link do Tema',
    saveSettings: labels.saveSettings || 'Salvar',
    runNow: labels.runNow || 'Executar Agora',
    saving: labels.saving || 'Salvando...',
    running: labels.running || 'Executando...',
    preparing: labels.preparing || 'Preparando...',
    settingsSaved: labels.settingsSaved || 'Configurações salvas.',
    atLeastOneOption: labels.atLeastOneOption || 'Selecione ao menos uma tarefa.',
    done: labels.done || 'Tarefa concluída.',
    runError: labels.runError || 'Erro ao executar.',
    saveError: labels.saveError || 'Falha ao salvar: ',
    summaryDownloaderTitle: labels.summaryDownloaderTitle || 'Downloader (trailers.sh)',
    summaryUrlNfoTitle: labels.summaryUrlNfoTitle || 'NFO (trailersurl.sh)',
    summarySuccess: labels.summarySuccess || 'Sucesso',
    summaryFailed: labels.summaryFailed || 'Falha',
    summaryTotal: labels.summaryTotal || 'Total',
    overwriteSkip: labels.overwriteSkip || 'Pular (skip)',
    overwriteReplace: labels.overwriteReplace || 'Substituir (replace)',
    overwriteIfBetter: labels.overwriteIfBetter || 'Se melhor (if-better)',
    modeSymlink: labels.modeSymlink || 'Link Simbólico (symlink)',
    modeHardlink: labels.modeHardlink || 'Link Rígido (hardlink)',
    modeCopy: labels.modeCopy || 'Copiar (copy)',
    settingsReadOnly: labels.settingsReadOnly || 'Apenas administradores podem alterar estas configurações.',
    confirmTitle: labels.confirmTitle || 'Ação de Longa Duração',
    confirmBody: labels.confirmBody || 'Esta tarefa pode demorar bastante. Deseja iniciar?',
    confirmOk: labels.confirmOk || 'Sim, Iniciar',
    confirmCancel: labels.confirmCancel || 'Cancelar',
    confirm: labels.confirm || 'Confirmar',
    cancel: labels.cancel || 'Cancelar',
    copy: labels.copy || 'Copiar',
    log: labels.log || 'Log ao Vivo',
    clean: labels.clean || 'Limpar',
    close: labels.close || 'Fechar',
    passo: labels.passo || 'Passo',
    copied: labels.copied || 'Copiado!',
    copyFailed: labels.copyFailed || 'Falha ao copiar',
    showLog: labels.showLog || "Mostrar Log",
    hideLog: labels.hideLog || "Ocultar Log",
    noLogToCopy: labels.noLogToCopy || 'Não há nada para copiar.',
    progressTitle: labels.progressTitle || 'Tarefa de Trailers em Execução',
    progressStartedAtLabel: labels.progressStartedAtLabel || 'Início',
    progressStepLabel: labels.progressStepLabel || 'Passo',
    progressItemsLabel: labels.progressItemsLabel || 'Item',
    progressItemsPending: labels.progressItemsPending || 'Preparando...',
    stopButton: labels.stopButton || 'Parar',
    stopping: labels.stopping || 'Interrompendo...',
    cancelled: labels.cancelled || 'Tarefa cancelada pelo usuário.',
    alreadyRunning: labels.alreadyRunning || 'Já existe uma tarefa em execução; conectando...',
    ctrlApiUserHeaderRequired: labels.ctrlApiUserHeaderRequired || 'ID de usuário necessário.',
    ctrlApiTokenHeaderRequired: labels.ctrlApiTokenHeaderRequired || 'Token de acesso necessário.',
    ctrlApiExecutionDisabled: labels.ctrlApiExecutionDisabled || 'Execução de scripts desativada.',
    ctrlApiNoTaskEnabled: labels.ctrlApiNoTaskEnabled || 'Nenhuma tarefa ativada.',
    ctrlApiPluginConfigUnavailable: labels.ctrlApiPluginConfigUnavailable || 'Configurações do plugin não disponíveis.',
    ctrlApiPluginConfigHint: labels.ctrlApiPluginConfigHint || 'Verifique se a pasta /config/plugins tem permissão de escrita.',
    ctrlApiCancelInProgress: labels.ctrlApiCancelInProgress || 'Cancelando tarefa...',
    ctrlApiNoRunningJob: labels.ctrlApiNoRunningJob || 'Nenhum trabalho em execução.',
    ctrlApiUnexpectedError: labels.ctrlApiUnexpectedError || 'Ocorreu um erro inesperado.',
    ctrlLastCancelRequested: labels.ctrlLastCancelRequested || 'Cancelamento solicitado.',
    ctrlLastStepStarting: labels.ctrlLastStepStarting || '{step} iniciando...',
    ctrlLastStepFinished: labels.ctrlLastStepFinished || '{step} concluído.',
    ctrlLastFinishedDuration: labels.ctrlLastFinishedDuration || 'Concluído ✓ ({seconds} s)',
    logInfo: labels.logInfo || '[INFO]',
    logWarn: labels.logWarn || '[AVISO]',
    logError: labels.logError || '[ERRO]',
    logOk: labels.logOk || '[OK]',
    logSkip: labels.logSkip || '[PULAR]',
    logDownload: labels.logDownload || '[BAIXAR]',
    logDebug: labels.logDebug || '[DEBUG]',
    shRequiresBash: labels.shRequiresBash || "O Bash é necessário para este script.",
    shWorkdirCreateFailed: labels.shWorkdirCreateFailed || 'Falha ao criar diretório de trabalho.',
    shDependencyMissing: labels.shDependencyMissing || 'Dependência ausente: {bin}',
    shFfprobeMissing: labels.shFfprobeMissing || 'ffprobe não encontrado; verificação limitada.',
    shSessionTokenMissing: labels.shSessionTokenMissing || 'Token de sessão do Jellyfin inválido.',
    shSetTmdbApiKey: labels.shSetTmdbApiKey || 'Defina TMDB_API_KEY.',
    shSetApiKeys: labels.shSetApiKeys || 'Defina as chaves JF e TMDB.',
    shInvalidOverwrite: labels.shInvalidOverwrite || 'Política de substituição inválida.',
    shUserNotFound: labels.shUserNotFound || 'Usuário não encontrado.',
    shYtDlpPrepareFailed: labels.shYtDlpPrepareFailed || 'Falha ao preparar yt-dlp.',
    shDenoPrepareFailed: labels.shDenoPrepareFailed || 'Falha ao preparar deno.',
    shConcurrentDownloadLimit: labels.shConcurrentDownloadLimit || 'Limite de downloads: {n}',
    shProcessing: labels.shProcessing || 'Processando: {name} (IMDb: {imdb}, TMDb: {tmdb}, Tipo: {type})',
    shAlreadyExistsThemeDone: labels.shAlreadyExistsThemeDone || 'Já existe; theme.mp4 preservado.',
    shAlreadyExists: labels.shAlreadyExists || 'Já existe.',
    shOverwriteReplace: labels.shOverwriteReplace || 'Será substituído.',
    shIfBetterMode: labels.shIfBetterMode || 'Modo if-better: comparando qualidades.',
    shTmdbMissing: labels.shTmdbMissing || 'ID TMDb ausente.',
    shSeriesTmdbMissing: labels.shSeriesTmdbMissing || 'ID TMDb da Série ausente.',
    shUnsupportedType: labels.shUnsupportedType || 'Tipo não suportado.',
    shNoPath: labels.shNoPath || 'Caminho ausente.',
    shDirAlreadyHandled: labels.shDirAlreadyHandled || 'Diretório já processado: {dir} -> {name} ({year})',
    shDirNotWritable: labels.shDirNotWritable || 'Diretório sem permissão de escrita: {dir} -> {name} ({year})',
    shInsufficientSpaceDest: labels.shInsufficientSpaceDest || 'Espaço insuficiente no destino.',
    shInsufficientSpaceWork: labels.shInsufficientSpaceWork || 'Espaço insuficiente na pasta de trabalho.',
    shTryingCandidate: labels.shTryingCandidate || 'Tentando candidato #{n}: {site}:{key}',
    shDownloading: labels.shDownloading || 'Baixando {name} ({year}) → {out} [{site}:{key}]',
    shYtDlpRetryFail: labels.shYtDlpRetryFail || 'Tentativa yt-dlp #{n} falhou.',
    shYtDlpStderr: labels.shYtDlpStderr || 'Erro yt-dlp: {line}',
    shYtDlpStdout: labels.shYtDlpStdout || 'Saída yt-dlp: {line}',
    shNoSpaceLeft: labels.shNoSpaceLeft || 'Sem espaço no disco.',
    shFileTooSmall: labels.shFileTooSmall || 'Arquivo muito pequeno.',
    shDurationShort: labels.shDurationShort || 'Duração muito curta.',
    shIfBetterNewIsBetter: labels.shIfBetterNewIsBetter || 'Nova versão é melhor: substituindo.',
    shIfBetterOldIsBetter: labels.shIfBetterOldIsBetter || 'Versão atual é melhor: mantendo original.',
    shMoveFailed: labels.shMoveFailed || 'Erro ao mover arquivo para {path}.',
    shMovedAddedRefreshed: labels.shMovedAddedRefreshed || 'Adicionado e biblioteca atualizada.',
    shNoDownloadableFound: labels.shNoDownloadableFound || 'Nenhum trailer baixável encontrado.',
    shNfoPathResolveFailed: labels.shNfoPathResolveFailed || 'Erro ao resolver NFO para {name}.',
    shBackdropsDirCreateFailed: labels.shBackdropsDirCreateFailed || 'Erro ao criar pasta de backdrops: {dir}',
    shThemeSymlinkCreated: labels.shThemeSymlinkCreated || 'Symlink para theme.mp4 criado: {path} -> {target}',
    shThemeHardlinkFallback: labels.shThemeHardlinkFallback || 'Symlink indisponível, fallback para hardlink: {path}',
    shThemeSymlinkFailed: labels.shThemeSymlinkFailed || 'Falha ao criar symlink/hardlink para theme.mp4.',
    shThemeHardlinkCreated: labels.shThemeHardlinkCreated || 'Hardlink para theme.mp4 criado: {path}',
    shThemeSymlinkFallback: labels.shThemeSymlinkFallback || 'Hardlink indisponível, fallback para symlink: {path}',
    shThemeHardlinkFailed: labels.shThemeHardlinkFailed || 'Falha ao criar hardlink/symlink para theme.mp4.',
    shThemeCopied: labels.shThemeCopied || 'theme.mp4 copiado: {path}',
    shThemeCopyFailed: labels.shThemeCopyFailed || 'Erro ao copiar theme.mp4: {path}',
    shThemeReady: labels.shThemeReady || 'theme.mp4 pronto em {path}',
    shCleaningTemps: labels.shCleaningTemps || 'Limpando arquivos temporários...',
    shFinishedCount: labels.shFinishedCount || 'Concluído: processados={n}',
    shSummaryLine: labels.shSummaryLine || 'RESUMO -> Sucesso={ok}, Falha={fail}, Pulados={skip}',
    rxFinishedProcessed: labels.rxFinishedProcessed || 'BİTTİ:\\s*işlenen\\s*=\\s*(\\d+)',
    rxSummaryOkFail: labels.rxSummaryOkFail || 'ÖZET\\s*->\\s*indirilen\\s*=\\s*(\\d+)\\s*,\\s*başarısız\\s*=\\s*(\\d+)',
    urlNfoTotal: labels.urlNfoTotal || 'Total de itens processados',
    urlNfoOk: labels.urlNfoOk || 'Sucesso (NFO atualizado)',
    urlNfoNotFound: labels.urlNfoNotFound || 'Trailer não encontrado',
    urlNfoFailWrite: labels.urlNfoFailWrite || 'Erro ao escrever NFO',
    urlNfoFailRefresh: labels.urlNfoFailRefresh || 'Erro ao atualizar biblioteca',
    urlNfoNoTmdb: labels.urlNfoNoTmdb || 'ID TMDb ausente',
    urlNfoNoPath: labels.urlNfoNoPath || 'Caminho ausente',
    urlNfoUnsupported: labels.urlNfoUnsupported || 'Tipo incompatível',
    urlNfoMisc: labels.urlNfoMisc || 'Diversos',
  };
  function baseBtnCss() {
    return "appearance:none; border:1px solid rgba(255,255,255,.15); background: transparent; color:inherit; padding:8px 12px; border-radius:10px; cursor:pointer; transition:all .2s;";
  }
  function primaryBtnCss() {
    return "appearance:none; border:1px solid rgba(34,197,94,.6); background: rgba(34,197,94,.1); color:#bbf7d0; padding:8px 12px; border-radius:10px; cursor:pointer; transition:all .2s;";
  }
  function dangerBtnCss() {
    return "appearance:none; border:1px solid rgba(239,68,68,.6); background: rgba(239,68,68,.12); color:#fecaca; padding:8px 12px; border-radius:10px; cursor:pointer; transition:all .2s;";
  }

  function createModal() {
    var overlay = document.createElement('div');
    overlay.className = 'jf-modal-overlay';
    overlay.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,.45); display: none; align-items: center; justify-content: center; z-index: 99999;";

    var modal = document.createElement('div');
    modal.className = 'jf-modal';
    modal.style.cssText = "width: min(820px, 94vw); background: var(--theme-body-bg, #111827); color: var(--theme-body-text, #e5e7eb); border-radius: 16px; padding: 18px 18px 16px; box-shadow: 0 10px 40px rgba(0,0,0,.4); border: 1px solid rgba(255,255,255,.08); display:flex; flex-direction:column; max-height:90vh;";

    var title = document.createElement('div');
    title.className = 'jf-modal-title';
    title.style.cssText = "font-weight:700; font-size:1.05rem; margin-bottom:6px;";

    var body = document.createElement('div');
    body.className = 'jf-modal-body';
    body.style.cssText = "font-size:.95rem; opacity:.9; margin-bottom:12px; white-space:pre-wrap;";

    var progressWrap = document.createElement('div');
    progressWrap.style.cssText = "margin:6px 0 8px 0; display:none;";

    var progressBar = document.createElement('div');
    progressBar.style.cssText = "height: 10px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden;";
    var progressInner = document.createElement('div');
    progressInner.style.cssText = "height:100%; width:0%; background: linear-gradient(90deg, #22c55e, #84cc16); transition: width .35s ease;";
    progressBar.appendChild(progressInner);
    progressWrap.appendChild(progressBar);

    var sub = document.createElement('div');
    sub.className = 'jf-modal-sub';
    sub.style.cssText = "font-size:.82rem; opacity:.85; margin:6px 0;";

    var logWrap = document.createElement('div');
    logWrap.style.cssText = "display:none; margin-top:6px; flex:1; min-height:140px; overflow-y: scroll; overflow-x: hidden; scrollbar-color: #e91e63 #20202000 !important; scrollbar-width: thin; padding: 5px;";

    var logHeader = document.createElement('div');
    logHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;";
    var logTitle = document.createElement('span');
    logTitle.textContent = L.log;
    logTitle.style.cssText = 'opacity:.9;';
    var logBtns = document.createElement('div');
    logBtns.style.cssText = 'display:flex; gap:6px;';

    var btnCopyLog = document.createElement('button');
    btnCopyLog.textContent = L.copy;
    btnCopyLog.style.cssText = baseBtnCss();
    var btnClearLog = document.createElement('button');
    btnClearLog.textContent = L.clean;
    btnClearLog.style.cssText = baseBtnCss();

    logBtns.append(btnCopyLog, btnClearLog);
    logHeader.append(logTitle, logBtns);

    var log = document.createElement('pre');
    log.className = 'jf-modal-log';
    log.style.cssText = "background: rgba(255,255,255,.06); padding:10px; border-radius:12px; height:100%; overflow:auto; white-space:pre-wrap; font-size:.83rem; line-height:1.25;";

    logWrap.append(logHeader, log);

    var row = document.createElement('div');
    row.style.cssText = "display:flex; gap:8px; justify-content:flex-end; margin-top:12px; flex-wrap:wrap;";

    var btnToggleLog = document.createElement('button');
    btnToggleLog.textContent = L.showLog;
    btnToggleLog.className = 'btn-toggle-log';
    btnToggleLog.style.cssText = baseBtnCss();
    btnToggleLog.style.display = 'none';

    var btnCancel = document.createElement('button');
    btnCancel.textContent = L.cancel;
    btnCancel.className = 'btn-cancel';
    btnCancel.style.cssText = baseBtnCss();

    var btnOk = document.createElement('button');
    btnOk.textContent = L.confirm;
    btnOk.className = 'btn-ok';
    btnOk.style.cssText = primaryBtnCss();

    var btnStop = document.createElement('button');
    btnStop.textContent = L.stopButton;
    btnStop.className = 'btn-stop';
    btnStop.style.cssText = dangerBtnCss();
    btnStop.style.display = 'none';

    row.append(btnToggleLog, btnCancel, btnStop, btnOk);
    modal.append(title, body, progressWrap, sub, logWrap, row);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    btnCopyLog.onclick = function() {
      var txt = log.textContent || '';
      if (!txt.trim()) {
        showNotification(L.noLogToCopy, 2200, 'warning');
        return;
      }
      try {
        if (navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt);
        } else {
          var ta = document.createElement('textarea');
          ta.value = txt;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          ta.style.pointerEvents = 'none';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showNotification(L.copied, 2500, 'success');
      } catch (e) {
        showNotification(L.copyFailed, 2500, 'error');
      }
    };
    btnClearLog.onclick = function() { log.textContent = ''; };

    logWrap.dataset.forceHidden = '0';

    btnToggleLog.onclick = function() {
      var hidden = logWrap.style.display === 'none';
      if (hidden) {
        logWrap.style.display = '';
        btnToggleLog.textContent = L.hideLog;
        logWrap.dataset.forceHidden = '0';
      } else {
        logWrap.style.display = 'none';
        btnToggleLog.textContent = L.showLog;
        logWrap.dataset.forceHidden = '1';
      }
    };

    return { overlay, modal, title, body, progressWrap, progressBar, progressInner, sub, logWrap, log, btnCancel, btnOk, btnStop, btnToggleLog };
  }
  var panel = document.createElement('div');
  panel.id = 'trailers-panel';
  panel.className = 'settings-panel';

  var section = createSection(L.trailersHeader);
  panel.appendChild(section);

  var isAdminUser = false;
  var trailerDownloaderCheckbox = createCheckbox('EnableTrailerDownloader', L.enableTrailerDownloader, config.EnableTrailerDownloader === true);
  var trailerUrlNfoCheckbox     = createCheckbox('EnableTrailerUrlNfo',     L.enableTrailerUrlNfo,     config.EnableTrailerUrlNfo === true);

  function getChk(elOrId) {
    if (elOrId instanceof HTMLElement) return elOrId.querySelector('input[type="checkbox"]');
    var byId = document.getElementById(elOrId);
    if (byId && byId.tagName === 'INPUT') return byId;
    var wrap = byId || document.querySelector("#" + (CSS.escape(elOrId)));
    return wrap.querySelector.('input[type="checkbox"]') || null;
  }
  function exclusifyRefs(aInput, bInput) {
    if (!aInput || !bInput) return;
    var tie = function(src, dst) src.addEventListenerfunction('change', () { if (src.checked) dst.checked = false; });
    tie(aInput, bInput); tie(bInput, aInput);
  }

  section.appendChild(trailerDownloaderCheckbox);
  section.appendChild(trailerUrlNfoCheckbox);
  exclusifyRefs(getChk(trailerDownloaderCheckbox), getChk(trailerUrlNfoCheckbox));

  var nonAdminInfo = document.createElement('div');
  nonAdminInfo.className = 'admin-info-message';
  nonAdminInfo.style.display = 'none';
  nonAdminInfo.style.color = '#ff6b6b';
  nonAdminInfo.style.margin = '10px 0';
  nonAdminInfo.style.fontStyle = 'italic';
  nonAdminInfo.textContent = L.settingsReadOnly;
  section.appendChild(nonAdminInfo);

  var adminOnlyWrap = document.createElement('div');
  adminOnlyWrap.id = 'trailers-admin-fields';
  adminOnlyWrap.style.display = 'none';
  section.appendChild(adminOnlyWrap);

  var modal = createModal();
  var pollTimer = null;
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPolling() { stopPolling(); pollTimer = setIntervalfunction(() pollStatus(), 2000); }

  function connectIfRunning({ forceOpen = false } = {}) {
    try {
      var headers = getAuthHeaders();
      var res = fetch('/NexusPobreFlix/trailers/status', { method: 'GET', headers });
      var data = res.json().catchfunction(() ({}));
      if (data && data.ok === true && data.running) {
        if (forceOpen || modal.overlay.style.display === 'none') openProgressUi();
        updateProgressUi(data);
        startPolling();
        return true;
      }
    } catch {}
    return false;
  }

  function pollStatus() {
    try {
      var headers = getAuthHeaders();
      var res = fetch('/NexusPobreFlix/trailers/status', { method: 'GET', headers });
      var data = res.json().catchfunction(() ({}));
      if (!data || data.ok !== true) return;

      if (data.running) {
        setJobFlag(true);
        updateProgressUi(data);
      } else {
        updateProgressUi(data);
        setJobFlag(false);
        stopPolling();
      }
    } catch {}
  }

  function openConfirmUi() {
    modal.title.textContent = L.confirmTitle;
    modal.body.textContent = L.confirmBody;
    modal.sub.textContent = '';
    modal.progressWrap.style.display = 'none';
    modal.logWrap.style.display = 'none';
    modal.btnToggleLog.style.display = 'none';
    modal.btnOk.textContent = L.confirmOk;
    modal.btnOk.style.display = '';
    modal.btnStop.style.display = 'none';
    modal.btnCancel.textContent = L.confirmCancel;
    modal.overlay.style.display = 'flex';
  }
  function openProgressUi() {
    modal.title.textContent = L.progressTitle;
    modal.body.textContent = '';
    modal.progressWrap.style.display = '';
    if (modal.logWrap.dataset.forceHidden !== '1') {
      modal.logWrap.style.display = '';
    }
    modal.btnOk.style.display = 'none';
    modal.btnStop.style.display = '';
    modal.btnCancel.textContent = L.close;
    modal.btnToggleLog.style.display = '';
    modal.btnToggleLog.textContent = (modal.logWrap.style.display === 'none') ? L.showLog : L.hideLog;
    modal.overlay.style.display = 'flex';
  }

  function toPct(x, fallbackRatio = null) {
    var n = null;
    if (typeof x === 'number') n = x;
    else if (typeof x === 'string') {
      var f = parseFloat(x.replace('%','').trim());
      if (Number.isFinite(f)) n = f;
    }
    if (n == null && typeof fallbackRatio === 'number' && Number.isFinite(fallbackRatio)) {
      n = fallbackRatio * 100;
    }
    if (n == null) return null;
    return Math.max(0, Math.min(100, n));
  }

  function parseDownloaderSummary(stdout) {
    var total=0, success=0, fail=0;
    try {
      var mTotal = matchFirst(stdout, [
        /BİTTİ:\s*işlenen\s*=\s*(\d+)/i,
        new RegExp(L.rxFinishedProcessed, 'i'),
      ]);
      if (mTotal) total = parseIntSafe(mTotal[1]);
      var mLine  = matchFirst(stdout, [
        /ÖZET\s*->\s*indirilen\s*=\s*(\d+)\s*,\s*başarısız\s*=\s*(\d+)/i,
        new RegExp(L.rxSummaryOkFail, 'i'),
      ]);
      if (mLine) { success = parseIntSafe(mLine[1]); fail = parseIntSafe(mLine[2]); }
    } catch {}
    return { success, failed: fail, total };
  }

  function parseUrlNfoSummary(stdout) {
    var pick = function(...labels) {
      var patterns = labels
        .filter(Boolean)
        .mapfunction((label) new RegExp((escapeRegExp(label)) + "\\\\s*:\\\\s*(\\\\d+)", 'i'));
      var m = matchFirst(stdout, patterns);
      return m ? parseIntSafe(m[1]) : 0;
    };
    var total = pick(L.urlNfoTotal, 'Toplam işlenen öğe');
    var ok = pick(L.urlNfoOk, 'Başarılı (NFO eklendi)');
    var notFound = pick(L.urlNfoNotFound, 'Trailer bulunamadı');
    var failWrite = pick(L.urlNfoFailWrite, 'NFO yazma hatası');
    var failRefresh = pick(L.urlNfoFailRefresh, 'Refresh hatası');
    var noTmdb = pick(L.urlNfoNoTmdb, 'TMDb ID yok');
    var noPath = pick(L.urlNfoNoPath, 'Yol (Path) yok');
    var unsupported = pick(L.urlNfoUnsupported, 'Desteklenmeyen tür');
    var misc = pick(L.urlNfoMisc, 'Diğer/çeşitli');
    var failed = notFound + failWrite + failRefresh + noTmdb + noPath + unsupported + misc;
    return { success: ok, failed, total };
  }

  function updateProgressUi(status) {
    var pct = toPct(status.progressPercent || status.progress, status.progress01);
    modal.progressInner.style.width = (pct == null ? (status.running ? 5 : 100) : pct) + '%';
    modal.body.textContent = buildProgressBody(status, L);

    var stepTxt = status.currentStep || '';
    var stepLabel = translateTrailerStepName(stepTxt, L);
    var lastMessage = translateTrailersLastMessage(status, L);
    if (lastMessage) {
      modal.sub.textContent = pct != null ? (lastMessage) + " (" + (pct.toFixed(1)) + "%)" : lastMessage;
    } else {
      modal.sub.textContent = stepLabel
        ? (L.adim) + ": " + (stepLabel) + "${pct != null ? " (${pct.toFixed(1)}%)" : ''}"
        : (status.running ? L.running : L.done);
    }

    if (Array.isArray(status.log)) {
      if (modal.logWrap.dataset.forceHidden !== '1') {
        modal.logWrap.style.display = '';
        modal.btnToggleLog.textContent = L.hideLog;
      }
      var raw = status.log.join('\n');
      modal.log.textContent = translateLogBlock(raw, L);
      modal.log.scrollTop = modal.log.scrollHeight;
    }

    if (!status.running) {
      modal.btnStop.style.display = 'none';
      modal.btnCancel.textContent = L.close;

      if (Array.isArray(status.results) && status.results.length > 0) {
        var lines = [];
        for (var r of status.results) {
          var name = (r.script || '').toString();
          var stdout = (r.stdout || '').toString();
          if (/trailers\.sh/i.test(name) || new RegExp(L.rxFinishedProcessed, 'i').test(stdout)) {
            var s = parseDownloaderSummary(stdout);
            lines.push((L.summaryDownloaderTitle) + ": " + (L.summarySuccess) + ": " + (s.success) + ", " + (L.summaryFailed) + ": " + (s.failed) + "${s.total?", ${L.summaryTotal}: ${s.total}":''}");
          } else if (/trailersurl\.sh/i.test(name) || /===== ÖZET =====/i.test(stdout)) {
            var s = parseUrlNfoSummary(stdout);
            lines.push((L.summaryUrlNfoTitle) + ": " + (L.summarySuccess) + ": " + (s.success) + ", " + (L.summaryFailed) + ": " + (s.failed) + "${s.total?", ${L.summaryTotal}: ${s.total}":''}");
          }
        }
        if (lines.length) {
          if (modal.logWrap.dataset.forceHidden !== '1') {
            modal.logWrap.style.display = '';
            modal.btnToggleLog.textContent = L.hideLog;
          }
          var extra = translateLogBlock(lines.join('\n'), L);
          modal.log.textContent += (modal.log.textContent ? '\n' : '') + extra;
          modal.log.scrollTop = modal.log.scrollHeight;
        }
      }
      stopPolling();
      setJobFlag(false);
    }
  }

  modal.btnCancel.onclick = function() { modal.overlay.style.display = 'none'; };

  modal.btnOk.onclick = function() {
    modal.btnOk.disabled = true;
    try {
      var already = connectIfRunning({ forceOpen: true });
      if (already) { showNotification(L.alreadyRunning, 2200, 'warning'); return; }

      var body = collectRunBody();
      if (!body.runDownloader && !body.runUrlNfo) {
        showNotification(L.atLeastOneOption, 2500, 'warning');
        modal.overlay.style.display = 'none';
        return;
      }
      openProgressUi();
      updateProgressUi({ running: true, progress: 5, currentStep: L.preparing });

      var headers = getAuthHeaders();
      var res = fetch('/NexusPobreFlix/trailers/run', { method: 'POST', headers, body: JSON.stringify(body) });
      var txt = res.text();
      var data = {}; try { data = JSON.parse(txt); } catch {}

      startPolling();
      setJobFlag(true);

      if (res.status === 409) {
        showNotification(L.alreadyRunning, 2500, 'warning');
        pollStatus();
        return;
      }
      if (!res.ok && res.status !== 202) {
        throw new Error(translateTrailersApiErrorText(data, L, res.status, txt));
      }
    } catch (err) {
      showNotification(L.runError + ' ' + (err.message || err), 3200, 'error');
      modal.overlay.style.display = 'none';
    } finally {
      modal.btnOk.disabled = false;
    }
  };

  modal.btnStop.onclick = function() {
    modal.btnStop.disabled = true;
    modal.btnStop.textContent = L.stopping;
    try {
      var headers = getAuthHeaders();
      fetch('/NexusPobreFlix/trailers/cancel', { method: 'POST', headers });
      startPolling();
      setTimeoutfunction(() pollStatus(), 300);
    } catch {}
    finally {
      setTimeoutfunction(() {
        modal.btnStop.disabled = false;
        modal.btnStop.textContent = L.stopButton;
      }, 800);
    }
  };

  var out = null;
  var trailerConfig = normalizeTrailerConfigEnvelope(config);

  function setTrailerConfig(nextConfig) {
    trailerConfig = normalizeTrailerConfigEnvelope(nextConfig);
    return trailerConfig;
  }

  function setCheckboxValue(id, value) {
    var input = document.getElementById(id);
    if (input) input.checked = !!value;
  }

  function setTextValue(id, value) {
    var input = document.getElementById(id);
    if (input && value != null) input.value = value;
  }

  function setTopLevelReadOnly(readOnly) {
    var a = document.getElementById('EnableTrailerDownloader');
    var b = document.getElementById('EnableTrailerUrlNfo');
    [a, b].forEach(function((input) {
      if (!input) return;
      input.disabled = !!readOnly;
      input.title = readOnly ? L.settingsReadOnly : '';
    });
  }

  function applyTopLevelConfig(source) {
    setCheckboxValue('EnableTrailerDownloader', coerceBoolean(pickConfigValue(source, 'enableTrailerDownloader', 'EnableTrailerDownloader')));
    setCheckboxValue('EnableTrailerUrlNfo', coerceBoolean(pickConfigValue(source, 'enableTrailerUrlNfo', 'EnableTrailerUrlNfo')));
  }

  function applyResolutionInputs(bounds) {
    var minSel = document.getElementById('TrailerMinResolution');
    var maxSel = document.getElementById('TrailerMaxResolution');
    if (minSel) minSel.value = String(bounds.min);
    if (maxSel) maxSel.value = String(bounds.max);
  }

  function getSelectedResolutionBounds() {
    var minSel = document.getElementById('TrailerMinResolution');
    var maxSel = document.getElementById('TrailerMaxResolution');

    if (!minSel || !maxSel) {
      return getResolutionBounds(trailerConfig);
    }

    return getResolutionBounds({
      trailerMinResolution: minSel.value,
      trailerMaxResolution: maxSel.value
    });
  }

  function createSelectWrap(id, label, options, selectedValue) {
    var wrap = document.createElement('div');
    wrap.className = 'input-container';

    var labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.htmlFor = id;

    var select = document.createElement('select');
    select.id = id;
    select.name = id;

    options.forEach(function((option) {
      var opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      if (String(option.value) === String(selectedValue)) opt.selected = true;
      select.appendChild(opt);
    });

    wrap.append(labelEl, select);
    return wrap;
  }

  function createNumberInputWrap(id, label, value, { min = MIN_CONCURRENT_DOWNLOADS, max = MAX_CONCURRENT_DOWNLOADS } = {}) {
    var wrap = document.createElement('div');
    wrap.className = 'input-container';

    var labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.htmlFor = id;

    var input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.name = id;
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(normalizeConcurrentDownloads(value));
    input.addEventListenerfunction('change', () {
      input.value = String(normalizeConcurrentDownloads(input.value));
    });

    wrap.append(labelEl, input);
    return wrap;
  }

  function wireResolutionBounds() {
    var minSel = document.getElementById('TrailerMinResolution');
    var maxSel = document.getElementById('TrailerMaxResolution');
    if (!minSel || !maxSel) return;

    minSel.addEventListenerfunction('change', () {
      if (Number(minSel.value) > Number(maxSel.value)) {
        maxSel.value = minSel.value;
      }
    });

    maxSel.addEventListenerfunction('change', () {
      if (Number(maxSel.value) < Number(minSel.value)) {
        minSel.value = maxSel.value;
      }
    });
  }

  function loadLatestTrailerConfig() {
    var headers = getAuthHeaders();
    var res = fetch('/NexusPobreFlix/config', { method: 'GET', headers });
    if (!res.ok) throw new Error("HTTP " + (res.status));

    var latestPayload = res.json();
    var latestConfig = setTrailerConfig(latestPayload);
    applyTopLevelConfig(latestConfig);
    return latestConfig;
  }

  function attachAdminFields() {
    out = document.createElement('pre');
    out.className = 'script-output';
    out.style.cssText = 'white-space:pre-wrap; max-height:280px; overflow:auto; margin-top:8px;';

    var getAutoJfBase = function() resolveAutoJfBase(trailerConfig);
    var syncJfBaseInput = function(fallbackValue = '') {
      var input = document.getElementById('JFBase');
      if (!input) return '';

      var resolved = getAutoJfBase() || normalizeBaseUrl(fallbackValue);
      if (!resolved) return '';

      if (input.value !== resolved) input.value = resolved;
      input.readOnly = true;
      input.title = L.jfBaseAutoNote;
      return resolved;
    };

    function renderAdminFields() {
      var currentConfig = trailerConfig;
      var resolutionBounds = getResolutionBounds(currentConfig);
      var themeLinkEnabled = Number(pickConfigValue(currentConfig, 'enableThemeLink', 'EnableThemeLink') || 0) === 1;
      var themeLinkMode = pickConfigValue(currentConfig, 'themeLinkMode', 'ThemeLinkMode') || 'symlink';

      adminOnlyWrap.appendChild(createTextInput('JFBase', L.jfBase, getAutoJfBase() || normalizeBaseUrl(pickConfigValue(currentConfig, 'jfBase', 'JFBase')) || ''));
      syncJfBaseInput(pickConfigValue(currentConfig, 'jfBase', 'JFBase'));

      var jfBaseAutoNote = document.createElement('div');
      jfBaseAutoNote.className = 'description-text';
      jfBaseAutoNote.textContent = L.jfBaseAutoNote;
      adminOnlyWrap.appendChild(jfBaseAutoNote);

      adminOnlyWrap.appendChild(createTextInput('PreferredLang', L.preferredLang, pickConfigValue(currentConfig, 'preferredLang', 'PreferredLang') || 'pt-BR'));
      adminOnlyWrap.appendChild(createTextInput('FallbackLang', L.fallbackLang, pickConfigValue(currentConfig, 'fallbackLang', 'FallbackLang') || 'en-US'));
      adminOnlyWrap.appendChild(createNumberInputWrap(
        'MaxConcurrentDownloads',
        L.maxConcurrentDownloads,
        pickConfigValue(currentConfig, 'maxConcurrentDownloads', 'MaxConcurrentDownloads') || DEFAULT_MAX_CONCURRENT_DOWNLOADS
      ));

      var maxConcurrentDownloadsHint = document.createElement('div');
      maxConcurrentDownloadsHint.className = 'description-text';
      maxConcurrentDownloadsHint.textContent = L.maxConcurrentDownloadsHint;
      adminOnlyWrap.appendChild(maxConcurrentDownloadsHint);

      adminOnlyWrap.appendChildfunction(createSelectWrap(
        'TrailerMinResolution',
        L.trailerMinResolution,
        TRAILER_RESOLUTION_OPTIONS.map((value) ({ value, label: (value) + "p" })),
        resolutionBounds.min
      ));
      adminOnlyWrap.appendChildfunction(createSelectWrap(
        'TrailerMaxResolution',
        L.trailerMaxResolution,
        TRAILER_RESOLUTION_OPTIONS.map((value) ({ value, label: (value) + "p" })),
        resolutionBounds.max
      ));
      wireResolutionBounds();

      var resolutionHint = document.createElement('div');
      resolutionHint.className = 'description-text';
      resolutionHint.textContent = L.trailerResolutionHint;
      adminOnlyWrap.appendChild(resolutionHint);

      var tmdbNote = document.createElement('div');
      tmdbNote.className = 'description-text';
      tmdbNote.textContent = (L.tmdbApiKey) + ": " + ((labels.tmdbManagedInSlider || 'Gerenciado em um único campo na aba Slider e aqui utiliza a configuração global.'));
      adminOnlyWrap.appendChild(tmdbNote);

      var overwriteWrap = document.createElement('div');
      overwriteWrap.className = 'input-container';
      {
        var l = document.createElement('label');
        l.textContent = L.overwritePolicy;
        l.htmlFor = 'OverwritePolicy';
        var sel = document.createElement('select');
        sel.id = 'OverwritePolicy';
        [
          { value: 'skip', label: L.overwriteSkip },
          { value: 'replace', label: L.overwriteReplace },
          { value: 'if-better', label: L.overwriteIfBetter }
        ].forEach(function((opt) {
          var o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          sel.appendChild(o);
        });
        sel.value = mapEnumToWire(pickConfigValue(currentConfig, 'overwritePolicy', 'OverwritePolicy') || 'Skip');
        overwriteWrap.append(l, sel);
      }
      adminOnlyWrap.appendChild(overwriteWrap);

      adminOnlyWrap.appendChild(createCheckbox('EnableThemeLink', L.enableThemeLink, themeLinkEnabled));
      setCheckboxValue('EnableThemeLink', themeLinkEnabled);

      var modeWrap = document.createElement('div');
      modeWrap.className = 'input-container';
      {
        var l = document.createElement('label');
        l.textContent = L.themeLinkMode;
        l.htmlFor = 'ThemeLinkMode';
        var sel = document.createElement('select');
        sel.id = 'ThemeLinkMode';
        [
          { value: 'symlink', label: L.modeSymlink },
          { value: 'hardlink', label: L.modeHardlink },
          { value: 'copy', label: L.modeCopy }
        ].forEach(function((opt) {
          var o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          sel.appendChild(o);
        });
        sel.value = themeLinkMode;
        modeWrap.append(l, sel);
      }
      adminOnlyWrap.appendChild(modeWrap);

      applyTopLevelConfig(currentConfig);
      applyResolutionInputs(resolutionBounds);

      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap;';

      var saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = L.saveSettings;
      saveBtn.style.cssText = primaryBtnCss();

      var runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.textContent = L.runNow;
      runBtn.style.cssText = baseBtnCss();

      btnRow.append(saveBtn, runBtn);
      adminOnlyWrap.append(btnRow, out);

      saveBtn.onclick = function() {
        var oldText = saveBtn.textContent;
        saveBtn.disabled = true;
        saveBtn.textContent = L.saving;
        try {
          var a = getChk(trailerDownloaderCheckbox);
          var b = getChk(trailerUrlNfoCheckbox);
          if (a && b && a.checked && b.checked) b.checked = false;

          var payload = {};
          var pushIf = function(k, v) { if (v !== undefined && v !== null && v !== '') payload[k] = v; };
          var selectedBounds = getSelectedResolutionBounds();
          var fallbackJfBase = pickConfigValue(trailerConfig, 'jfBase', 'JFBase');

          pushIf('AllowScriptExecution', true);
          if (a) pushIf('EnableTrailerDownloader', !!a.checked);
          if (b) pushIf('EnableTrailerUrlNfo', !!b.checked);

          pushIf('JFBase', syncJfBaseInput(fallbackJfBase) || getAutoJfBase());
          pushIf('PreferredLang', document.getElementById('PreferredLang').value.trim());
          pushIf('FallbackLang', document.getElementById('FallbackLang').value.trim());
          pushIf('MaxConcurrentDownloads', normalizeConcurrentDownloads(document.getElementById('MaxConcurrentDownloads').value));
          pushIf('TrailerMinResolution', selectedBounds.min);
          pushIf('TrailerMaxResolution', selectedBounds.max);

          var opWire = document.getElementById('OverwritePolicy').value || 'skip';
          pushIf('OverwritePolicy', opWire);
          pushIf('EnableThemeLink', document.getElementById('EnableThemeLink').checked ? 1 : 0);
          pushIf('ThemeLinkMode', document.getElementById('ThemeLinkMode').value || 'symlink');

          var headers = getAuthHeaders();
          var res = fetch('/NexusPobreFlix/config', { method: 'POST', headers, body: JSON.stringify(payload) });
          var txt = res.text();
          var data = {};
          try { data = JSON.parse(txt); } catch {}
          if (!res.ok) throw new Error(data.error || data.Message || "HTTP " + (res.status) + ": " + (txt));

          var savedConfig = setTrailerConfig(data);
          applyTopLevelConfig(savedConfig);
          applyResolutionInputs(getResolutionBounds(savedConfig));
          setCheckboxValue('EnableThemeLink', Number(pickConfigValue(savedConfig, 'enableThemeLink', 'EnableThemeLink') || 0) === 1);
          setTextValue('PreferredLang', pickConfigValue(savedConfig, 'preferredLang', 'PreferredLang'));
          setTextValue('FallbackLang', pickConfigValue(savedConfig, 'fallbackLang', 'FallbackLang'));
          setTextValue('MaxConcurrentDownloads', normalizeConcurrentDownloads(pickConfigValue(savedConfig, 'maxConcurrentDownloads', 'MaxConcurrentDownloads')));
          syncJfBaseInput(pickConfigValue(savedConfig, 'jfBase', 'JFBase'));

          var overwriteSel = document.getElementById('OverwritePolicy');
          if (overwriteSel) {
            overwriteSel.value = mapEnumToWire(pickConfigValue(savedConfig, 'overwritePolicy', 'OverwritePolicy') || opWire);
          }

          var themeModeSel = document.getElementById('ThemeLinkMode');
          if (themeModeSel) {
            themeModeSel.value = pickConfigValue(savedConfig, 'themeLinkMode', 'ThemeLinkMode') || 'symlink';
          }

          showNotification(L.settingsSaved, 2500, 'success');
        } catch (e) {
          showNotification(L.saveError + (e.message || e), 3000, 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = oldText;
        }
      };

      runBtn.onclick = function() {
        var attached = connectIfRunning({ forceOpen: true });
        if (attached) {
          showNotification(L.alreadyRunning, 2500, 'warning');
          return;
        }

        var body = collectRunBody();
        if (!body.runDownloader && !body.runUrlNfo) {
          showNotification(L.atLeastOneOption, 2500, 'warning');
          return;
        }
        openConfirmUi();
      };

      return out;
    }

    return renderAdminFields();
  }

  function collectRunBody() {
    var currentConfig = trailerConfig;
    var selectedBounds = getSelectedResolutionBounds();
    var autoJfBase = resolveAutoJfBase(currentConfig)
      || document.getElementById('JFBase').value
      || pickConfigValue(currentConfig, 'jfBase', 'JFBase');

    var body = {
      runDownloader: getChk(trailerDownloaderCheckbox).checked || false,
      runUrlNfo: getChk(trailerUrlNfoCheckbox).checked || false,
      jfBase: autoJfBase,
      preferredLang: document.getElementById('PreferredLang').value || pickConfigValue(currentConfig, 'preferredLang', 'PreferredLang') || 'pt-BR',
      fallbackLang: document.getElementById('FallbackLang').value || pickConfigValue(currentConfig, 'fallbackLang', 'FallbackLang') || 'en-US',
      maxConcurrentDownloads: normalizeConcurrentDownloads(
        document.getElementById('MaxConcurrentDownloads').value
          || pickConfigValue(currentConfig, 'maxConcurrentDownloads', 'MaxConcurrentDownloads')
      ),
      trailerMinResolution: selectedBounds.min,
      trailerMaxResolution: selectedBounds.max,
      overwritePolicy: document.getElementById('OverwritePolicy').value || mapEnumToWire(pickConfigValue(currentConfig, 'overwritePolicy', 'OverwritePolicy') || 'Skip'),
      enableThemeLink: document.getElementById('EnableThemeLink').checked
        ? 1
        : (Number(pickConfigValue(currentConfig, 'enableThemeLink', 'EnableThemeLink') || 0) === 1 ? 1 : 0),
      themeLinkMode: document.getElementById('ThemeLinkMode').value || pickConfigValue(currentConfig, 'themeLinkMode', 'ThemeLinkMode') || 'symlink'
    };
    if (body.runDownloader && body.runUrlNfo) body.runUrlNfo = false;
    return body;
  }

  function(() {
    try {
      try {
        loadLatestTrailerConfig();
      } catch {}

      isAdminUser = checkUserIsAdmin();
      if (isAdminUser) {
        setTopLevelReadOnly(false);
        adminOnlyWrap.style.display = '';
        attachAdminFields();
        connectIfRunning({ forceOpen: false });
        if (getJobFlag()) {
          openProgressUi();
          startPolling();
        }
      } else {
        nonAdminInfo.style.display = '';
        setTopLevelReadOnly(true);
      }
    } catch {
      nonAdminInfo.style.display = '';
      setTopLevelReadOnly(true);
    }
  })();

  return panel;
}

const API_BASE = "/Plugins/JMSFusion/ScopedCache";
const STORE_REGISTRY = new Map();
const LEGACY_DB_CLEANUP_STARTED = new Set();
const DEFAULT_STABLE_IGNORE_FIELDS = ["fetchedAt", "expiresAt", "updatedAt"];
const SESSION_MIRROR_PREFIX = "jms:scoped-json-cache:v1:";
const SESSION_MIRROR_MAX_AGE_MS = 15 * 60 * 1000;
let lifecycleFlushBound = false;

function canUseSessionMirror(cacheType) {
  return String(cacheType || "") === "sliderCache";
}

function sessionMirrorKey(cacheType, scope) {
  return `${SESSION_MIRROR_PREFIX}${String(cacheType || "").trim()}::${String(scope || "").trim()}`;
}

function readSessionMirror(cacheType, scope) {
  if (!canUseSessionMirror(cacheType)) return null;

  try {
    const raw = sessionStorage.getItem(sessionMirrorKey(cacheType, scope));
    if (!raw) return null;
    const record = JSON.parse(raw);
    const savedAt = Number(record?.savedAt || 0);
    if (!savedAt || (Date.now() - savedAt) > SESSION_MIRROR_MAX_AGE_MS) return null;
    const payload = record?.payload;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

function writeSessionMirror(cacheType, scope, payload) {
  if (!canUseSessionMirror(cacheType)) return;

  try {
    sessionStorage.setItem(sessionMirrorKey(cacheType, scope), JSON.stringify({
      savedAt: Date.now(),
      payload: payload && typeof payload === "object" ? payload : {}
    }));
  } catch {
    try { sessionStorage.removeItem(sessionMirrorKey(cacheType, scope)); } catch {}
  }
}

function normalizeIgnoreSet(values = []) {
  const set = new Set();
  for (const value of Array.isArray(values) ? values : [values]) {
    const key = String(value || "").trim();
    if (key) set.add(key);
  }
  return set;
}

function stringifyStable(value, {
  ignoreFields = new Set(),
  ignoreTopLevelKeys = new Set(),
  depth = 0
} = {}) {
  if (value === null) return "null";

  const type = typeof value;
  if (type === "string" || type === "boolean") return JSON.stringify(value);
  if (type === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (type === "bigint") return JSON.stringify(String(value));
  if (type === "undefined" || type === "function" || type === "symbol") return undefined;

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringifyStable(entry, {
      ignoreFields,
      ignoreTopLevelKeys,
      depth: depth + 1
    }) ?? "null").join(",")}]`;
  }

  if (type === "object") {
    const parts = [];
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      if (ignoreFields.has(key)) continue;
      if (depth === 0 && ignoreTopLevelKeys.has(key)) continue;

      const encoded = stringifyStable(value[key], {
        ignoreFields,
        ignoreTopLevelKeys,
        depth: depth + 1
      });
      if (encoded === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${encoded}`);
    }
    return `{${parts.join(",")}}`;
  }

  return JSON.stringify(String(value));
}

function deepClone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value && typeof value === "object"
      ? (Array.isArray(value) ? value.slice() : { ...value })
      : value;
  }
}

function buildDefaultData(defaultData) {
  const base = typeof defaultData === "function" ? defaultData() : defaultData;
  if (!base || typeof base !== "object" || Array.isArray(base)) {
    return {};
  }
  return deepClone(base) || {};
}

function buildUrl(cacheType, scope) {
  return `${API_BASE}/${encodeURIComponent(String(cacheType || "").trim())}/${encodeURIComponent(String(scope || "").trim())}?ts=${Date.now()}`;
}

async function readScopePayload(cacheType, scope) {
  const mirrored = readSessionMirror(cacheType, scope);
  if (mirrored) return mirrored;

  const response = await fetch(buildUrl(cacheType, scope), {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`${cacheType} scope load failed (${response.status})`);
  }

  const payload = await response.json().catch(() => ({}));
  writeSessionMirror(cacheType, scope, payload);
  return payload;
}

async function writeScopePayload(cacheType, scope, payload, { keepalive = false } = {}) {
  const response = await fetch(buildUrl(cacheType, scope), {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    keepalive: keepalive === true,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(raw || `${cacheType} scope save failed (${response.status})`);
  }

  const result = await response.json().catch(() => ({}));
  writeSessionMirror(cacheType, scope, payload || {});
  return result;
}

function scheduleLegacyIndexedDbCleanup(dbNames = []) {
  const names = Array.isArray(dbNames) ? dbNames : [dbNames];

  for (const rawName of names) {
    const dbName = String(rawName || "").trim();
    if (!dbName || LEGACY_DB_CLEANUP_STARTED.has(dbName)) continue;

    LEGACY_DB_CLEANUP_STARTED.add(dbName);

    try {
      window.dispatchEvent(new CustomEvent("jms:indexeddb:release", {
        detail: { dbName }
      }));
    } catch {}

    setTimeout(() => {
      try {
        const idb = globalThis.indexedDB;
        if (!idb || typeof idb.deleteDatabase !== "function") return;
        const req = idb.deleteDatabase(dbName);
        req.onerror = () => {};
        req.onblocked = () => {};
      } catch {}
    }, 80);
  }
}

function bindLifecycleFlush() {
  if (lifecycleFlushBound) return;
  lifecycleFlushBound = true;

  const flush = () => {
    for (const db of STORE_REGISTRY.values()) {
      try { void db.flushAll({ keepalive: true }); } catch {}
    }
  };

  window.addEventListener("pagehide", flush, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  }, { passive: true });
}

function normalizeLoadedData(payload, defaultData) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return buildDefaultData(defaultData);
  }
  return payload;
}

async function ensureRecord(state, scope) {
  const cleanScope = String(scope || "").trim();
  if (!cleanScope) throw new Error("Scope is required.");

  let record = state.records.get(cleanScope);
  if (!record) {
    const defaultPayload = buildDefaultData(state.defaultData);
    record = {
      scope: cleanScope,
      data: defaultPayload,
      dirty: false,
      lastPersistedStableJson: stringifyStable(defaultPayload, state.stableOptions),
      loadPromise: null,
      savePromise: null,
      saveTimer: null
    };

    record.loadPromise = (async () => {
      try {
        const loaded = await readScopePayload(state.cacheType, cleanScope);
        record.data = normalizeLoadedData(loaded, state.defaultData);
        record.lastPersistedStableJson = stringifyStable(record.data, state.stableOptions);
      } catch (error) {
        console.warn(`[JMSFusion] ${state.cacheType} scope load failed:`, error);
        record.data = buildDefaultData(state.defaultData);
        record.lastPersistedStableJson = stringifyStable(record.data, state.stableOptions);
      } finally {
        record.loadPromise = null;
      }
      return record;
    })();

    state.records.set(cleanScope, record);
  }

  if (record.loadPromise) {
    await record.loadPromise;
  }

  return record;
}

function scheduleFlush(state, scope, record, delayMs = state.saveDelayMs) {
  if (record.saveTimer) return record.saveTimer;

  record.saveTimer = setTimeout(() => {
    record.saveTimer = null;
    void flushRecord(state, scope, record);
  }, Math.max(0, Number(delayMs) || state.saveDelayMs));

  return record.saveTimer;
}

async function flushRecord(state, scope, record, options = {}) {
  if (record.saveTimer) {
    clearTimeout(record.saveTimer);
    record.saveTimer = null;
  }

  if (record.savePromise) {
    return record.savePromise;
  }

  if (!record.dirty) {
    return null;
  }

  const stableSnapshot = stringifyStable(record.data, state.stableOptions);
  if (stableSnapshot === record.lastPersistedStableJson) {
    record.dirty = false;
    return null;
  }

  record.dirty = false;
  const snapshot = deepClone(record.data) || {};

  record.savePromise = writeScopePayload(state.cacheType, scope, snapshot, options)
    .then((result) => {
      record.lastPersistedStableJson = stableSnapshot;
      return result;
    })
    .catch((error) => {
      record.dirty = true;
      console.warn(`[JMSFusion] ${state.cacheType} scope save failed:`, error);
      return null;
    })
    .finally(() => {
      record.savePromise = null;
      if (record.dirty && !record.saveTimer) {
        scheduleFlush(state, scope, record, state.retryDelayMs);
      }
    });

  return record.savePromise;
}

export function prepareLegacyIndexedDbForDeletion(dbNames = []) {
  scheduleLegacyIndexedDbCleanup(dbNames);
  return Promise.resolve(true);
}

export function createScopedJsonDb({
  cacheType,
  defaultData = () => ({}),
  saveDelayMs = 700,
  retryDelayMs = 2000,
  legacyDbNames = [],
  stableIgnoreFields = DEFAULT_STABLE_IGNORE_FIELDS,
  stableIgnoreTopLevelKeys = []
} = {}) {
  const normalizedType = String(cacheType || "").trim();
  if (!normalizedType) {
    throw new Error("cacheType is required.");
  }

  const existing = STORE_REGISTRY.get(normalizedType);
  if (existing) {
    scheduleLegacyIndexedDbCleanup(legacyDbNames);
    return existing;
  }

  const state = {
    cacheType: normalizedType,
    defaultData,
    saveDelayMs: Math.max(0, Number(saveDelayMs) || 700),
    retryDelayMs: Math.max(250, Number(retryDelayMs) || 2000),
    stableOptions: {
      ignoreFields: normalizeIgnoreSet(stableIgnoreFields),
      ignoreTopLevelKeys: normalizeIgnoreSet(stableIgnoreTopLevelKeys)
    },
    records: new Map()
  };

  const db = {
    __jmsCacheType: normalizedType,
    __jmsActiveScope: "",
    async close() {
      await this.flushAll();
      for (const record of state.records.values()) {
        if (record?.saveTimer) {
          clearTimeout(record.saveTimer);
          record.saveTimer = null;
        }
      }
      state.records.clear();
      if (STORE_REGISTRY.get(normalizedType) === db) {
        STORE_REGISTRY.delete(normalizedType);
      }
    },
    async readScope(scope, reader) {
      const record = await ensureRecord(state, scope);
      this.__jmsActiveScope = record.scope;
      return reader(record.data, record);
    },
    async writeScope(scope, writer, { flush = false, delayMs = null } = {}) {
      const record = await ensureRecord(state, scope);
      this.__jmsActiveScope = record.scope;
      const result = await writer(record.data, record);
      record.dirty = true;
      if (flush) {
        await flushRecord(state, record.scope, record);
      } else {
        scheduleFlush(state, record.scope, record, delayMs ?? state.saveDelayMs);
      }
      return result;
    },
    async flush(scope, options = {}) {
      const record = await ensureRecord(state, scope || this.__jmsActiveScope);
      this.__jmsActiveScope = record.scope;
      return flushRecord(state, record.scope, record, options);
    },
    async flushAll(options = {}) {
      const tasks = [];
      for (const [scope, record] of state.records.entries()) {
        if (!record?.dirty && !record?.savePromise) continue;
        tasks.push(flushRecord(state, scope, record, options));
      }
      await Promise.all(tasks);
    }
  };

  STORE_REGISTRY.set(normalizedType, db);
  scheduleLegacyIndexedDbCleanup(legacyDbNames);
  bindLifecycleFlush();
  return db;
}

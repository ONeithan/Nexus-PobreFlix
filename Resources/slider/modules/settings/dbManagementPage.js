import { createSection } from "./shared.js";
import { showNotification } from "../player/ui/notification.js";

const RELEASE_WAIT_MS = 120;
const DELETE_TIMEOUT_MS = 5000;
const PROBE_DELETE_TIMEOUT_MS = 2500;
const BACKUP_FORMAT = "jms-indexeddb-backup";
const BACKUP_FILE_VERSION = 1;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function setStatus(node, message) {
  node.textContent = message || "";
  node.style.display = message ? "block" : "none";
}

function formatLabel(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => {
    const value = values[key];
    return value == null ? "" : String(value);
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("A requisição do IndexedDB falhou."));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => reject(tx.error || new Error("A operação do IndexedDB foi cancelada."));
    tx.onerror = () => reject(tx.error || new Error("A operação do IndexedDB falhou."));
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event?.target?.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Não foi possível ler o arquivo."));
    reader.readAsText(file);
  });
}

function countBackupRecords(backup) {
  return (backup?.stores || []).reduce((total, store) => {
    return total + (Array.isArray(store?.records) ? store.records.length : 0);
  }, 0);
}

function sanitizeFileNamePart(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "database";
}

function buildBackupFileName(entry, exportedAt) {
  const timestamp = String(exportedAt || new Date().toISOString())
    .replace(/\.\d+Z$/, "Z")
    .replace(/:/g, "-");

  return `${sanitizeFileNamePart(entry?.dbName || entry?.key)}-backup-${timestamp}.json`;
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    try {
      document.body.removeChild(anchor);
    } catch {}
    URL.revokeObjectURL(url);
  }, 100);
}

function deleteIndexedDatabase(dbName, { timeoutMs = DELETE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!dbName) {
      reject(new Error("Nome do banco de dados a ser excluído não encontrado."));
      return;
    }

    if (typeof indexedDB === "undefined") {
      reject(new Error("Este navegador não suporta IndexedDB."));
      return;
    }

    let blocked = false;
    let settled = false;
    let timer = 0;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      callback();
    };

    try {
      const req = indexedDB.deleteDatabase(dbName);

      req.onblocked = () => {
        blocked = true;
      };

      req.onerror = () => {
        finish(() => {
          reject(req.error || new Error(`Não foi possível excluir ${dbName}.`));
        });
      };

      req.onsuccess = () => {
        finish(() => resolve({ blocked }));
      };

      timer = setTimeout(() => {
        finish(() => {
          reject(new Error(
              ? "O banco de dados está sendo usado por outra aba ou conexão aberta. Recarregue a página e tente novamente."
              : "A exclusão do banco de dados expirou."
          ));
        });
      }, Math.max(1500, Number(timeoutMs) || DELETE_TIMEOUT_MS));
    } catch (error) {
      reject(error);
    }
  });
}

async function openExistingIndexedDatabase(dbName) {
  if (!dbName) {
    throw new Error("Nome do banco de dados não encontrado.");
  }

  if (typeof indexedDB === "undefined") {
    throw new Error("Este navegador não suporta IndexedDB.");
  }

  if (typeof indexedDB.databases === "function") {
    try {
      const list = await indexedDB.databases();
      if (Array.isArray(list) && !list.some((entry) => entry?.name === dbName)) {
        return null;
      }
    } catch {}
  }

  return new Promise((resolve, reject) => {
    let createdDuringProbe = false;

    try {
      const req = indexedDB.open(dbName);

      req.onupgradeneeded = () => {
        createdDuringProbe = true;
      };

      req.onerror = () => {
        reject(req.error || new Error(`Não foi possível abrir ${dbName}.`));
      };

      req.onsuccess = async () => {
        const db = req.result;
        const storeCount = Number(db?.objectStoreNames?.length || 0);

        if (createdDuringProbe && storeCount === 0) {
          try {
            db.close();
          } catch {}

          try {
            await deleteIndexedDatabase(dbName, { timeoutMs: PROBE_DELETE_TIMEOUT_MS });
          } catch {}

          resolve(null);
          return;
        }

        resolve(db);
      };
    } catch (error) {
      reject(error);
    }
  });
}

async function exportIndexedDatabase(dbName) {
  const db = await openExistingIndexedDatabase(dbName);
  if (!db) return null;

  try {
    const storeNames = Array.from(db.objectStoreNames || []);
    if (!storeNames.length) return null;

    const stores = [];

    for (const storeName of storeNames) {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const indexes = Array.from(store.indexNames || []).map((indexName) => {
        const index = store.index(indexName);
        return {
          name: index.name,
          keyPath: index.keyPath ?? null,
          unique: index.unique === true,
          multiEntry: index.multiEntry === true
        };
      });
      const records = await requestToPromise(store.getAll());
      await transactionDone(tx);

      stores.push({
        name: store.name,
        keyPath: store.keyPath ?? null,
        autoIncrement: store.autoIncrement === true,
        indexes,
        records: Array.isArray(records) ? records : []
      });
    }

    return {
      format: BACKUP_FORMAT,
      backupVersion: BACKUP_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      dbName: db.name || dbName,
      dbVersion: Math.max(1, Number(db.version) || 1),
      stores,
      metadata: {
        totalStores: stores.length,
        totalRecords: stores.reduce((total, store) => total + store.records.length, 0)
      }
    };
  } finally {
    try {
      db.close();
    } catch {}
  }
}

function normalizeStoreDefinition(rawStore) {
  const name = String(rawStore?.name || "").trim();
  if (!name) return null;

  const seenIndexes = new Set();
  const indexes = Array.isArray(rawStore?.indexes)
    ? rawStore.indexes
        .map((rawIndex) => {
          const indexName = String(rawIndex?.name || "").trim();
          if (!indexName || seenIndexes.has(indexName)) return null;
          seenIndexes.add(indexName);

          return {
            name: indexName,
            keyPath: rawIndex?.keyPath ?? null,
            unique: rawIndex?.unique === true,
            multiEntry: rawIndex?.multiEntry === true
          };
        })
        .filter(Boolean)
    : [];

  return {
    name,
    keyPath: rawStore?.keyPath ?? null,
    autoIncrement: rawStore?.autoIncrement === true,
    indexes,
    records: Array.isArray(rawStore?.records) ? rawStore.records : []
  };
}

function convertLegacyMusicBackup(rawBackup, entry) {
  if (entry?.dbName !== "GMMP-MusicDB") return null;
  if (!rawBackup || !Array.isArray(rawBackup.tracks)) return null;

  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_FILE_VERSION,
    exportedAt: rawBackup?.metadata?.createdAt || new Date().toISOString(),
    dbName: entry.dbName,
    dbVersion: 2,
    sourceFormat: "gmmp-legacy-v1",
    stores: [
      {
        name: "tracks",
        keyPath: "Id",
        autoIncrement: false,
        indexes: [
          { name: "Artists", keyPath: "Artists", unique: false, multiEntry: true },
          { name: "ArtistIds", keyPath: "ArtistIds", unique: false, multiEntry: true },
          { name: "Album", keyPath: "Album", unique: false, multiEntry: false },
          { name: "AlbumArtist", keyPath: "AlbumArtist", unique: false, multiEntry: false },
          { name: "DateCreated", keyPath: "DateCreated", unique: false, multiEntry: false },
          { name: "LastUpdated", keyPath: "LastUpdated", unique: false, multiEntry: false }
        ],
        records: Array.isArray(rawBackup.tracks) ? rawBackup.tracks : []
      },
      {
        name: "deletedTracks",
        keyPath: "id",
        autoIncrement: true,
        indexes: [
          { name: "trackId", keyPath: "trackId", unique: false, multiEntry: false },
          { name: "deletedAt", keyPath: "deletedAt", unique: false, multiEntry: false }
        ],
        records: Array.isArray(rawBackup.deletedTracks) ? rawBackup.deletedTracks : []
      },
      {
        name: "lyrics",
        keyPath: "trackId",
        autoIncrement: false,
        indexes: [],
        records: Array.isArray(rawBackup.lyrics) ? rawBackup.lyrics : []
      }
    ]
  };
}

function normalizeIndexedDatabaseBackup(rawBackup, entry, labels) {
  const genericBackup =
    rawBackup?.format === BACKUP_FORMAT && Array.isArray(rawBackup?.stores)
      ? rawBackup
      : convertLegacyMusicBackup(rawBackup, entry);

  if (!genericBackup) {
    throw new Error(labels?.dbRestoreInvalidFile || labels?.invalidBackupFile || "Arquivo de backup inválido.");
  }

  const dbName = String(genericBackup?.dbName || "").trim();
  if (!dbName) {
    throw new Error(labels?.dbRestoreInvalidFile || labels?.invalidBackupFile || "Arquivo de backup inválido.");
  }

  const seenStores = new Set();
  const stores = (genericBackup.stores || [])
    .map((store) => normalizeStoreDefinition(store))
    .filter((store) => {
      if (!store || seenStores.has(store.name)) return false;
      seenStores.add(store.name);
      return true;
    });

  if (!stores.length) {
    throw new Error(labels?.dbRestoreInvalidFile || labels?.invalidBackupFile || "Arquivo de backup inválido.");
  }

  return {
    format: BACKUP_FORMAT,
    backupVersion: Math.max(1, Number(genericBackup?.backupVersion) || BACKUP_FILE_VERSION),
    exportedAt: genericBackup?.exportedAt || new Date().toISOString(),
    dbName,
    dbVersion: Math.max(1, Number(genericBackup?.dbVersion) || 1),
    stores
  };
}

function createObjectStoreFromDefinition(db, storeDefinition) {
  const options = {};

  if (storeDefinition.keyPath != null) {
    options.keyPath = storeDefinition.keyPath;
  }

  if (storeDefinition.autoIncrement) {
    options.autoIncrement = true;
  }

  return Object.keys(options).length
    ? db.createObjectStore(storeDefinition.name, options)
    : db.createObjectStore(storeDefinition.name);
}

function ensureStoreIndexes(store, storeDefinition) {
  const existingIndexNames = new Set(Array.from(store.indexNames || []));

  for (const indexDefinition of storeDefinition.indexes || []) {
    if (!indexDefinition?.name || existingIndexNames.has(indexDefinition.name)) continue;

    store.createIndex(indexDefinition.name, indexDefinition.keyPath, {
      unique: indexDefinition.unique === true,
      multiEntry: indexDefinition.multiEntry === true
    });
  }
}

async function restoreIndexedDatabaseBackup(backup, { onStatus } = {}) {
  const stores = Array.isArray(backup?.stores) ? backup.stores : [];
  if (!backup?.dbName || !stores.length) {
    throw new Error("Informações de banco de dados válidas para restauração não encontradas.");
  }

  onStatus?.("Criando esquema do banco de dados...");

  const db = await new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(backup.dbName, Math.max(1, Number(backup.dbVersion) || 1));

      req.onupgradeneeded = (event) => {
        const upgradeDb = req.result;
        const upgradeTx = event?.target?.transaction;

        for (const storeDefinition of stores) {
          let store;

          if (upgradeDb.objectStoreNames.contains(storeDefinition.name)) {
            store = upgradeTx?.objectStore(storeDefinition.name);
          } else {
            store = createObjectStoreFromDefinition(upgradeDb, storeDefinition);
          }

          if (store) {
            ensureStoreIndexes(store, storeDefinition);
          }
        }
      };

      req.onblocked = () => {
        reject(new Error("O banco de dados está sendo usado por outra aba ou conexão aberta."));
      };

      req.onerror = () => {
        reject(req.error || new Error(`Não foi possível criar ${backup.dbName}.`));
      };

      req.onsuccess = () => resolve(req.result);
    } catch (error) {
      reject(error);
    }
  });

  try {
    for (let index = 0; index < stores.length; index++) {
      const storeDefinition = stores[index];
      const recordCount = Array.isArray(storeDefinition.records) ? storeDefinition.records.length : 0;

        `Restaurando "${storeDefinition.name}" (${index + 1}/${stores.length}, ${recordCount} registros)`

      const tx = db.transaction(storeDefinition.name, "readwrite");
      const store = tx.objectStore(storeDefinition.name);

      for (const record of storeDefinition.records || []) {
        store.put(record);
      }

      await transactionDone(tx);
    }
  } finally {
    try {
      db.close();
    } catch {}
  }
}

function getDatabaseEntries(labels) {
  return [
    {
      key: "slider-cache",
      dbName: "jms-slider-cache",
      title: labels?.sliderCacheDbTitle || "DB de Cache Geral do Slider",
        "Detalhes de conteúdo do slider, resultados de consultas e registros de cache de API de curto prazo são mantidos aqui.",
      prepare: async () => {
        const mod = await import("../sliderCache.js");
        await mod.prepareSliderCacheDbForDeletion?.();
      }
    },
    {
      key: "recent-rows",
      dbName: "monwui_recent_db",
      title: labels?.recentRowsDbTitle || "DB de Cartões Recentes e Continuar Assistindo",
        "Dados de cache usados para adicionados recentemente, últimos episódios, linhas de música e cartões de continuar assistindo são mantidos aqui.",
      prepare: async () => {
        const mod = await import("../recentRowsDb.js");
        await mod.prepareRecentRowsDbForDeletion?.();
      }
    },
    {
      key: "director-rows",
      dbName: "jms_dirrows_db",
      title: labels?.directorRowsDbTitle || "DB de Cartões de Diretores",
        "Dados de correspondência de diretores e conteúdo usados nas linhas de coleção de diretores são armazenados aqui.",
      prepare: async () => {
        const mod = await import("../dirRowsDb.js");
        await mod.prepareDirRowsDbForDeletion?.();
      }
    },
    {
      key: "personal-recommendations",
      dbName: "jms_prc_db",
      title: labels?.personalRecommendationsDbTitle || "DB de Recomendações Pessoais",
        "Dados de cache usados para \"Recomendações Especiais para Você\" e linhas de recomendações personalizadas similares são mantidos aqui.",
      prepare: async () => {
        const mod = await import("../prcDb.js");
        await mod.preparePrcDbForDeletion?.();
      }
    },
    {
      key: "collection-cache",
      dbName: "jms_collection_cache",
      title: labels?.collectionCacheDbTitle || "DB de Cartões de Coleções",
        "O cache mantido para boxsets, cartões de coleções e listas de conteúdo dessas coleções é armazenado aqui.",
      prepare: async () => {
        const mod = await import("../collectionCacheDb.js");
        await mod.prepareCollectionCacheDbForDeletion?.();
      }
    },
    {
      key: "gmmp-music",
      dbName: "GMMP-MusicDB",
      title: labels?.gmmpMusicDbTitle || "DB de Música GMMP",
        "O arquivo de faixas, histórico de registros excluídos e letras de músicas no lado GMMP são mantidos neste banco de dados.",
      prepare: async () => {
        const mod = await import("../player/utils/db.js");
        await mod.prepareMusicDbForDeletion?.();
      }
    }
  ];
}

function createDatabaseAction(entry, labels) {
  const row = document.createElement("div");
  row.className = "db-management-item";

  const info = document.createElement("div");
  info.className = "db-management-item-info";

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.textContent = entry.title;

  const description = document.createElement("div");
  description.className = "description-text";
  description.style.marginTop = "4px";
  description.textContent = entry.description;

  const dbName = document.createElement("div");
  dbName.className = "description-text2";
  dbName.style.marginTop = "4px";
  dbName.textContent = `DB: ${entry.dbName}`;

  const status = document.createElement("div");
  status.className = "description-text2";
  status.style.marginTop = "6px";
  status.style.display = "none";

  const actions = document.createElement("div");
  actions.className = "db-management-item-actions";

  const backupButton = document.createElement("button");
  backupButton.type = "button";
  backupButton.className = "db-management-item-button";
  backupButton.style.whiteSpace = "nowrap";

  const restoreButton = document.createElement("button");
  restoreButton.type = "button";
  restoreButton.className = "db-management-item-button";
  restoreButton.style.whiteSpace = "nowrap";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "db-management-item-button";
  deleteButton.style.whiteSpace = "nowrap";

  const restoreInput = document.createElement("input");
  restoreInput.type = "file";
  restoreInput.accept = ".json,application/json";
  restoreInput.style.display = "none";

  function resetButtonLabels() {
    backupButton.textContent = labels?.dbBackupButton || labels?.backupDatabase || "Baixar Backup";
    restoreButton.textContent = labels?.dbRestoreButton || labels?.restoreDatabase || "Restaurar Backup";
    deleteButton.textContent = labels?.dbDeleteButton || "Excluir do Navegador";
  }

  function setRowBusy(active) {
    row.dataset.busy = active ? "1" : "0";
    backupButton.disabled = active;
    restoreButton.disabled = active;
    deleteButton.disabled = active;
    restoreInput.disabled = active;
  }

  async function runRowAction(button, busyLabel, action) {
    if (row.dataset.busy === "1") return;

    setRowBusy(true);
    resetButtonLabels();
    button.textContent = busyLabel;

    try {
      await action();
    } finally {
      setRowBusy(false);
      resetButtonLabels();
    }
  }

  backupButton.addEventListener("click", async () => {
    await runRowAction(
      backupButton,
      labels?.dbBackingUpButton || labels?.backupInProgress || "Baixando...",
      async () => {
        setStatus(status, labels?.dbBackupInProgress || "Preparando backup do banco de dados...");

        try {
          const backup = await exportIndexedDatabase(entry.dbName);
          if (!backup) {
            throw new Error(
                "Banco de dados para backup não encontrado. Use o módulo correspondente pelo menos uma vez primeiro."
            );
          }

          downloadJsonFile(buildBackupFileName(entry, backup.exportedAt), backup);

          const successText =
            formatLabel(
                "Backup baixado. {storeCount} depósitos e {recordCount} registros exportados.",
              {
                storeCount: backup.stores.length,
                recordCount: countBackupRecords(backup)
              }
            );

          setStatus(status, successText);
          showNotification(
            `<i class="fas fa-download" style="margin-right: 8px;"></i> ${successText}`,
            3200,
            "success"
          );
        } catch (error) {
          const errorText =
            String(error?.message || "").trim() ||
            labels?.dbBackupFailed ||
            "Falha ao fazer backup do banco de dados.";

          setStatus(status, errorText);
          showNotification(
            `<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> ${errorText}`,
            4200,
            "error"
          );
        }
      }
    );
  });

  restoreButton.addEventListener("click", () => {
    if (row.dataset.busy === "1") return;
    restoreInput.click();
  });

  restoreInput.addEventListener("change", async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;

    const confirmMessage = [
      formatLabel(
          "Deseja restaurar o banco de dados {name} a partir do backup selecionado?",
        { name: entry.title }
      ),
      `${labels?.dbDeleteConfirmDbLabel || "DB"}: ${entry.dbName}`,
        "Os dados atuais do navegador serão excluídos e substituídos pelo conteúdo do backup."
    ].join("\n\n");

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      event.target.value = "";
      return;
    }

    await runRowAction(
      restoreButton,
      labels?.dbRestoringButton || "Restaurando...",
      async () => {
        try {
          const fileContent = await readFileAsText(file);
          const rawBackup = JSON.parse(fileContent);
          const backup = normalizeIndexedDatabaseBackup(rawBackup, entry, labels);

          if (backup.dbName !== entry.dbName) {
            throw new Error(
              formatLabel(
                  "O backup selecionado não pertence ao banco de dados {name}.",
                { name: entry.title }
              )
            );
          }

          setStatus(
            status,
              "Fechando conexões abertas e preparando o banco de dados para restauração..."
          );

          await entry.prepare?.();
          await wait(RELEASE_WAIT_MS);
          await deleteIndexedDatabase(entry.dbName);
          await wait(RELEASE_WAIT_MS);

          await restoreIndexedDatabaseBackup(backup, {
            onStatus: (message) => {
              setStatus(status, message || labels?.dbRestoreInProgress || "Restaurando backup...");
            }
          });

          const successText =
            formatLabel(
                "Restauração concluída. {storeCount} depósitos e {recordCount} registros importados.",
              {
                storeCount: backup.stores.length,
                recordCount: countBackupRecords(backup)
              }
            );

          setStatus(status, successText);
          showNotification(
            `<i class="fas fa-upload" style="margin-right: 8px;"></i> ${successText}`,
            3400,
            "success"
          );
        } catch (error) {
          const errorText =
            String(error?.message || "").trim() ||
            labels?.dbRestoreFailed ||
            "Falha ao restaurar o banco de dados.";

          setStatus(status, errorText);
          showNotification(
            `<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> ${errorText}`,
            5000,
            "error"
          );
        } finally {
          event.target.value = "";
        }
      }
    );
  });

  deleteButton.addEventListener("click", async () => {
    const confirmMessage = [
      formatLabel(
        labels?.dbDeleteConfirmQuestion || "Do you want to delete the {name} database?",
        { name: entry.title }
      ),
      `${labels?.dbDeleteConfirmDbLabel || "DB"}: ${entry.dbName}`,
      labels?.dbDeleteConfirmRecreateNote || "This data will be recreated automatically when needed."
    ].join("\n\n");

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    await runRowAction(
      deleteButton,
      labels?.dbDeletingButton || "Excluindo...",
      async () => {
        setStatus(
          status,
          labels?.dbDeleteInProgress || "Fechando conexões abertas e excluindo o banco de dados..."
        );

        try {
          await entry.prepare?.();
          await wait(RELEASE_WAIT_MS);
          await deleteIndexedDatabase(entry.dbName);

          const successText =
            labels?.dbDeleteSuccessMessage ||
            "Exclusão concluída. O módulo correspondente recriará o banco de dados quando necessário.";
          setStatus(status, successText);

          showNotification(
            `<i class="fas fa-database" style="margin-right: 8px;"></i> ${entry.title} excluído.`,
            3000,
            "success"
          );
        } catch (error) {
          const errorText =
            String(error?.message || "").trim() ||
            labels?.dbDeleteFailed ||
            "Não foi possível excluir o banco de dados.";

          setStatus(status, errorText);
          showNotification(
            `<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> ${errorText}`,
            4200,
            "error"
          );
        }
      }
    );
  });

  resetButtonLabels();

  info.append(title, description, dbName, status);
  actions.append(backupButton, restoreButton, deleteButton, restoreInput);
  row.append(info, actions);
  return row;
}

export function createDbManagementPanel(config, labels) {
  const panel = document.createElement("div");
  panel.id = "db-management-panel";
  panel.className = "settings-panel";

  const introSection = createSection(labels?.dbManagementTab || "Gerenciamento de DB");

  const introText = document.createElement("div");
  introText.className = "description-text";
  introText.textContent =
    labels?.dbManagementDescription ||
    "Aqui você pode fazer backup, restaurar ou excluir os bancos de dados IndexedDB do navegador.";

  const blockedHint = document.createElement("div");
  blockedHint.className = "description-text2";
  blockedHint.style.marginTop = "8px";
  blockedHint.textContent =
    labels?.dbManagementBlockedHint ||
    "Se a operação for bloqueada por uma aba aberta ou conexão ativa, recarregue a página e tente novamente.";

  introSection.append(introText, blockedHint);

  const listSection = createSection(labels?.dbManagementListTitle || "Bancos de Dados Gerenciáveis");
  getDatabaseEntries(labels).forEach((entry) => {
    listSection.appendChild(createDatabaseAction(entry, labels));
  });

  panel.append(introSection, listSection);
  return panel;
}

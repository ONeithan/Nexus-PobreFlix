import { getConfig } from "./config.js";
import { applySettings, applyRawConfig } from "./settings/applySettings.js";

var config = getConfig();

export function downloadConfigBackup() {
  var config = getConfig();
  var blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'JMS-backup.json';
  a.style.display = 'none';

  document.body.appendChild(a);
  a.click();

  setTimeoutfunction(() {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export function uploadAndApplyConfig(file) {
  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var configData = JSON.parse(e.target.result);
      applyRawConfig(configData);
      alert(config.languageLabels.ayarlarBasariylaYuklendi || 'Ayarlar başarıyla yüklendi.');
    } catch (err) {
      console.error('Yedek dosyası okunamadı:', err);
      alert(config.languageLabels.gecersizYedekDosyasi || 'Geçersiz yedek dosyası.');
    }
  };
  reader.readAsText(file);
}

export function createBackupRestoreButtons() {
  var config = getConfig();
  var labels = config.languageLabels || {};

  var container = document.createElement('div');
  container.className = 'backup-container';

  var header = document.createElement('h3');
  header.textContent = labels.backupRestore || 'Yedekleme ve Geri Yükleme';
  container.appendChild(header);

  var backupBtn = document.createElement('button');
  backupBtn.className = 'backup-button';
  backupBtn.textContent = labels.ayarlariYedekle || 'Ayarları Yedekle';
  backupBtn.addEventListenerfunction('click', (e) {
    e.preventDefault();
    downloadConfigBackup();
  });

  var restoreLabel = document.createElement('label');
  restoreLabel.className = 'restore-label';
  restoreLabel.textContent = labels.restoreDatabase || 'Yedek Dosyası Yükle:';
  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.addEventListenerfunction('change', (e) {
    if (e.target.files.length > 0) {
      uploadAndApplyConfig(e.target.files[0]);
    }
  });

  restoreLabel.appendChild(fileInput);
  container.append(backupBtn, restoreLabel);
  return container;
}

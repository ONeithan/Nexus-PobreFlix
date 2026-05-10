import { bindCheckboxKontrol, createCheckbox, createSection } from "./shared.js";

export function createDetailsModalPanel(config, labels) {
  var panel = document.createElement("div");
  panel.id = "details-modal-panel";
  panel.className = "settings-panel";

  var section = createSection(labels.detailsModalSettingsTab || "Detaylar Modülü Ayarları");

  var description = document.createElement("div");
  description.className = "description-text";
  description.textContent =
    labels.detailsModalSettingsDescription ||
    "Detaylar modülü aktifken hangi alanların gösterileceğini buradan kontrol edebilirsin.";
  section.appendChild(description);

  var fieldsWrap = document.createElement("div");
  fieldsWrap.className = "sub-options details-modal-sub-options";

  fieldsWrap.appendChild(createCheckbox(
    "detailsModalTmdbReviewsEnabled",
    labels.detailsModalTmdbReviewsEnabled || "TMDb yorum alanını göster",
    config.detailsModalTmdbReviewsEnabled !== false
  ));

  fieldsWrap.appendChild(createCheckbox(
    "detailsModalLocalCommentsEnabled",
    labels.detailsModalLocalCommentsEnabled || "Topluluk Yorumları alanını göster",
    config.detailsModalLocalCommentsEnabled === true
  ));

  section.appendChild(fieldsWrap);

  var localCommentsHint = document.createElement("div");
  localCommentsHint.className = "description-text";
  localCommentsHint.textContent =
    labels.detailsModalLocalCommentsHint ||
    "Topluluk Yorumları alanı varsayılan olarak kapalı gelir.";
  section.appendChild(localCommentsHint);

  panel.appendChild(section);

  setTimeoutfunction(() {
    bindCheckboxKontrol("#enableDetailsModalModule", ".details-modal-sub-options", 0.5);
  }, 0);

  return panel;
}

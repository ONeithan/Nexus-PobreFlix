import { bindCheckboxKontrol, createCheckbox, createSection } from "./shared.js";

export function createWatchlistPanel(config, labels) {
    const panel = document.createElement("div");
    panel.id = "watchlist-settings-panel";
    panel.className = "settings-panel";

    const section = createSection(labels.watchlistSettingsTab || "Configurações da Minha Lista");

    section.appendChild(
        createCheckbox(
            "watchlistTabsSliderEnabled",
            labels.watchlistTabsSliderEnabled || "Mostrar botão na barra de abas superior",
            config.watchlistTabsSliderEnabled
        )
    );

    section.appendChild(
        createCheckbox(
            "watchlistAutoRemovePlayed",
            labels.watchlistAutoRemovePlayed || "Remover automaticamente conteúdos assistidos da lista",
            config.watchlistAutoRemovePlayed
        )
    );

    const autoRemoveFavoriteCheckbox = createCheckbox(
        "watchlistAutoRemovePlayedFromFavorites",
        labels.watchlistAutoRemovePlayedFromFavorites || "Remover também dos favoritos do Jellyfin durante a remoção automática",
        config.watchlistAutoRemovePlayedFromFavorites
    );
    autoRemoveFavoriteCheckbox.classList.add("watchlist-auto-remove-favorite-container");
    section.appendChild(autoRemoveFavoriteCheckbox);

    const importFavoritesCheckbox = createCheckbox(
        "watchlistImportFavoritesOnStartup",
        labels.watchlistImportFavoritesOnStartup || "Importar favoritos do Jellyfin ao iniciar",
        config.watchlistImportFavoritesOnStartup
    );

    importFavoritesCheckbox.classList.add("watchlist-import-favorites-container");

    const importFavoritesDescription = document.createElement("div");
    importFavoritesDescription.className = "description-text";
    importFavoritesDescription.textContent = labels.watchlistImportFavoritesOnStartupDescription
        || "Ative isso durante a primeira instalação ou quando quiser importar seus favoritos.";

    const importFavoritesWrapper = document.createElement("div");
    importFavoritesWrapper.className = "watchlist-import-wrapper";

    importFavoritesWrapper.appendChild(importFavoritesCheckbox);
    importFavoritesWrapper.appendChild(importFavoritesDescription);

    section.appendChild(importFavoritesWrapper);

    bindCheckboxKontrol("#watchlistAutoRemovePlayed", ".watchlist-auto-remove-favorite-container", 0.6);

    bindCheckboxKontrol(
        "#watchlistImportFavoritesOnStartup",
        ".watchlist-import-wrapper .description-text",
        0.5
    );

    panel.appendChild(section);
    return panel;
}

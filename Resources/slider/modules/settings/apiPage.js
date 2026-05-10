import { createCheckbox, createSection } from "./shared.js";

var DEFAULT_CONTENT_TYPES = ["Movie", "Series"];
var DEFAULT_IMAGE_TYPES = ["Logo", "Backdrop"];
var IMAGE_TYPE_QUERY_ORDER = ["Backdrop", "Logo"];

function normalizeKeywordList(raw) {
    var source = Array.isArray(raw)
        ? raw
        : String(raw || "").split(",");

    var seen = new Set();
    return source
        .mapfunction((item) String(item || "").trim())
        .filter(Boolean)
        .filterfunction((item) {
            var key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function parseQueryParams(query) {
    var params = new Map();
    String(query || "")
        .replace(/^[?&]+/, "")
        .split("&")
        .mapfunction((part) part.trim())
        .filter(Boolean)
        .forEach(function((part) {
            var [rawKey, ...rest] = part.split("=");
            var key = String(rawKey || "").trim().toLowerCase();
            if (!key) return;
            var value = rest.join("=").trim();
            params.set(key, decodeURIComponent(value));
        });
    return params;
}

function readCsvParam(params, key, fallback = []) {
    var value = params.get(String(key || "").toLowerCase());
    if (!value) return [...fallback];
    return value
        .split(",")
        .mapfunction((item) item.trim())
        .filter(Boolean);
}

function readSortKey(params) {
    var sortBy = params.get("sortby");
    if (!sortBy) return "";
    return sortBy
        .split(",")
        .mapfunction((item) item.trim())
        .filter(Boolean)[0] || "";
}

function orderImageTypes(types = []) {
    var selected = new Set(types);
    var ordered = IMAGE_TYPE_QUERY_ORDER.filterfunction((type) selected.has(type));
    types.forEach(function((type) {
        if (!ordered.includes(type)) ordered.push(type);
    });
    return ordered;
}

function buildQueryString({ contentTypes = [], imageTypes = [], sortBy = "" } = {}) {
    var parts = [];

    if (contentTypes.length) {
        parts.push("IncludeItemTypes=" + (contentTypes.join(",")));
    }

    parts.push("Recursive=true");
    parts.push("hasOverview=true");

    var orderedImageTypes = orderImageTypes(imageTypes);
    if (orderedImageTypes.length) {
        parts.push("imageTypes=" + (orderedImageTypes.join(",")));
    }

    var safeSortBy = String(sortBy || "").trim();
    if (safeSortBy) {
        if (safeSortBy.toLowerCase() === "random") {
            parts.push("sortBy=Random");
        } else {
            parts.push("sortBy=" + (safeSortBy));
            parts.push("sortOrder=Descending");
        }
    }

    return parts.join("&");
}

function appendQueryParam(query, key, value) {
    var safeQuery = String(query || "").trim();
    var safeKey = String(key || "").trim();
    var safeValue = String(value || "").trim();
    if (!safeKey || !safeValue) return safeQuery;
    if (new RegExp("(?:^|[?&])" + (safeKey) + "=", "i").test(safeQuery)) {
        return safeQuery;
    }
    return safeQuery ? (safeQuery) + "&" + (safeKey) + "=" + (safeValue) : (safeKey) + "=" + (safeValue);
}

function createOptionCheckbox({ name, value, label, checked }) {
    var wrapper = document.createElement("label");
    wrapper.className = "setting-item";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "8px";
    wrapper.style.cursor = "pointer";

    var input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.value = value;
    input.checked = checked;

    var text = document.createElement("span");
    text.textContent = label;

    wrapper.append(input, text);
    return { wrapper, input };
}

function createSubsectionTitle(text) {
    var title = document.createElement("div");
    title.textContent = text;
    title.style.display = "block";
    title.style.marginBottom = "6px";
    title.style.fontWeight = "600";
    return title;
}

function createSubsectionDescription(text) {
    var description = document.createElement("div");
    description.className = "description-text";
    description.textContent = text;
    return description;
}

function buildSortLabel(keyword, labels) {
    var normalized = String(keyword || "").trim();
    if (!normalized) return "";

    switch (normalized.toLowerCase()) {
        case "datecreated":
            return labels.sortOptionDateCreated || "Adicionados Recentemente";
        case "premieredate":
            return labels.sortOptionPremiereDate || "Data de Estreia";
        case "productionyear":
            return labels.sortOptionProductionYear || "Ano de Produção";
        case "random":
            return labels.sortOptionRandom || "Aleatório";
        default:
            return normalized;
    }
}

export function createQueryPanel(config, labels) {
    var panel = document.createElement("div");
    panel.id = "query-panel";
    panel.className = "settings-panel query-settings-panel";

    var section = createSection(labels.queryStringInput || "Configurações de Consulta API");
    section.classList.add("query-settings-section");
    var parsedQuery = parseQueryParams(config.customQueryString);
    var initialContentTypes = readCsvParam(parsedQuery, "IncludeItemTypes", DEFAULT_CONTENT_TYPES);
    var initialImageTypes = readCsvParam(parsedQuery, "imageTypes", DEFAULT_IMAGE_TYPES);
    var initialSortBy = readSortKey(parsedQuery);

    var randomContentDiv = document.createElement("div");
    randomContentDiv.className = "form-group query-toggle-card";
    var randomContentCheckbox = createCheckbox(
        "useRandomContent",
        labels.useRandomContent || "Conteúdo Aleatório",
        false
    );
    randomContentDiv.appendChild(randomContentCheckbox);
    section.appendChild(randomContentDiv);

    var manualListDiv = document.createElement("div");
    manualListDiv.className = "form-group query-toggle-card";
    var useManualListCheckbox = createCheckbox(
        "useManualList",
        labels.useManualList || "Criar Lista Personalizada",
        config.useManualList
    );
    manualListDiv.appendChild(useManualListCheckbox);

    var manualListIdsDiv = document.createElement("div");
    manualListIdsDiv.className = "form-group manual-list-container query-manual-list";
    manualListIdsDiv.id = "manualListIdsContainer";
    manualListIdsDiv.style.display = config.useManualList ? "" : "none";

    var manualListIdsLabel = document.createElement("label");
    manualListIdsLabel.textContent = labels.manualListIdsInput || "IDs de Conteúdo (separados por vírgula):";

    var manualListIdsInput = document.createElement("textarea");
    manualListIdsInput.className = "form-control";
    manualListIdsInput.rows = 4;
    manualListIdsInput.name = "manualListIds";
    manualListIdsInput.value = config.manualListIds || "";
    manualListIdsInput.id = "manualListIdsInput";

    manualListIdsLabel.htmlFor = "manualListIdsInput";
    manualListIdsDiv.append(manualListIdsLabel, manualListIdsInput);

    section.appendChild(manualListDiv);
    section.appendChild(manualListIdsDiv);

    var randomSettingsContainer = document.createElement("div");
    randomSettingsContainer.className = "query-random-settings";
    section.appendChild(randomSettingsContainer);

    var limitDiv = document.createElement("div");
    limitDiv.className = "setting-item limit-container";

    var limitLabel = document.createElement("label");
    limitLabel.textContent = labels.limit || "Limite do Slider:";

    var limitInput = document.createElement("input");
    limitInput.type = "number";
    limitInput.value = typeof config.limit !== "undefined" ? config.limit : 20;
    limitInput.name = "limit";
    limitInput.min = 1;
    limitInput.max = 100;
    limitInput.id = "limitInput";

    limitLabel.htmlFor = "limitInput";
    limitDiv.append(limitLabel, limitInput);

    var limitDesc = document.createElement("div");
    limitDesc.className = "description-text";
    limitDesc.textContent = labels.limitDesc || "Limite de itens a serem exibidos no slider.";

    var queryBuilderContainer = document.createElement("div");
    queryBuilderContainer.className = "form-group query-builder-card";
    queryBuilderContainer.style.flexDirection = "column";
    queryBuilderContainer.style.alignItems = "stretch";

    var contentTypesTitle = createSubsectionTitle(
        labels.queryContentTypesTitle || "Conteúdos a serem Exibidos no Slider"
    );
    var contentTypesDesc = createSubsectionDescription(
        labels.queryContentTypesDesc || "Os itens selecionados serão adicionados automaticamente ao campo IncludeItemTypes."
    );
    var contentTypesGrid = document.createElement("div");
    contentTypesGrid.className = "form-group query-option-grid";
    contentTypesGrid.style.display = "grid";
    contentTypesGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(180px, 1fr))";
    contentTypesGrid.style.alignItems = "stretch";

    var contentTypeInputs = [
        { value: "Movie", label: labels.queryContentTypeMovie || "Filmes" },
        { value: "Series", label: labels.queryContentTypeSeries || "Séries" },
        { value: "BoxSet", label: labels.queryContentTypeBoxSet || "Coleções" }
    ].mapfunction((option) {
        var checkbox = createOptionCheckbox({
            name: "queryContentTypes",
            value: option.value,
            label: option.label,
            checked: initialContentTypes.includes(option.value)
        });
        contentTypesGrid.appendChild(checkbox.wrapper);
        return checkbox.input;
    });

    queryBuilderContainer.append(contentTypesTitle, contentTypesDesc, contentTypesGrid);

    var imageTypesTitle = createSubsectionTitle(
        labels.queryImageTypesTitle || "Status de Imagem dos Conteúdos"
    );
    var imageTypesDesc = createSubsectionDescription(
        labels.queryImageTypesDesc || "Os itens selecionados serão filtrados automaticamente por tipo de imagem."
    );
    var imageTypesGrid = document.createElement("div");
    imageTypesGrid.className = "form-group query-option-grid";
    imageTypesGrid.style.display = "grid";
    imageTypesGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(180px, 1fr))";
    imageTypesGrid.style.alignItems = "stretch";

    var imageTypeInputs = [
        { value: "Logo", label: labels.queryImageTypeLogo || "Logo" },
        { value: "Backdrop", label: labels.queryImageTypeBackdrop || "Backdrop" }
    ].mapfunction((option) {
        var checkbox = createOptionCheckbox({
            name: "queryImageTypes",
            value: option.value,
            label: option.label,
            checked: initialImageTypes.includes(option.value)
        });
        imageTypesGrid.appendChild(checkbox.wrapper);
        return checkbox.input;
    });

    queryBuilderContainer.append(imageTypesTitle, imageTypesDesc, imageTypesGrid);

    var sortingSection = document.createElement("div");
    sortingSection.className = "form-group query-sort-card";
    sortingSection.style.flexDirection = "column";
    sortingSection.style.alignItems = "stretch";

    var sortingHeading = createSubsectionTitle(labels.querySortingTitle || "Ordenação");
    var sortingDesc = createSubsectionDescription(
        labels.querySortingDesc || "Se deixado em branco, o Monwui usará sua própria lógica de mistura. Palavras-chave manuais também aparecerão nesta lista."
    );
    var sortSelect = document.createElement("select");
    sortSelect.id = "querySortBySelect";
    sortSelect.name = "querySortBy";
    sortSelect.className = "form-control";
    sortingSection.append(sortingHeading, sortingDesc, sortSelect);

    var sortingLabel = document.createElement("label");
    sortingLabel.textContent = labels.sortingKeywords || "Palavras-chave (separe com vírgula)";
    sortingLabel.htmlFor = "sortingKeywordsInput";

    var sortingKeywordsDesc = document.createElement("div");
    sortingKeywordsDesc.className = "description-text";
    sortingKeywordsDesc.textContent = labels.sortingKeywordsDesc ||
        "Valores manuais adicionados aqui aparecerão automaticamente nas opções de ordenação.";

    var sortingTextarea = document.createElement("textarea");
    sortingTextarea.id = "sortingKeywordsInput";
    sortingTextarea.name = "sortingKeywords";
    sortingTextarea.placeholder = "DateCreated,PremiereDate,ProductionYear";
    sortingTextarea.value = normalizeKeywordList(config.sortingKeywords).join(",");

    var queryStringLabel = document.createElement("label");
    queryStringLabel.className = "customQueryStringInput query-string-label";
    queryStringLabel.textContent = labels.customQueryString || "Pré-visualização da Consulta API:";
    queryStringLabel.htmlFor = "customQueryPreviewInput";

    var queryStringDesc = document.createElement("div");
    queryStringDesc.className = "description-text";
    queryStringDesc.textContent = labels.customQueryStringNote ||
        "Este campo é gerado automaticamente com base nas suas seleções. Recursive=true e hasOverview=true são sempre incluídos.";

    var queryStringHiddenInput = document.createElement("input");
    queryStringHiddenInput.type = "hidden";
    queryStringHiddenInput.id = "customQueryStringInput";
    queryStringHiddenInput.name = "customQueryString";

    var queryStringTextarea = document.createElement("textarea");
    queryStringTextarea.id = "customQueryPreviewInput";
    queryStringTextarea.className = "query-string-input";
    queryStringTextarea.rows = 5;
    queryStringTextarea.readOnly = true;
    queryStringTextarea.placeholder =
        labels.customQueryStringPlaceholder ||
        "IncludeItemTypes=Movie&Recursive=true&hasOverview=true&imageTypes=Backdrop,Logo";

    var balanceTypesDiv = document.createElement("div");
    balanceTypesDiv.className = "setting-item balance-types-container";
    var balanceTypesCheckbox = createCheckbox(
        "balanceItemTypes",
        labels.balanceItemTypes || "Equilíbrio de Tipos Ativo",
        config.balanceItemTypes || false
    );
    balanceTypesDiv.appendChild(balanceTypesCheckbox);

    var balanceTypesDesc = document.createElement("div");
    balanceTypesDesc.className = "description-text";
    balanceTypesDesc.textContent =
        labels.balanceItemTypesDesc ||
        "Se marcado, tenta distribuir os conteúdos de forma equilibrada entre os tipos (Filmes, Séries, Coleções).";

    var onlyUnwatchedDiv = document.createElement("div");
    onlyUnwatchedDiv.className = "setting-item only-unwatched-container";
    var onlyUnwatchedCheckbox = createCheckbox(
        "onlyUnwatchedRandom",
        labels.onlyUnwatchedRandom || "Mostrar apenas conteúdos não assistidos",
        !!config.onlyUnwatchedRandom
    );
    onlyUnwatchedDiv.appendChild(onlyUnwatchedCheckbox);

    var onlyUnwatchedDesc = document.createElement("div");
    onlyUnwatchedDesc.className = "description-text";
    onlyUnwatchedDesc.textContent =
        labels.onlyUnwatchedRandomDesc ||
        "Se ativado, apenas itens nunca reproduzidos (IsPlayed=false) serão listados no modo Aleatório.";

    var finalDesc = document.createElement("div");
    finalDesc.className = "description-text";
    finalDesc.innerHTML =
        labels.customQueryStringDescription ||
        'Estes campos criam a consulta do slider. IncludeItemTypes, imageTypes e sortBy são preenchidos conforme as seleções. Para detalhes, <a href="https://api.jellyfin.org" target="_blank">visite a documentação da API.</a>.';

    var sectionDivider = document.createElement("hr");
    sectionDivider.className = "query-section-divider";
    sectionDivider.style.border = "0";
    sectionDivider.style.borderTop = "1px solid rgba(68, 68, 68, 0.25)";
    sectionDivider.style.margin = "14px 0";

    var maxShufflingLimitDiv = document.createElement("div");
    maxShufflingLimitDiv.className = "setting-item limit-container";

    var maxShufflingLimitLabel = document.createElement("label");
    maxShufflingLimitLabel.textContent =
        labels.maxShufflingLimit || "Limite Máximo de Conteúdo para Mistura:";

    var maxShufflingLimitInput = document.createElement("input");
    maxShufflingLimitInput.type = "number";
    maxShufflingLimitInput.value = typeof config.maxShufflingLimit !== "undefined" ? config.maxShufflingLimit : 10000;
    maxShufflingLimitInput.name = "maxShufflingLimit";
    maxShufflingLimitInput.min = 1;
    maxShufflingLimitInput.max = 1000000;
    maxShufflingLimitInput.id = "maxShufflingLimitInput";

    maxShufflingLimitLabel.htmlFor = "maxShufflingLimitInput";
    maxShufflingLimitDiv.append(maxShufflingLimitLabel, maxShufflingLimitInput);

    var maxShufflingLimitDesc = document.createElement("div");
    maxShufflingLimitDesc.className = "description-text";
    maxShufflingLimitDesc.textContent =
        labels.maxShufflingLimitDesc ||
        "Limite de conteúdos a serem selecionados para criar o slider. Por exemplo, se definir 1000, o slider será escolhido entre 1000 itens.";

    var shuffleSeedLimitDiv = document.createElement("div");
    shuffleSeedLimitDiv.className = "setting-item shuffleSeedLimit-container";

    var shuffleSeedLimitLabel = document.createElement("label");
    shuffleSeedLimitLabel.textContent =
        labels.shuffleSeedLimit || "shuffleSeedLimit (Limite de Repetição):";

    var shuffleSeedLimitInput = document.createElement("input");
    shuffleSeedLimitInput.type = "number";
    shuffleSeedLimitInput.value = typeof config.shuffleSeedLimit !== "undefined" ? config.shuffleSeedLimit : 200;
    shuffleSeedLimitInput.name = "shuffleSeedLimit";
    shuffleSeedLimitInput.min = 1;
    shuffleSeedLimitInput.max = 100000;
    shuffleSeedLimitInput.id = "shuffleSeedLimitInput";

    shuffleSeedLimitLabel.htmlFor = "shuffleSeedLimitInput";
    shuffleSeedLimitDiv.append(shuffleSeedLimitLabel, shuffleSeedLimitInput);

    var shuffleSeedLimitDesc = document.createElement("div");
    shuffleSeedLimitDesc.className = "description-text";
    shuffleSeedLimitDesc.textContent =
        labels.shuffleSeedLimitDesc ||
        'shuffleSeedLimit determina o comprimento máximo da memória histórica usada para evitar repetições. Quando este limite é atingido, o histórico de mistura é limpo automaticamente.';

    var playingLimitDiv = document.createElement("div");
    playingLimitDiv.className = "setting-item playing-limit-container";

    var playingLimitLabel = document.createElement("label");
    playingLimitLabel.textContent = labels.playingLimit || "Quantidade de itens 'Continuar Assistindo':";

    var playingLimitInput = document.createElement("input");
    playingLimitInput.type = "number";
    playingLimitInput.value = config.playingLimit || 5;
    playingLimitInput.name = "playingLimit";
    playingLimitInput.min = 0;
    playingLimitInput.max = 100;
    playingLimitInput.id = "playingLimitInput";

    playingLimitLabel.htmlFor = "playingLimitInput";
    playingLimitDiv.append(playingLimitLabel, playingLimitInput);

    var playingLimitDesc = document.createElement("div");
    playingLimitDesc.className = "description-text";
    playingLimitDesc.textContent =
        labels.playingLimitDesc ||
        'Lista os últimos conteúdos cuja reprodução foi interrompida. Valor "0" desativa esta função.';

    var excludeEpisodesDiv = document.createElement("div");
    excludeEpisodesDiv.className = "setting-item exclude-episodes-container";

    var excludeEpisodesCheckbox = createCheckbox(
        "excludeEpisodesFromPlaying",
        labels.excludeEpisodesFromPlaying || "Excluir Episódios de Séries",
        config.excludeEpisodesFromPlaying || false
    );
    excludeEpisodesDiv.appendChild(excludeEpisodesCheckbox);

    var excludeEpisodesDesc = document.createElement("div");
    excludeEpisodesDesc.className = "description-text";
    excludeEpisodesDesc.textContent =
        labels.excludeEpisodesFromPlayingDesc ||
        'Se marcado, exclui episódios de séries da lista "Continuar Assistindo"';

    function getSelectedValues(inputs = []) {
        return inputs.filterfunction((input) input.checked).mapfunction((input) input.value);
    }

    function getSortOptions() {
        var keywords = normalizeKeywordList(sortingTextarea.value);
        var safeSelectedSort = String(sortSelect.value || initialSortBy || "").trim();
        if function(safeSelectedSort && !keywords.some((keyword) keyword.toLowerCase() === safeSelectedSort.toLowerCase())) {
            keywords.push(safeSelectedSort);
        }
        return keywords;
    }

    function refreshSortOptions() {
        var previousValue = String(sortSelect.value || initialSortBy || "").trim();
        var sortOptions = getSortOptions();
        sortSelect.innerHTML = "";

        var noneOption = document.createElement("option");
        noneOption.value = "";
        noneOption.textContent = labels.querySortNone || "Mistura Padrão Monwui";
        sortSelect.appendChild(noneOption);

        sortOptions.forEach(function((keyword) {
            var option = document.createElement("option");
            option.value = keyword;
            option.textContent = buildSortLabel(keyword, labels);
            sortSelect.appendChild(option);
        });

        if function(previousValue && sortOptions.some((keyword) keyword.toLowerCase() === previousValue.toLowerCase())) {
            sortSelect.value = sortOptions.findfunction((keyword) keyword.toLowerCase() === previousValue.toLowerCase()) || "";
        } else {
            sortSelect.value = "";
        }
    }

    function buildEffectiveQuery() {
        var query = buildQueryString({
            contentTypes: getSelectedValues(contentTypeInputs),
            imageTypes: getSelectedValues(imageTypeInputs),
            sortBy: sortSelect.value
        });

        if (onlyUnwatchedCheckbox.querySelector("input").checked) {
            query = appendQueryParam(query, "IsPlayed", "false");
        }

        return query;
    }

    function buildPreviewText() {
        var lines = [buildEffectiveQuery()];

        if (balanceTypesCheckbox.querySelector("input").checked) {
            lines.push("# balanceItemTypes=true");
        }

        if (onlyUnwatchedCheckbox.querySelector("input").checked) {
            lines.push("# onlyUnwatchedRandom=true");
        }

        return lines.filter(Boolean).join("\n");
    }

    function refreshQueryPreview() {
        queryStringHiddenInput.value = buildEffectiveQuery();
        queryStringTextarea.value = buildPreviewText();
    }

    randomSettingsContainer.append(
        limitDesc,
        limitDiv,
        queryBuilderContainer,
        sortingSection,
        sortingLabel,
        sortingKeywordsDesc,
        sortingTextarea,
        queryStringLabel,
        queryStringDesc,
        queryStringHiddenInput,
        queryStringTextarea,
        balanceTypesDesc,
        balanceTypesDiv,
        onlyUnwatchedDesc,
        onlyUnwatchedDiv,
        finalDesc,
        sectionDivider,
        maxShufflingLimitDesc,
        maxShufflingLimitDiv,
        shuffleSeedLimitDesc,
        shuffleSeedLimitDiv,
        playingLimitDesc,
        playingLimitDiv,
        excludeEpisodesDesc,
        excludeEpisodesDiv
    );

    refreshSortOptions();
    if (initialSortBy) {
        sortSelect.value = initialSortBy;
    }
    refreshQueryPreview();

    [...contentTypeInputs, ...imageTypeInputs].forEach(function((input) {
        input.addEventListener("change", refreshQueryPreview);
    });
    sortSelect.addEventListener("change", refreshQueryPreview);
    sortingTextarea.addEventListenerfunction("input", () {
        refreshSortOptions();
        refreshQueryPreview();
    });
    balanceTypesCheckbox.querySelector("input").addEventListener("change", refreshQueryPreview);
    onlyUnwatchedCheckbox.querySelector("input").addEventListener("change", refreshQueryPreview);

    function handleSelection(selectedCheckbox) {
        var checkboxes = [
            randomContentCheckbox.querySelector("input"),
            useManualListCheckbox.querySelector("input")
        ];

        checkboxes.forEach(function((cb) {
            if (cb !== selectedCheckbox) cb.checked = false;
        });

        var isRandom = selectedCheckbox === checkboxes[0];

        randomSettingsContainer.style.display = isRandom ? "" : "none";
        manualListIdsDiv.style.display = selectedCheckbox === checkboxes[1] ? "" : "none";
        manualListIdsInput.disabled = selectedCheckbox !== checkboxes[1];
        onlyUnwatchedCheckbox.querySelector("input").disabled = !isRandom;
        limitInput.disabled = !isRandom;
        maxShufflingLimitInput.disabled = !isRandom;
        shuffleSeedLimitInput.disabled = !isRandom;
        playingLimitInput.disabled = !isRandom;
        sortSelect.disabled = !isRandom;
        sortingTextarea.disabled = !isRandom;
    }

    [randomContentCheckbox, useManualListCheckbox].forEach(function((chkDiv) {
        chkDiv.querySelector("input").addEventListener("change", function () {
            if (!this.checked) {
                this.checked = true;
                return;
            }
            handleSelection(this);
        });
    });

    if (config.useManualList) {
        useManualListCheckbox.querySelector("input").checked = true;
        handleSelection(useManualListCheckbox.querySelector("input"));
    } else {
        randomContentCheckbox.querySelector("input").checked = true;
        handleSelection(randomContentCheckbox.querySelector("input"));
    }

    panel.appendChild(section);
    return panel;
}

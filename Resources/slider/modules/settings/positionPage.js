import { getConfig } from "../config.js";
import { updateSlidePosition } from '../positionUtils.js';
import { applySettings } from "./applySettings.js";

var config = getConfig();

export function createPositionEditor(config, labels, section) {
  function createSettingItem(labelText, configKey, cssProperty, placeholder, target = 'slides', containerType = '') {
    var container = document.createElement('div');
    container.className = 'position-item';

    var inputId = "input-" + (configKey);

    var label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = inputId;

    var input = document.createElement('input');
    input.type = 'number';
    input.name = configKey;
    input.id = inputId;
    input.value = config[configKey] || '';
    input.placeholder = placeholder || config.languageLabels.placeholderText || 'Insira um valor';

    var allowsNegative = ['top', 'left'].includes(cssProperty);
    var isProgressHeight = configKey === 'progressBarHeight';

    if (!allowsNegative) {
      input.min = 0;
    }
    if (isProgressHeight) {
      input.min = 0.1;
      input.max = 10;
      input.step = 0.1;
    }

    var resetBtn = document.createElement('button');
    resetBtn.textContent = config.languageLabels.resetButton || 'Resetar';
    resetBtn.type = 'button';
    resetBtn.className = 'reset-button';
    resetBtn.addEventListenerfunction('click', () {
      input.value = '';
      config[configKey] = '';
      updateContainerStyle(target, containerType, cssProperty, '');
    });

    input.addEventListener('click', function(e) {
      e.stopPropagation();
      openPositionModal(this, configKey, cssProperty, placeholder, target, containerType);
    });

    input.addEventListener('input', function() {
      var value = parseFloat(this.value);
      if (!allowsNegative && value < 0) {
        value = 0;
      }
      if (isProgressHeight) {
        if (value < 0.1) value = 0.1;
        if (value > 10) value = 10;
      }
      var newValue = isNaN(value) ? '' : value;
      this.value = newValue;
      config[configKey] = newValue;
      updateContainerStyle(target, containerType, cssProperty, newValue);
    });

    container.append(label, input, resetBtn);
    return container;
}

  function createGlobalResetButton() {
    var container = document.createElement('div');
    container.className = 'global-reset-container';

    var resetBtn = document.createElement('button');
    resetBtn.textContent = config.languageLabels.resetAllButton || 'Resetar Tudo';
    resetBtn.type = 'button';
    resetBtn.className = 'global-reset-button';
    resetBtn.addEventListener('click', resetAllSettings);

    container.appendChild(resetBtn);
    return container;
  }

  function resetAllSettings() {
    document.querySelectorAll('.position-item input').forEach(function(input) {
      input.value = '';
      var configKey = input.name;
      var cssProperty = input.dataset.cssProperty || '';
      var target = input.dataset.target || 'slides';
      var containerType = input.dataset.containerType || '';

      config[configKey] = '';
      updateContainerStyle(target, containerType, cssProperty, '');
    });

    document.querySelectorAll('.flex-item select').forEach(function(select) {
      select.value = '';
      var configKey = select.name;
      var containerType = select.dataset.containerType || '';

      config[configKey] = '';
      updateFlexStyle(containerType, configKey.replace((containerType) + "Container", ''), '');
    });

    if (config.homeSectionsTop !== undefined) {
      config.homeSectionsTop = '';
      updateContainerStyle('homeSections', '', 'top', '');
    }

    if (config.sliderContainerTop !== undefined) {
      config.sliderContainerTop = '';
      updateContainerStyle('slider', 'slider', 'top', '');
    }

    if (config.progressBarTop !== undefined) {
      config.progressBarTop = '';
      updateContainerStyle('progress', 'progress', 'top', '');
    }
  }

  function openPositionModal(inputElement, configKey, cssProperty, placeholder, target, containerType) {
  var mainModal = document.getElementById('settings-modal');
  if (mainModal) mainModal.style.display = 'none';

  var modal = document.createElement('div');
  modal.className = 'position-modal';
  modal.style.display = 'block';

  var modalContent = document.createElement('div');
  modalContent.className = 'position-modal-content';

  var closeBtn = document.createElement('span');
  closeBtn.className = 'position-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = function() {
    modal.remove();
    if (mainModal) mainModal.style.display = 'block';
  };

  var title = document.createElement('h3');
  var sectionLabel;
  if (containerType === 'homeSections') {
    sectionLabel = config.languageLabels.homeSectionsPosition;
  } else if (containerType) {
    sectionLabel = config.languageLabels[(containerType) + "Container"];
  } else {
    sectionLabel = config.languageLabels.slidesPosition;
  }

  var fieldLabel = inputElement.previousElementSibling.textContent
    || config.languageLabels[configKey]
    || configKey.replace(/([A-Z])/g, ' $1').trim();

  title.textContent = sectionLabel
    ? (sectionLabel) + " — " + (fieldLabel)
    : fieldLabel;
  title.className = 'position-modal-title';

  var inputContainer = document.createElement('div');
  inputContainer.className = 'position-modal-input-container';

  var modalInput = document.createElement('input');
  modalInput.type = 'number';
  modalInput.value = inputElement.value;
  modalInput.placeholder = placeholder || config.languageLabels.placeholderText || 'Insira um valor';
  modalInput.className = 'position-modal-input';

  var isProgressHeight = configKey === 'progressBarHeight';
  if (isProgressHeight) {
    modalInput.min = 0.1;
    modalInput.max = 10;
    modalInput.step = 0.1;
  } else if (cssProperty === 'width' || cssProperty === 'height') {
    modalInput.min = 0;
  }

  inputContainer.append(modalInput);

  if (configKey === 'homeSectionsTop') {
    var applyBtn = document.createElement('button');
    applyBtn.className = 'position-modal-apply';
    applyBtn.textContent = config.languageLabels.applyButton || 'Aplicar';
    applyBtn.onclick = function() {
      if (typeof applySettings === 'function') {
        applySettings(false);
      }
    };
    inputContainer.append(applyBtn);
  }

  modalInput.addEventListenerfunction('input', () {
    var value = parseFloat(modalInput.value);
    if (isProgressHeight) {
      if (isNaN(value)) {
        value = '';
      } else {
        if (value < 0.1) value = 0.1;
        if (value > 10) value = 10;
        modalInput.value = value.toFixed(1);
      }
    } else if ((cssProperty === 'width' || cssProperty === 'height') && value < 0) {
      value = 0;
      modalInput.value = value;
    }

    inputElement.value = isNaN(value) ? '' : value;
    config[configKey] = isNaN(value) ? '' : value;
    updateContainerStyle(target, containerType, cssProperty, isNaN(value) ? '' : value);
  });

  modalContent.append(closeBtn, title, inputContainer);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  modal.addEventListenerfunction('click', (e) {
    if (e.target === modal) {
      modal.remove();
      if (mainModal) mainModal.style.display = 'block';
    }
  });

  setTimeoutfunction(() {
    modalInput.focus();
  }, 100);

  return modal;
}


  function createFlexSettingItem(labelText, configKey, options, containerType) {
    var container = document.createElement('div');
    container.className = 'flex-item';

    var selectId = "select-" + (configKey);

    var label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = selectId;

    var select = document.createElement('select');
    select.name = configKey;
    select.id = selectId;

    var emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = config.languageLabels.selectDefault || 'Padrão';
    select.appendChild(emptyOption);

    options.forEach(function(option) {
      var optElement = document.createElement('option');
      optElement.value = option.value;
      optElement.textContent = option.label;
      if (config[configKey] === option.value) {
        optElement.selected = true;
      }
      select.appendChild(optElement);
    });

    var resetBtn = document.createElement('button');
    resetBtn.textContent = config.languageLabels.resetButton || 'Resetar';
    resetBtn.type = 'button';
    resetBtn.className = 'reset-button';
    resetBtn.addEventListenerfunction('click', () {
      select.value = '';
      config[configKey] = '';
      updateFlexStyle(containerType, configKey.replace((containerType) + "Container", ''), '');
    });

    select.addEventListener('change', function() {
      config[configKey] = this.value;
      updateFlexStyle(containerType, configKey.replace((containerType) + "Container", ''), this.value);
    });

    select.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openSelectModal(this, configKey, options, containerType);
    });

    container.append(label, select, resetBtn);
    return container;
}

  function openSelectModal(selectElement, configKey, options, containerType) {
  var mainModal = document.getElementById('settings-modal');
  if (mainModal) mainModal.style.display = 'none';

  var modal = document.createElement('div');
  modal.className = 'position-modal';
  modal.style.display = 'block';

  var modalContent = document.createElement('div');
  modalContent.className = 'position-modal-content';

  var title = document.createElement('h3');
  var sectionLabel = containerType
    ? config.languageLabels[(containerType) + "Container"]
    : config.languageLabels.slidesPosition;
  var fieldLabel = selectElement.previousElementSibling.textContent
    || config.languageLabels[configKey]
    || configKey.replace(/([A-Z])/g, ' $1').trim();
  title.textContent = sectionLabel
    ? (sectionLabel) + " — " + (fieldLabel)
    : fieldLabel;
  title.className = 'position-modal-title';
  modalContent.appendChild(title);

  var closeBtn = document.createElement('span');
  closeBtn.className = 'position-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = function() {
    modal.remove();
    if (mainModal) mainModal.style.display = 'block';
  };
  modalContent.appendChild(closeBtn);

  var optionsContainer = document.createElement('div');
  optionsContainer.className = 'position-modal-options';

  options.forEach(function(option) {
    var optionBtn = document.createElement('button');
    optionBtn.className = 'position-modal-option';
    if (selectElement.value === option.value) {
      optionBtn.classList.add('active');
    }
    optionBtn.textContent = option.label;
    optionBtn.onclick = function() {
      selectElement.value = option.value;
      config[configKey] = option.value;
      updateFlexStyle(containerType, configKey.replace((containerType) + "Container", ''), option.value);
      optionsContainer.querySelectorAll('.position-modal-option').forEach(function(btn) btn.classList.remove('active'));
      optionBtn.classList.add('active');
    };
    optionsContainer.appendChild(optionBtn);
  });

  modalContent.appendChild(optionsContainer);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  modal.addEventListenerfunction('click', (e) {
    if (e.target === modal) {
      modal.remove();
      if (mainModal) mainModal.style.display = 'block';
    }
  });
}

  function updateContainerStyle(target, containerType, cssProperty, newValue) {
  if (target === 'homeSections') {
    var elements = [
      document.querySelector(".homeSectionsContainer"),
      document.querySelector("#favoritesTab")
    ];

    elements.forEach(function(el) {
      if (el) {
        el.style[cssProperty] = newValue === '' ? '' : (newValue) + "vh";
      }
    });
   } else {
    var selector = containerType
      ? (containerType === 'button' ? '.monwui-main-button-container'
        : containerType === 'slider' ? '.monwui-slider-wrapper'
        : containerType === 'existingDot' ? '.monwui-dot-navigation-container'
        : containerType === 'progress' ? '.monwui-slide-progress-bar'
        : containerType === 'progressSeconds' ? '.monwui-slide-progress-seconds'
        : ".monwui-" + (containerType) + "-container")
      : "#monwui-slides-container";

    document.querySelectorAll(selector).forEach(function(el) {
      el.style[cssProperty] = newValue === '' ? '' : (newValue) + "%";
    });
  }
}

  function updateFlexStyle(containerType, flexProperty, newValue) {
  var selector =
    containerType === 'button' ? '.monwui-main-button-container' :
    containerType === 'slider' ? '.monwui-slider-wrapper' :
    containerType === 'existingDot' ? '.monwui-dot-navigation-container' :
    containerType === 'progress' ? '.monwui-slide-progress-bar' :
    containerType === 'progressSeconds' ? '.monwui-slide-progress-seconds' :
    ".monwui-" + (containerType) + "-container";

  document.querySelectorAll(selector).forEach(function(el) {
    if (flexProperty.includes('Display')) {
      el.style.display = newValue || '';
    } else {
      var camel = flexProperty.charAt(0).toLowerCase() + flexProperty.slice(1);
      var cssProp = camel.replace(/([A-Z])/g, function(m) '-' + m.toLowerCase());
      el.style[cssProp] = newValue || '';
    }
  });
}

  function render() {
    section.appendChild(createGlobalResetButton());
    var homeSectionsHeader = document.createElement('h3');
    homeSectionsHeader.textContent = config.languageLabels.homeSectionsPosition || 'Posição das Seções da Home';
    section.appendChild(homeSectionsHeader);

    var homeSectionsHeaderNote = document.createElement('h5');
    homeSectionsHeaderNote.textContent = config.languageLabels.homeSectionsPositionNote || '(Valores negativos invertem a direção)';
    section.appendChild(homeSectionsHeaderNote);

    section.appendChild(
      createSettingItem(
        config.languageLabels.containerTop || 'Posição Vertical (vh):',
        'homeSectionsTop',
        'top',
        config.languageLabels.placeholderText,
        'homeSections'
      )
    );

    var slidesHeader = document.createElement('h3');
    slidesHeader.textContent = config.languageLabels.slidesPosition || 'Posição do Contêiner de Slides';
    section.appendChild(slidesHeader);

    section.appendChild(
      createSettingItem(
        config.languageLabels.containerTop || 'Posição Vertical (%):',
        'slideTop',
        'top',
        config.languageLabels.placeholderText
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerLeft || 'Posição Horizontal (%):',
        'slideLeft',
        'left',
        config.languageLabels.placeholderText
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerWidth || 'Largura (%):',
        'slideWidth',
        'width',
        config.languageLabels.placeholderText
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerHeight || 'Altura (%):',
        'slideHeight',
        'height',
        config.languageLabels.placeholderText
      )
    );

    var containers = [
      { type: 'logo', label: config.languageLabels.logoContainer || 'Contêiner da Logo', flexSettings: false, positionSettings: true },
      { type: 'meta', label: config.languageLabels.metaContainer || 'Contêiner de Metadados', flexSettings: true, positionSettings: true },
      { type: 'status', label: config.languageLabels.statusContainer || 'Posição do Status', flexSettings: true, positionSettings: true },
      { type: 'rating', label: config.languageLabels.ratingContainer || 'Posição da Nota', flexSettings: true, positionSettings: true },
      { type: 'plot', label: config.languageLabels.plotContainer || 'Contêiner da Sinopse', flexSettings: true, positionSettings: true },
      { type: 'title', label: config.languageLabels.titleContainer || 'Contêiner do Título', flexSettings: true, positionSettings: true },
      { type: 'director', label: config.languageLabels.directorContainer || 'Contêiner do Diretor', flexSettings: true, positionSettings: true },
      { type: 'info', label: config.languageLabels.infoContainer || 'Contêiner de Informações', flexSettings: true, positionSettings: true },
      { type: 'button', label: config.languageLabels.buttonContainer || 'Contêiner de Botões', flexSettings: true, positionSettings: true },
      { type: 'existingDot', label: config.languageLabels.dotContainer || 'Contêiner de Navegação', flexSettings: true, positionSettings: true },
      { type: 'provider', label: config.languageLabels.providerContainer || 'Contêiner de Provedores', flexSettings: true, positionSettings: true },
      { type: 'providericons', label: config.languageLabels.providericonsContainer || 'Posição dos Ícones de Provedores', flexSettings: true, positionSettings: false }
    ];

    containers.forEach(function(({ type, label, flexSettings, positionSettings }) {
      var header = document.createElement('h3');
      header.textContent = label;
      section.appendChild(header);

      if (positionSettings) {
        section.appendChild(
          createSettingItem(
            config.languageLabels.containerTop || 'Posição Vertical (%):',
            (type) + "ContainerTop",
            'top',
            config.languageLabels.placeholderText,
            type,
            type
          )
        );
        section.appendChild(
          createSettingItem(
            config.languageLabels.containerLeft || 'Posição Horizontal (%):',
            (type) + "ContainerLeft",
            'left',
            config.languageLabels.placeholderText,
            type,
            type
          )
        );
        section.appendChild(
          createSettingItem(
            config.languageLabels.containerWidth || 'Largura (%):',
            (type) + "ContainerWidth",
            'width',
            config.languageLabels.placeholderText,
            type,
            type
          )
        );
        section.appendChild(
          createSettingItem(
            config.languageLabels.containerHeight || 'Altura (%):',
            (type) + "ContainerHeight",
            'height',
            config.languageLabels.placeholderText,
            type,
            type
          )
        );
      }

      if (flexSettings) {
        section.appendChild(
          createFlexSettingItem(
            config.languageLabels.flexDisplay || 'Tipo de Exibição:',
            (type) + "ContainerDisplay",
            [
              { value: 'flex', label: config.languageLabels.flex || 'Flex' },
              { value: 'inline-flex', label: config.languageLabels.inlineFlex || 'Inline Flex' },
            ],
            type
          )
        );

        section.appendChild(
          createFlexSettingItem(
            config.languageLabels.flexDirection || 'Direção do Flex:',
            (type) + "ContainerFlexDirection",
            [
              { value: 'row', label: config.languageLabels.row || 'Row' },
              { value: 'column', label: config.languageLabels.column || 'Column' },
              { value: 'row-reverse', label: config.languageLabels.rowreverse || 'Row Reverse' },
              { value: 'column-reverse', label: config.languageLabels.columnreverse || 'Column Reverse' }
            ],
            type
          )
        );

        section.appendChild(
          createFlexSettingItem(
            config.languageLabels.justifyContent || 'Alinhamento do Eixo Principal:',
            (type) + "ContainerJustifyContent",
            [
              { value: 'flex-start', label: config.languageLabels.flexstart || 'Flex Start' },
              { value: 'flex-end', label: config.languageLabels.flexend || 'Flex End' },
              { value: 'center', label: config.languageLabels.center || 'Center' },
              { value: 'space-between', label: config.languageLabels.spacebetween || 'Space Between' },
              { value: 'space-around', label: config.languageLabels.spacearound || 'Space Around' },
              { value: 'space-evenly', label: config.languageLabels.spaceevenly || 'Space Evenly' }
            ],
            type
          )
        );

        section.appendChild(
          createFlexSettingItem(
            config.languageLabels.alignItems || 'Alinhamento do Eixo Transversal:',
            (type) + "ContainerAlignItems",
            [
              { value: 'flex-start', label: config.languageLabels.flexstart || 'Flex Start' },
              { value: 'flex-end', label: config.languageLabels.flexend || 'Flex End' },
              { value: 'center', label: config.languageLabels.center || 'Center' },
              { value: 'baseline', label: config.languageLabels.baseline || 'Baseline' },
              { value: 'stretch', label: config.languageLabels.stretch || 'Stretch' }
            ],
            type
          )
        );

        section.appendChild(
          createFlexSettingItem(
            config.languageLabels.flexWrap || 'Comportamento de Quebra:',
            (type) + "ContainerFlexWrap",
            [
              { value: 'nowrap', label: config.languageLabels.nowrap || 'No Wrap' },
              { value: 'wrap', label: config.languageLabels.wrap || 'Wrap' },
              { value: 'wrap-reverse', label: config.languageLabels.wrapreverse || 'Wrap Reverse' }
            ],
            type
          )
        );
      }
    });

    var sliderWrapperHeader = document.createElement('h3');
    sliderWrapperHeader.textContent = config.languageLabels.sliderWrapperContainer || 'Contêiner do Wrapper do Slider';
    section.appendChild(sliderWrapperHeader);

    section.appendChild(
      createSettingItem(
        config.languageLabels.containerTop || 'Posição Vertical (%):',
        'sliderContainerTop',
        'top',
        config.languageLabels.placeholderText,
        'slider',
        'slider'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerLeft || 'Posição Horizontal (%):',
        'sliderContainerLeft',
        'left',
        config.languageLabels.placeholderText,
        'slider',
        'slider'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerWidth || 'Largura (%):',
        'sliderContainerWidth',
        'width',
        config.languageLabels.placeholderText,
        'slider',
        'slider'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerHeight || 'Altura (%):',
        'sliderContainerHeight',
        'height',
        config.languageLabels.placeholderText,
        'slider',
        'slider'
      )
    );

    section.appendChild(
      createFlexSettingItem(
        config.languageLabels.flexDisplay || 'Tipo de Exibição:',
        'sliderContainerDisplay',
        [
          { value: 'flex', label: config.languageLabels.flex || 'Flex' },
          { value: 'inline-flex', label: config.languageLabels.inlineFlex || 'Inline Flex' },
        ],
        'slider'
      )
    );

    section.appendChild(
      createFlexSettingItem(
        config.languageLabels.flexDirection || 'Direção do Flex:',
        'sliderContainerFlexDirection',
        [
          { value: 'row', label: config.languageLabels.row || 'Row' },
          { value: 'column', label: config.languageLabels.column || 'Column' },
          { value: 'row-reverse', label: config.languageLabels.rowreverse || 'Row Reverse' },
          { value: 'column-reverse', label: config.languageLabels.columnreverse || 'Column Reverse' }
        ],
        'slider'
      )
    );

    section.appendChild(
      createFlexSettingItem(
        config.languageLabels.justifyContent || 'Alinhamento do Eixo Principal:',
        'sliderContainerJustifyContent',
        [
          { value: 'flex-start', label: config.languageLabels.flexstart || 'Flex Start' },
          { value: 'flex-end', label: config.languageLabels.flexend || 'Flex End' },
          { value: 'center', label: config.languageLabels.center || 'Center' },
          { value: 'space-between', label: config.languageLabels.spacebetween || 'Space Between' },
          { value: 'space-around', label: config.languageLabels.spacearound || 'Space Around' },
          { value: 'space-evenly', label: config.languageLabels.spaceevenly || 'Space Evenly' }
        ],
        'slider'
      )
    );

    section.appendChild(
      createFlexSettingItem(
        config.languageLabels.alignItems || 'Alinhamento do Eixo Transversal:',
        'sliderContainerAlignItems',
        [
          { value: 'flex-start', label: config.languageLabels.flexstart || 'Flex Start' },
          { value: 'flex-end', label: config.languageLabels.flexend || 'Flex End' },
          { value: 'center', label: config.languageLabels.center || 'Center' },
          { value: 'baseline', label: config.languageLabels.baseline || 'Baseline' },
          { value: 'stretch', label: config.languageLabels.stretch || 'Stretch' }
        ],
        'slider'
      )
    );

    section.appendChild(
      createFlexSettingItem(
        config.languageLabels.flexWrap || 'Comportamento de Quebra:',
        'sliderContainerFlexWrap',
        [
          { value: 'nowrap', label: config.languageLabels.nowrap || 'No Wrap' },
          { value: 'wrap', label: config.languageLabels.wrap || 'Wrap' },
          { value: 'wrap-reverse', label: config.languageLabels.wrapreverse || 'Wrap Reverse' }
        ],
        'slider'
      )
    );

var progressSecondsHeader = document.createElement('h3');
progressSecondsHeader.textContent = config.languageLabels.progressSecondsHeader || 'Contêiner de Progresso (Segundos)';
section.appendChild(progressSecondsHeader);

section.appendChild(
  createSettingItem(
    config.languageLabels.containerTop || 'Posição Vertical (%):',
    'progressSecondsTop',
    'top',
    config.languageLabels.placeholderText,
    'progress',
    'progressSeconds'
  )
);
section.appendChild(
  createSettingItem(
    config.languageLabels.containerLeft || 'Posição Horizontal (%):',
    'progressSecondsLeft',
    'left',
    config.languageLabels.placeholderText,
    'progress',
    'progressSeconds'
  )
);

    var progressBarHeader = document.createElement('h3');
    progressBarHeader.textContent = config.languageLabels.progressBarHeader || 'Contêiner de Progresso';
    section.appendChild(progressBarHeader);

    section.appendChild(
      createSettingItem(
        config.languageLabels.containerTop || 'Posição Vertical (%):',
        'progressBarTop',
        'top',
        config.languageLabels.placeholderText,
        'progress',
        'progress'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerLeft || 'Posição Horizontal (%):',
        'progressBarLeft',
        'left',
        config.languageLabels.placeholderText,
        'progress',
        'progress'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerWidth || 'Largura (%):',
        'progressBarWidth',
        'width',
        config.languageLabels.placeholderText,
        'progress',
        'progress'
      )
    );
    section.appendChild(
      createSettingItem(
        config.languageLabels.containerHeight || 'Altura (%):',
        'progressBarHeight',
        'height',
        config.languageLabels.placeholderText,
        'progress',
        'progress'
      )
    );
    return section;
  }

  return {
    render,
    updateContainerStyle,
    updateFlexStyle
  };
}

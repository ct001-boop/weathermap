const STORAGE_CHART_LAYERS_KEY = 'snowapp_chart_layers';

const DEFAULT_LAYER_VISIBILITY = {
  temp: true,
  snowline: true,
  precip: true,
  cloud: true,
  wind: false,
  cloudBase: false
};

function getLayerInputs() {
  return Array.from(document.querySelectorAll('#chartSettingsRow input[data-layer]'));
}

function loadLayerPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_CHART_LAYERS_KEY));
    return { ...DEFAULT_LAYER_VISIBILITY, ...(saved || {}) };
  } catch {
    return { ...DEFAULT_LAYER_VISIBILITY };
  }
}

function saveLayerPreferences() {
  const prefs = {};
  getLayerInputs().forEach((input) => {
    prefs[input.dataset.layer] = input.checked;
  });
  localStorage.setItem(STORAGE_CHART_LAYERS_KEY, JSON.stringify(prefs));
}

function refreshPillStates() {
  getLayerInputs().forEach((input) => {
    const pill = input.closest('.pill-toggle');
    if (pill) pill.classList.toggle('pill-toggle-active', input.checked);
  });
}

function applyLayerPreferences() {
  const prefs = loadLayerPreferences();

  getLayerInputs().forEach((input) => {
    const nextChecked = prefs[input.dataset.layer] !== false;
    if (input.checked !== nextChecked) {
      input.checked = nextChecked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  refreshPillStates();
}

function wireLayerMemory() {
  getLayerInputs().forEach((input) => {
    input.addEventListener('change', () => {
      saveLayerPreferences();
      refreshPillStates();
    });
  });

  applyLayerPreferences();

  // Re-apply shortly after the async forecast chart has rendered.
  window.setTimeout(applyLayerPreferences, 750);
  window.setTimeout(applyLayerPreferences, 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireLayerMemory);
} else {
  wireLayerMemory();
}

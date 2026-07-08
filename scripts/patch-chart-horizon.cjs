const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'src', 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');

const helperMarker = 'function getChartEndIndex()';
const helperBlock = `
function hasUsableChartValue(arr, i, key) {
  const value = arr?.[i];
  if (value == null || Number.isNaN(value)) return false;
  // Zero precipitation/snowfall bars should not extend the visible horizon,
  // otherwise the x-axis/slider carries on long after the real forecast lines end.
  if ((key === 'precip' || key === 'snowfall') && value <= 0) return false;
  return true;
}

function getChartEndIndex() {
  if (!currentData || !currentTimes.length) return 0;

  const arrays = {
    temp: currentData.temp,
    snowline: currentData.snowline,
    cloud: currentData.cloud,
    wind: currentData.wind,
    cloudBase: currentData.cloudBase,
    precip: currentData.precip,
    snowfall: currentData.snowfall
  };

  // Base the horizon on real visible data, prioritising continuous forecast
  // lines. Bars with zero values no longer keep the chart open artificially.
  const selected = getSelectedLayerKeys().filter((key) => arrays[key]);
  const selectedLineKeys = selected.filter((key) => key !== 'precip' && key !== 'snowfall');
  const keys = selectedLineKeys.length ? selectedLineKeys : (selected.length ? selected : ['temp', 'snowline', 'cloud']);

  let max = currentTimes.length - 1;
  if (currentMode === 'forecast' && !isPremium()) {
    max = Math.min(max, FREE_DAYS_VISIBLE * 24 - 1);
  }

  for (let i = max; i >= 0; i--) {
    if (keys.some((key) => hasUsableChartValue(arrays[key], i, key))) return i;
  }

  // Fallback: if the chosen model has no continuous series for some reason,
  // use the first timestamp rather than leaving a blank tail.
  return 0;
}

function visibleTimes() {
  return currentTimes.slice(0, getChartEndIndex() + 1);
}

function clipDatasetsForChart(datasets) {
  const end = getChartEndIndex() + 1;
  return datasets.map((dataset) => ({
    ...dataset,
    data: Array.isArray(dataset.data) ? dataset.data.slice(0, end) : dataset.data
  }));
}
`;

if (!source.includes(helperMarker)) {
  const insertAfter = `function applyFreeMask(a) {
  if (isPremium() || currentMode === 'archive') return a;
  return a.map((v, i) => i < FREE_DAYS_VISIBLE * 24 ? v : null);
}
`;
  if (!source.includes(insertAfter)) {
    console.warn('Could not find applyFreeMask insertion point.');
  } else {
    source = source.replace(insertAfter, insertAfter + helperBlock);
  }
}

source = source.replaceAll('const labels = currentTimes.map(hourlyLabel);', 'const labels = visibleTimes().map(hourlyLabel);');
source = source.replace('datasets: datasetDefs() }, options', 'datasets: clipDatasetsForChart(datasetDefs()) }, options');
source = source.replace(
  "datasets: datasetDefs().filter((d) => ['temp', 'snowline', undefined].includes(d._layerKey)) }, options: opt1",
  "datasets: clipDatasetsForChart(datasetDefs().filter((d) => ['temp', 'snowline', undefined].includes(d._layerKey))) }, options: opt1"
);

source = source.replace(
  `data: { labels, datasets: [
    { type: 'bar', label: 'Precipitation (mm)', data: currentData.precip.map((v) => v > 0 ? v : null), backgroundColor: 'rgba(0,128,0,0.45)', borderColor: 'green', yAxisID: 'yPrec2', _layerKey: 'precip' },
    { type: 'bar', label: 'Snowfall est. (cm)', data: currentData.snowfall.map((v) => v > 0 ? v : null), backgroundColor: 'rgba(0,155,255,0.38)', borderColor: '#008bd6', yAxisID: 'yPrec2', _layerKey: 'snowfall' },
    { type: 'line', label: 'Cloud Cover (%)', data: currentData.cloud, borderColor: 'gray', backgroundColor: 'transparent', yAxisID: 'yCloud2', pointRadius: 0, tension: 0.2, _layerKey: 'cloud' }
  ] }, options: opt2`,
  `data: { labels, datasets: clipDatasetsForChart([
    { type: 'bar', label: 'Precipitation (mm)', data: currentData.precip.map((v) => v > 0 ? v : null), backgroundColor: 'rgba(0,128,0,0.45)', borderColor: 'green', yAxisID: 'yPrec2', _layerKey: 'precip' },
    { type: 'bar', label: 'Snowfall est. (cm)', data: currentData.snowfall.map((v) => v > 0 ? v : null), backgroundColor: 'rgba(0,155,255,0.38)', borderColor: '#008bd6', yAxisID: 'yPrec2', _layerKey: 'snowfall' },
    { type: 'line', label: 'Cloud Cover (%)', data: currentData.cloud, borderColor: 'gray', backgroundColor: 'transparent', yAxisID: 'yCloud2', pointRadius: 0, tension: 0.2, _layerKey: 'cloud' }
  ]) }, options: opt2`
);

source = source.replace(
  `data: { labels, datasets: [
    { label: 'Wind speed (10 m, km/h)', data: currentData.wind, borderColor: 'purple', backgroundColor: 'transparent', yAxisID: 'yWind3', pointRadius: 0, tension: 0.2, _layerKey: 'wind' },
    { label: 'Cloud base (approx, m)', data: currentData.cloudBase, borderColor: 'orange', backgroundColor: 'transparent', yAxisID: 'yCloudBase3', pointRadius: 0, tension: 0.2, _layerKey: 'cloudBase' }
  ] }, options: opt3`,
  `data: { labels, datasets: clipDatasetsForChart([
    { label: 'Wind speed (10 m, km/h)', data: currentData.wind, borderColor: 'purple', backgroundColor: 'transparent', yAxisID: 'yWind3', pointRadius: 0, tension: 0.2, _layerKey: 'wind' },
    { label: 'Cloud base (approx, m)', data: currentData.cloudBase, borderColor: 'orange', backgroundColor: 'transparent', yAxisID: 'yCloudBase3', pointRadius: 0, tension: 0.2, _layerKey: 'cloudBase' }
  ]) }, options: opt3`
);

const oldSliderFunction = `function getSliderMaxIndex() {
  if (!currentData || !currentTimes.length) return 0;
  const arrays = {
    temp: currentData.temp,
    snowline: currentData.snowline,
    precip: currentData.precip,
    snowfall: currentData.snowfall,
    cloud: currentData.cloud,
    wind: currentData.wind,
    cloudBase: currentData.cloudBase
  };
  const selected = getSelectedLayerKeys().filter((key) => arrays[key]);
  const keys = selected.length ? selected : ['temp'];
  let max = currentTimes.length - 1;
  if (currentMode === 'forecast' && !isPremium()) max = Math.min(max, FREE_DAYS_VISIBLE * 24 - 1);
  for (let i = max; i >= 0; i--) {
    if (keys.some((key) => arrays[key][i] != null && !Number.isNaN(arrays[key][i]))) return i;
  }
  return max;
}`;
const newSliderFunction = `function getSliderMaxIndex() {
  return getChartEndIndex();
}`;
if (source.includes(oldSliderFunction)) {
  source = source.replace(oldSliderFunction, newSliderFunction);
}

fs.writeFileSync(mainPath, source);
console.log('Patched chart/slider horizon.');

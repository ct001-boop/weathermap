import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import Chart from 'chart.js/auto';
import noUiSlider from 'nouislider';
import 'nouislider/dist/nouislider.css';
import './styles.css';

const LAPSE_RATE = 0.0065;
const SNOWLINE_OFFSET = 300;
const TOTAL_FORECAST_DAYS = 16;
const FREE_DAYS_VISIBLE = 10;
const ARCHIVE_DAYS_BACK = 7;
const STORAGE_USERS_KEY = 'snowapp_users';
const STORAGE_CURRENT_KEY = 'snowapp_current_email';
const STORAGE_SPOTS_PREFIX = 'snowapp_spots_';
const STORAGE_MODEL_KEY = 'snowapp_forecast_model';
const STORAGE_BASEMAP_KEY = 'snowapp_basemap';
const STORAGE_GOOGLE_KEY = 'snowapp_google_maps_key';
const DEFAULT_LAT = 57.363;
const DEFAULT_LON = 13.545;
const DEFAULT_ZOOM = 7;

let chart = null;
let extraCharts = [];
let slider = null;
let currentData = null;
let currentTimes = [];
let leafletMarker = null;
let googleMarker = null;
let googleMap = null;
let googleMapsLoadingPromise = null;
let isLoading = false;
let lastLat = null;
let lastLon = null;
let currentMode = 'forecast';
let currentPlan = 'premium';
let currentUser = null;
let chartLayout = 'combined';
let currentForecastModel = 'openmeteo';
let userResizedDrawer = false;

const $ = (id) => document.getElementById(id);
const drawer = $('drawer');
const drawerGrab = $('drawerGrab');
const drawerContent = $('drawerContent');
const header = $('drawerHeader');
const closeBtn = $('closeBtn');
const placeNameEl = $('placeName');
const placeElevEl = $('placeElev');
const modeTagEl = $('modeTag');
const sliderEl = $('slider');
const summaryEl = $('summary');
const premiumOverlayEl = $('premiumOverlay');
const planBadgeEl = $('planBadge');
const loginBtn = $('loginBtn');
const planTestToggleBtn = $('planTestToggleBtn');
const adsBoxEl = $('adsBox');
const savedSpotsBoxEl = $('savedSpotsBox');
const savedSpotsListEl = $('savedSpotsList');
const checkAlertsBtn = $('checkAlertsBtn');
const alertsResultsEl = $('alertsResults');
const saveSpotSidebarBtn = $('saveSpotBtn');
const saveSpotChartBtn = $('saveSpotChartBtn');
const forecastModeBtn = $('forecastModeBtn');
const archiveModeBtn = $('archiveModeBtn');
const chartSettingsRow = $('chartSettingsRow');
const layerToggles = chartSettingsRow ? chartSettingsRow.querySelectorAll('input[data-layer]') : [];
const layoutRadios = document.querySelectorAll('input[name="chartLayout"]');
const modelSelect = $('modelSelect');
const basemapSelect = $('basemapSelect');
const googleKeyBox = $('googleKeyBox');
const googleApiKeyInput = $('googleApiKeyInput');
const saveGoogleKeyBtn = $('saveGoogleKeyBtn');
const authModal = $('authModal');
const authCloseBtn = $('authCloseBtn');
const tabLogin = $('tabLogin');
const tabSignup = $('tabSignup');
const loginForm = $('loginForm');
const signupForm = $('signupForm');
const loginEmailInput = $('loginEmail');
const loginPasswordInput = $('loginPassword');
const signupEmailInput = $('signupEmail');
const signupPasswordInput = $('signupPassword');

function setCollapsed(collapsed) {
  drawer.style.display = collapsed ? 'none' : 'flex';
  drawer.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
  if (!collapsed && !drawer.style.height) drawer.style.height = '320px';
}
setCollapsed(true);
header.addEventListener('click', () => setCollapsed(drawer.style.display === 'flex'));
closeBtn.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(true); });
function clampDrawerHeight(h) { return Math.max(380, Math.min(window.innerHeight - 200, h)); }
function getAllCharts() { return [chart, ...extraCharts].filter(Boolean); }
function resizeCharts() { getAllCharts().forEach((c) => c.resize()); setTimeout(alignSliderWithChart, 50); }
function fitDrawerToContent(force = false) {
  if (userResizedDrawer && !force) return;
  const headerH = (drawerGrab?.offsetHeight || 0) + (header?.offsetHeight || 0);
  drawer.style.height = `${clampDrawerHeight(Math.min(headerH + drawerContent.scrollHeight, window.innerHeight - 70))}px`;
  resizeCharts();
}
if (drawerGrab) {
  let dragging = false;
  let startY = 0;
  let startH = 0;
  drawerGrab.addEventListener('pointerdown', (e) => {
    dragging = true;
    userResizedDrawer = true;
    startY = e.clientY;
    startH = drawer.getBoundingClientRect().height;
    drawerGrab.setPointerCapture(e.pointerId);
  });
  drawerGrab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    drawer.style.height = `${clampDrawerHeight(startH + startY - e.clientY)}px`;
    resizeCharts();
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { drawerGrab.releasePointerCapture(e.pointerId); } catch {}
  };
  drawerGrab.addEventListener('pointerup', stop);
  drawerGrab.addEventListener('pointercancel', stop);
}

const map = L.map('map', { zoomControl: true }).setView([60, 13], 5);
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 });
const esriTopoLayer = L.tileLayer('https://server.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri', maxZoom: 19 });
const esriHillshadeLayer = L.tileLayer('https://server.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', { attribution: 'Hillshade &copy; Esri', maxZoom: 19, opacity: 0.35, className: 'hillshade-tiles' });
esriTopoLayer.addTo(map);
esriHillshadeLayer.addTo(map);
L.control.layers({ 'Esri Topo': esriTopoLayer, 'OpenStreetMap Street': streetLayer }, { 'Hillshade overlay': esriHillshadeLayer }).addTo(map);
function setLeafletBaseLayer(key) {
  [streetLayer, esriTopoLayer].forEach((layer) => map.removeLayer(layer));
  if (key === 'street') streetLayer.addTo(map); else esriTopoLayer.addTo(map);
  if (key === 'esriTopo' && !map.hasLayer(esriHillshadeLayer)) esriHillshadeLayer.addTo(map);
}
function placeMarker(lat, lon) {
  if (leafletMarker) map.removeLayer(leafletMarker);
  leafletMarker = L.marker([lat, lon]).addTo(map);
  if (googleMap && window.google?.maps) {
    const pos = { lat, lng: lon };
    if (!googleMarker) googleMarker = new google.maps.Marker({ position: pos, map: googleMap });
    else googleMarker.setPosition(pos);
  }
}
map.on('click', (ev) => loadDataAt(ev.latlng.lat, ev.latlng.lng, currentMode));

function getStoredGoogleKey() {
  try { return localStorage.getItem(STORAGE_GOOGLE_KEY) || ''; } catch { return ''; }
}
function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve();
  if (googleMapsLoadingPromise) return googleMapsLoadingPromise;
  googleMapsLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return googleMapsLoadingPromise;
}
async function showGoogleTerrain() {
  const key = getStoredGoogleKey();
  googleKeyBox.classList.remove('hidden');
  if (!key) {
    alert('Paste and save a Google Maps JavaScript API key first.');
    basemapSelect.value = 'esriTopo';
    return setBasemap('esriTopo');
  }
  await loadGoogleMaps(key);
  $('map').classList.add('hidden');
  $('googleMap').classList.remove('hidden');
  const center = lastLat != null ? { lat: lastLat, lng: lastLon } : { lat: DEFAULT_LAT, lng: DEFAULT_LON };
  if (!googleMap) {
    googleMap = new google.maps.Map($('googleMap'), {
      center,
      zoom: DEFAULT_ZOOM,
      mapTypeId: google.maps.MapTypeId.TERRAIN,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });
    googleMap.addListener('click', (e) => loadDataAt(e.latLng.lat(), e.latLng.lng(), currentMode));
  } else {
    googleMap.setCenter(center);
  }
  if (lastLat != null) placeMarker(lastLat, lastLon);
}
async function setBasemap(key) {
  try { localStorage.setItem(STORAGE_BASEMAP_KEY, key); } catch {}
  googleKeyBox.classList.toggle('hidden', key !== 'googleTerrain');
  if (key === 'googleTerrain') return showGoogleTerrain();
  $('googleMap').classList.add('hidden');
  $('map').classList.remove('hidden');
  setLeafletBaseLayer(key);
  setTimeout(() => map.invalidateSize(), 50);
}
basemapSelect.addEventListener('change', () => setBasemap(basemapSelect.value));
saveGoogleKeyBtn.addEventListener('click', () => {
  try { localStorage.setItem(STORAGE_GOOGLE_KEY, googleApiKeyInput.value.trim()); } catch {}
  alert('Google key saved.');
  if (basemapSelect.value === 'googleTerrain') setBasemap('googleTerrain');
});

function loadUsers() { try { return JSON.parse(localStorage.getItem(STORAGE_USERS_KEY) || '[]'); } catch { return []; } }
function saveUsers(users) { localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(users)); }
function getCurrentUserFromStorage() {
  const email = localStorage.getItem(STORAGE_CURRENT_KEY);
  return loadUsers().find((u) => u.email === email) || null;
}
function setCurrentUser(user) {
  if (user) localStorage.setItem(STORAGE_CURRENT_KEY, user.email);
  else localStorage.removeItem(STORAGE_CURRENT_KEY);
  currentUser = user;
  renderSavedSpots();
}
function isPremium() { return currentPlan === 'premium'; }
function ensureLoggedIn() { if (currentUser) return true; openAuthModal(); return false; }
function getSpotsStorageKey(email) { return `${STORAGE_SPOTS_PREFIX}${email}`; }
function loadSavedSpots() {
  if (!currentUser) return [];
  try { return JSON.parse(localStorage.getItem(getSpotsStorageKey(currentUser.email)) || '[]'); } catch { return []; }
}
function saveSavedSpots(spots) {
  if (currentUser) localStorage.setItem(getSpotsStorageKey(currentUser.email), JSON.stringify(spots));
}
function updatePlanUI() {
  const premium = isPremium();
  planBadgeEl.textContent = premium ? 'Premium' : 'Free';
  planBadgeEl.classList.toggle('badge-premium', premium);
  planBadgeEl.classList.toggle('badge-free', !premium);
  planTestToggleBtn.textContent = premium ? 'Switch back to Free test view' : 'Switch to Premium test view';
  adsBoxEl.classList.toggle('hidden', premium);
  savedSpotsBoxEl.classList.toggle('hidden', !premium);
  chartSettingsRow.classList.toggle('hidden', !premium);
  archiveModeBtn.classList.toggle('chip-disabled', !premium);
  [saveSpotSidebarBtn, saveSpotChartBtn].forEach((b) => b?.classList.toggle('btn-disabled', !premium));
  if (!premium) chartLayout = 'combined';
}

function hourlyLabel(d) { return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`; }
function dayLabelShort(d) { return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}`; }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function sum(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) : 0; }
function computeCloudBase(temp, dew, gridElev) {
  return temp.map((t, i) => t == null || dew[i] == null ? null : Math.max(0, gridElev + 125 * (t - dew[i])));
}
function normalizeForecastModelKey(v) { return ['openmeteo', 'ecmwf', 'icon'].includes(v) ? v : 'openmeteo'; }
function loadForecastModelFromStorage() { try { return normalizeForecastModelKey(localStorage.getItem(STORAGE_MODEL_KEY)); } catch { return 'openmeteo'; } }
function modelParam(key) { if (key === 'ecmwf') return 'ecmwf_ifs'; if (key === 'icon') return 'icon_seamless'; return ''; }
function arr(h, ...names) { for (const n of names) if (Array.isArray(h[n])) return h[n]; return []; }
async function fetchForecastData(lat, lon, modelKey = currentForecastModel) {
  const models = modelParam(modelKey);
  let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,cloud_cover,precipitation,wind_speed_10m,dew_point_2m,freezing_level_height&forecast_days=${TOTAL_FORECAST_DAYS}&timezone=auto`;
  if (models) url += `&models=${encodeURIComponent(models)}`;
  return normalizeWeatherResponse((await axios.get(url)).data);
}
async function fetchArchiveData(lat, lon, daysBack) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - daysBack);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,cloud_cover,precipitation,wind_speed_10m,dew_point_2m&start_date=${fmt(start)}&end_date=${fmt(end)}&timezone=auto`;
  return normalizeWeatherResponse((await axios.get(url)).data);
}
function normalizeWeatherResponse(data) {
  const h = data.hourly || {};
  const times = arr(h, 'time').map((t) => new Date(t));
  const n = times.length;
  const gridElev = data.elevation ?? 0;
  const pad = (a) => Array.from({ length: n }, (_, i) => a[i] ?? null);
  const temp = pad(arr(h, 'temperature_2m'));
  const cloud = pad(arr(h, 'cloud_cover', 'cloudcover'));
  const precip = pad(arr(h, 'precipitation'));
  const wind = pad(arr(h, 'wind_speed_10m', 'windspeed_10m'));
  const dew = pad(arr(h, 'dew_point_2m', 'dewpoint_2m'));
  const freezing = pad(arr(h, 'freezing_level_height'));
  const snowline = temp.map((t, i) => freezing[i] != null ? Math.max(0, freezing[i] - SNOWLINE_OFFSET) : (t == null ? null : Math.max(0, gridElev + t / LAPSE_RATE - SNOWLINE_OFFSET)));
  return { times, temp, cloud, precip, wind, dew, snowline, cloudBase: computeCloudBase(temp, dew, gridElev), gridElev };
}
async function loadDataAt(lat, lon, mode = 'forecast') {
  if (isLoading) return;
  isLoading = true;
  placeMarker(lat, lon);
  lastLat = lat;
  lastLon = lon;
  placeNameEl.textContent = 'Loading…';
  placeElevEl.textContent = '';
  summaryEl.innerHTML = '';
  modeTagEl.textContent = mode === 'archive' ? 'Archive' : 'Forecast';
  try {
    const data = mode === 'archive' ? await fetchArchiveData(lat, lon, ARCHIVE_DAYS_BACK) : await fetchForecastData(lat, lon, currentForecastModel);
    currentTimes = data.times;
    currentData = { ...data, placeName: `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}` };
    placeNameEl.textContent = currentData.placeName;
    placeElevEl.textContent = `Grid elevation: ${Math.round(data.gridElev)} m`;
    currentMode = mode;
    buildChart();
    buildSlider();
    updateSummary(0, currentTimes.length - 1);
    fitDrawerToContent(false);
    setCollapsed(false);
  } catch (err) {
    console.error(err);
    placeNameEl.textContent = 'Error loading data';
    summaryEl.innerHTML = '<span style="color:crimson">Failed to load data</span>';
  } finally {
    isLoading = false;
  }
}

function applyFreeMask(a) { if (isPremium() || currentMode === 'archive') return a; return a.map((v, i) => i < FREE_DAYS_VISIBLE * 24 ? v : null); }
function destroyCharts() { if (chart) chart.destroy(); extraCharts.forEach((c) => c.destroy()); chart = null; extraCharts = []; }
function tooltipHandler(context) {
  const { chart: ch, tooltip } = context;
  let el = $('chartTooltip');
  if (!el) { el = document.createElement('div'); el.id = 'chartTooltip'; el.className = 'chart-tooltip'; document.body.appendChild(el); }
  if (!tooltip || tooltip.opacity === 0) { el.style.opacity = 0; return; }
  const lines = (tooltip.dataPoints || []).filter((dp) => dp.dataset.label !== '0°C').map((dp) => `<div class="chart-tooltip-line">${dp.dataset.label}: ${dp.formattedValue}</div>`).join('');
  el.innerHTML = `<div class="chart-tooltip-title">${tooltip.title?.[0] || ''}</div>${lines}`;
  el.style.opacity = 1;
  const r = ch.canvas.getBoundingClientRect();
  const px = r.left + scrollX + tooltip.caretX;
  const py = r.top + scrollY + tooltip.caretY;
  const off = 14;
  const pad = 6;
  let x = px + off;
  if (x + el.offsetWidth + pad > scrollX + innerWidth) x = px - el.offsetWidth - off;
  x = Math.max(scrollX + pad, x);
  let y = py - el.offsetHeight / 2;
  y = Math.max(scrollY + pad, Math.min(scrollY + innerHeight - el.offsetHeight - pad, y));
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}
const baseChartOptions = () => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { position: 'top' }, tooltip: { enabled: false, external: tooltipHandler } },
  scales: { x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16, callback: (_, i) => currentTimes[i]?.getHours() === 0 ? dayLabelShort(currentTimes[i]) : '' } } }
});
function datasetsCombined() {
  const ds = [
    { label: 'Temperature (°C)', data: applyFreeMask([...currentData.temp]), borderColor: 'red', backgroundColor: 'transparent', yAxisID: 'yTemp', pointRadius: 0, tension: 0.2, _layerKey: 'temp' },
    { label: 'Snowline (approx, m)', data: applyFreeMask([...currentData.snowline]), borderColor: 'blue', backgroundColor: 'transparent', yAxisID: 'ySnow', pointRadius: 0, tension: 0.2, _layerKey: 'snowline' },
    { label: '0°C', data: new Array(currentData.temp.length).fill(0), borderColor: 'black', borderDash: [4, 4], pointRadius: 0, yAxisID: 'yTemp' },
    { label: 'Cloud Cover (%)', data: applyFreeMask([...currentData.cloud]), borderColor: 'gray', backgroundColor: 'transparent', yAxisID: 'yCloud', pointRadius: 0, tension: 0.2, _layerKey: 'cloud' },
    { type: 'bar', label: 'Precipitation (mm)', data: applyFreeMask(currentData.precip.map((v) => v > 0 ? v : null)), backgroundColor: 'rgba(0,128,0,0.45)', borderColor: 'green', yAxisID: 'yPrec', barPercentage: 0.8, categoryPercentage: 1, _layerKey: 'precip' }
  ];
  if (isPremium()) ds.push(
    { label: 'Wind speed (10 m, km/h)', data: [...currentData.wind], borderColor: 'purple', backgroundColor: 'transparent', yAxisID: 'yWind', pointRadius: 0, tension: 0.2, _layerKey: 'wind' },
    { label: 'Cloud base (approx, m)', data: [...currentData.cloudBase], borderColor: 'orange', backgroundColor: 'transparent', yAxisID: 'yCloudBase', pointRadius: 0, tension: 0.2, _layerKey: 'cloudBase' }
  );
  return ds;
}
function buildChart() {
  if (!currentData || !currentTimes.length) return;
  destroyCharts();
  if (!isPremium() || chartLayout === 'combined') buildCombinedChart(); else buildSplitCharts();
  premiumOverlayEl.classList.toggle('hidden', isPremium() || currentMode !== 'forecast' || chartLayout !== 'combined');
  if (isPremium()) updateLayerVisibility();
  setTimeout(alignSliderWithChart, 50);
}
function buildCombinedChart() {
  const labels = currentTimes.map(hourlyLabel);
  $('weatherChart').classList.remove('hidden');
  $('weatherChart2').classList.add('hidden');
  $('weatherChart3').classList.add('hidden');
  const options = baseChartOptions();
  options.scales = { ...options.scales, yTemp: { type: 'linear', position: 'left', title: { display: true, text: '°C' } }, yCloud: { type: 'linear', position: 'right', display: false, grid: { drawOnChartArea: false } }, yPrec: { type: 'linear', position: 'right', title: { display: true, text: 'mm' }, grid: { drawOnChartArea: false } }, ySnow: { type: 'linear', position: 'right', title: { display: true, text: 'Snowline (m, approx)' }, grid: { drawOnChartArea: false } }, yWind: { type: 'linear', position: 'right', display: false, grid: { drawOnChartArea: false } }, yCloudBase: { type: 'linear', position: 'right', display: false, grid: { drawOnChartArea: false } } };
  chart = new Chart($('weatherChart').getContext('2d'), { type: 'line', data: { labels, datasets: datasetsCombined() }, options });
}
function buildSplitCharts() {
  const labels = currentTimes.map(hourlyLabel);
  $('weatherChart').classList.remove('hidden');
  $('weatherChart2').classList.remove('hidden');
  $('weatherChart3').classList.remove('hidden');
  const opt1 = baseChartOptions();
  opt1.scales = { ...opt1.scales, yTemp: { type: 'linear', position: 'left', title: { display: true, text: '°C' } }, ySnow: { type: 'linear', position: 'right', title: { display: true, text: 'Snowline (m)' }, grid: { drawOnChartArea: false } } };
  chart = new Chart($('weatherChart').getContext('2d'), { type: 'line', data: { labels, datasets: datasetsCombined().filter((d) => ['temp', 'snowline', undefined].includes(d._layerKey)) }, options: opt1 });
  const opt2 = baseChartOptions();
  opt2.scales = { ...opt2.scales, yPrec2: { type: 'linear', position: 'left', title: { display: true, text: 'mm' } }, yCloud2: { type: 'linear', position: 'right', title: { display: true, text: 'Cloud cover (%)' }, grid: { drawOnChartArea: false } } };
  const c2 = new Chart($('weatherChart2').getContext('2d'), { type: 'bar', data: { labels, datasets: [{ type: 'bar', label: 'Precipitation (mm)', data: currentData.precip.map((v) => v > 0 ? v : null), backgroundColor: 'rgba(0,128,0,0.45)', borderColor: 'green', yAxisID: 'yPrec2', _layerKey: 'precip' }, { type: 'line', label: 'Cloud Cover (%)', data: currentData.cloud, borderColor: 'gray', backgroundColor: 'transparent', yAxisID: 'yCloud2', pointRadius: 0, tension: 0.2, _layerKey: 'cloud' }] }, options: opt2 });
  const opt3 = baseChartOptions();
  opt3.scales = { ...opt3.scales, yWind3: { type: 'linear', position: 'left', title: { display: true, text: 'km/h' } }, yCloudBase3: { type: 'linear', position: 'right', title: { display: true, text: 'Cloud base (m)' }, grid: { drawOnChartArea: false } } };
  const c3 = new Chart($('weatherChart3').getContext('2d'), { type: 'line', data: { labels, datasets: [{ label: 'Wind speed (10 m, km/h)', data: currentData.wind, borderColor: 'purple', backgroundColor: 'transparent', yAxisID: 'yWind3', pointRadius: 0, tension: 0.2, _layerKey: 'wind' }, { label: 'Cloud base (approx, m)', data: currentData.cloudBase, borderColor: 'orange', backgroundColor: 'transparent', yAxisID: 'yCloudBase3', pointRadius: 0, tension: 0.2, _layerKey: 'cloudBase' }] }, options: opt3 });
  extraCharts = [c2, c3];
}
function updateLayerVisibility() {
  getAllCharts().forEach((ch) => {
    layerToggles.forEach((input) => ch.data.datasets.forEach((ds) => { if (ds._layerKey === input.dataset.layer) ds.hidden = !input.checked; }));
    ch.update('none');
  });
}
layerToggles.forEach((i) => i.addEventListener('change', updateLayerVisibility));
layoutRadios.forEach((r) => r.addEventListener('change', () => {
  if (!r.checked || !isPremium()) return;
  chartLayout = r.value;
  buildChart();
  buildSlider();
  updateSummary(0, currentTimes.length - 1);
  fitDrawerToContent(false);
}));
function alignSliderWithChart() {
  if (!chart?.chartArea) return;
  const a = chart.chartArea;
  const w = $('sliderWrapper');
  w.style.width = `${a.right - a.left}px`;
  w.style.marginLeft = `${a.left}px`;
}
function highlightRangeOnChart(s, e) {
  getAllCharts().forEach((ch) => {
    ch.data.datasets.forEach((ds) => {
      if (ds.type !== 'bar') ds.backgroundColor = ch.data.labels.map((_, i) => i >= s && i <= e ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0)');
    });
    ch.update('none');
  });
}
function buildSlider() {
  if (!currentTimes.length) return;
  if (slider) slider.destroy();
  let max = currentTimes.length - 1;
  if (currentMode === 'forecast' && !isPremium()) max = Math.min(max, FREE_DAYS_VISIBLE * 24 - 1);
  slider = noUiSlider.create(sliderEl, { start: [0, max], connect: true, step: 1, range: { min: 0, max }, tooltips: [{ to: (v) => currentTimes[Math.round(v)] ? hourlyLabel(currentTimes[Math.round(v)]) : '' }, { to: (v) => currentTimes[Math.round(v)] ? hourlyLabel(currentTimes[Math.round(v)]) : '' }] });
  slider.on('update', (v) => highlightRangeOnChart(Math.round(v[0]), Math.round(v[1])));
  slider.on('change', (v) => updateSummary(Math.round(v[0]), Math.round(v[1])));
}
function updateSummary(start, end) {
  if (!currentData) return;
  const idx = [];
  for (let i = start; i <= end && i < currentData.temp.length; i++) if (!(currentMode === 'forecast' && !isPremium() && i >= FREE_DAYS_VISIBLE * 24)) idx.push(i);
  const pick = (a) => idx.map((i) => a[i]).filter((v) => v != null && !Number.isNaN(v));
  const temps = pick(currentData.temp);
  const clouds = pick(currentData.cloud);
  const precs = pick(currentData.precip);
  const snows = pick(currentData.snowline);
  const winds = pick(currentData.wind);
  const bases = pick(currentData.cloudBase);
  const avgTemp = avg(temps);
  const avgCloud = avg(clouds);
  const avgSnow = avg(snows);
  const avgWind = avg(winds);
  const avgBase = avg(bases);
  summaryEl.innerHTML = `<div class="legend-item"><span class="legend-swatch" style="background:red"></span>Average Temp: <strong>${avgTemp == null ? '—' : avgTemp.toFixed(1) + ' °C'}</strong></div><div class="legend-item"><span class="legend-swatch" style="background:gray"></span>Average Cloud: <strong>${avgCloud == null ? '—' : avgCloud.toFixed(1) + ' %'}</strong></div><div class="legend-item"><span class="legend-swatch" style="background:green"></span>Total Precip: <strong>${sum(precs).toFixed(1)} mm</strong></div>${isPremium() ? `<div class="legend-item"><span class="legend-swatch" style="background:#555"></span>Average Wind: <strong>${avgWind == null ? '—' : avgWind.toFixed(1) + ' km/h'}</strong></div>` : ''}<div class="summary-meta">Average snowline (approx): <strong>${avgSnow == null ? '—' : Math.round(avgSnow) + ' m'}</strong></div>${isPremium() ? `<div class="summary-meta">Average cloud base (approx): <strong>${avgBase == null ? '—' : Math.round(avgBase) + ' m'}</strong></div>` : ''}<div class="summary-meta">Hours at or below 0°C: <strong>${temps.filter((t) => t <= 0).length}</strong></div><div class="summary-meta">Selected: ${hourlyLabel(currentTimes[start])} → ${hourlyLabel(currentTimes[end])} (${idx.length} hours)</div>`;
}

function openAuthModal() { authModal.classList.remove('hidden'); authModal.setAttribute('aria-hidden', 'false'); }
function closeAuthModal() { authModal.classList.add('hidden'); authModal.setAttribute('aria-hidden', 'true'); }
authCloseBtn.addEventListener('click', closeAuthModal);
authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });
tabLogin.addEventListener('click', () => { tabLogin.classList.add('tab-active'); tabSignup.classList.remove('tab-active'); loginForm.classList.remove('hidden'); signupForm.classList.add('hidden'); });
tabSignup.addEventListener('click', () => { tabSignup.classList.add('tab-active'); tabLogin.classList.remove('tab-active'); signupForm.classList.remove('hidden'); loginForm.classList.add('hidden'); });
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const u = loadUsers().find((x) => x.email === loginEmailInput.value.trim().toLowerCase() && x.password === loginPasswordInput.value);
  if (!u) return alert('Invalid credentials');
  setCurrentUser(u);
  closeAuthModal();
});
signupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = signupEmailInput.value.trim().toLowerCase();
  const password = signupPasswordInput.value;
  const users = loadUsers();
  if (users.some((u) => u.email === email)) return alert('An account with this email already exists.');
  const u = { email, password };
  users.push(u);
  saveUsers(users);
  setCurrentUser(u);
  closeAuthModal();
});
loginBtn.addEventListener('click', openAuthModal);
planTestToggleBtn.addEventListener('click', () => {
  currentPlan = currentPlan === 'free' ? 'premium' : 'free';
  updatePlanUI();
  if (lastLat != null) loadDataAt(lastLat, lastLon, currentMode);
});
modelSelect.addEventListener('change', () => {
  currentForecastModel = normalizeForecastModelKey(modelSelect.value);
  localStorage.setItem(STORAGE_MODEL_KEY, currentForecastModel);
  if (lastLat != null && currentMode === 'forecast') loadDataAt(lastLat, lastLon, 'forecast');
});
function handleSaveSpot() {
  if (!currentData || lastLat == null) return alert('Load a location first.');
  const name = prompt('Name this spot') || currentData.placeName;
  const snowlineBelow = Number(prompt('Notify when snowline is BELOW this elevation (m). Leave blank for no rule.') || NaN);
  const precipAtLeast = Number(prompt('Notify when precipitation is AT LEAST this amount (mm/h). Leave blank for no rule.') || NaN);
  const spots = loadSavedSpots();
  spots.push({ id: Date.now(), name, lat: lastLat, lon: lastLon, rules: { snowlineBelow: isFinite(snowlineBelow) ? snowlineBelow : null, precipAtLeast: isFinite(precipAtLeast) ? precipAtLeast : null } });
  saveSavedSpots(spots);
  renderSavedSpots();
}
saveSpotSidebarBtn.addEventListener('click', () => { if (ensureLoggedIn()) handleSaveSpot(); });
saveSpotChartBtn.addEventListener('click', () => { if (ensureLoggedIn()) handleSaveSpot(); });
function renderSavedSpots() {
  const spots = loadSavedSpots();
  if (!spots.length) { savedSpotsListEl.innerHTML = '<div class="small muted">No saved spots yet.</div>'; return; }
  savedSpotsListEl.innerHTML = spots.map((s) => `<div class="spot-item"><div class="spot-title-row"><div class="spot-name">${s.name}</div><div class="spot-actions"><button data-load="${s.id}">Load</button><button data-del="${s.id}">Delete</button></div></div><div class="small muted">${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}</div></div>`).join('');
  savedSpotsListEl.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
    const s = loadSavedSpots().find((x) => x.id === Number(b.dataset.load));
    if (s) loadDataAt(s.lat, s.lon, 'forecast');
  }));
  savedSpotsListEl.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    saveSavedSpots(loadSavedSpots().filter((x) => x.id !== Number(b.dataset.del)));
    renderSavedSpots();
  }));
}
checkAlertsBtn.addEventListener('click', async () => {
  if (!ensureLoggedIn()) return;
  const spots = loadSavedSpots();
  if (!spots.length) { alertsResultsEl.textContent = 'No saved spots to check.'; return; }
  alertsResultsEl.textContent = 'Checking…';
  const lines = [];
  for (const s of spots) {
    const d = await fetchForecastData(s.lat, s.lon);
    const hit = d.times.findIndex((_, i) => (s.rules.snowlineBelow == null || d.snowline[i] < s.rules.snowlineBelow) && (s.rules.precipAtLeast == null || d.precip[i] >= s.rules.precipAtLeast));
    if (hit >= 0) lines.push(`• ${s.name}: ${hourlyLabel(d.times[hit])} — T ${d.temp[hit]?.toFixed(1)} °C, snowline ~${d.snowline[hit]?.toFixed(0)} m, precip ${d.precip[hit]?.toFixed(1)} mm/h`);
  }
  alertsResultsEl.textContent = lines.join('\n') || 'No upcoming hours match your rules.';
});
forecastModeBtn.addEventListener('click', () => {
  forecastModeBtn.classList.add('chip-active');
  archiveModeBtn.classList.remove('chip-active');
  currentMode = 'forecast';
  modeTagEl.textContent = 'Forecast';
  if (lastLat != null) loadDataAt(lastLat, lastLon, 'forecast');
});
archiveModeBtn.addEventListener('click', () => {
  if (!isPremium()) return alert('Archive view is a Premium feature.');
  archiveModeBtn.classList.add('chip-active');
  forecastModeBtn.classList.remove('chip-active');
  currentMode = 'archive';
  modeTagEl.textContent = 'Archive';
  if (lastLat != null) loadDataAt(lastLat, lastLon, 'archive');
});
window.addEventListener('resize', () => setTimeout(alignSliderWithChart, 50));

(async function init() {
  currentUser = getCurrentUserFromStorage();
  updatePlanUI();
  renderSavedSpots();
  currentForecastModel = loadForecastModelFromStorage();
  modelSelect.value = currentForecastModel;
  googleApiKeyInput.value = getStoredGoogleKey();
  const basemap = localStorage.getItem(STORAGE_BASEMAP_KEY) || 'esriTopo';
  basemapSelect.value = basemap;
  map.setView([DEFAULT_LAT, DEFAULT_LON], DEFAULT_ZOOM);
  await setBasemap(basemap);
  await loadDataAt(DEFAULT_LAT, DEFAULT_LON, 'forecast');
})();

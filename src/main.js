import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import Chart from 'chart.js/auto';
import noUiSlider from 'nouislider';
import 'nouislider/dist/nouislider.css';
import { SKI_RESORTS } from './ski-resorts.js';
import './styles.css';
import './ui-enhancements.css';

const LAPSE_RATE = 0.0065;
const SNOWLINE_OFFSET = 300;
const TOTAL_FORECAST_DAYS = 16;
const FREE_DAYS_VISIBLE = 10;
const ARCHIVE_DAYS_BACK = 7;
const DEFAULT_LAT = 57.363;
const DEFAULT_LON = 13.545;
const DEFAULT_ZOOM = 7;
const STORAGE_USERS_KEY = 'snowapp_users';
const STORAGE_CURRENT_KEY = 'snowapp_current_email';
const STORAGE_SPOTS_PREFIX = 'snowapp_spots_';
const STORAGE_MODEL_KEY = 'snowapp_forecast_model';
const STORAGE_LAYERS_KEY = 'snowapp_chart_layers';
const STORAGE_LAST_LOCATION_KEY = 'snowapp_last_location';

let chart = null;
let extraCharts = [];
let slider = null;
let currentData = null;
let currentTimes = [];
let clickMarker = null;
let isLoading = false;
let lastLat = null;
let lastLon = null;
let lastPlaceLabel = null;
let currentMode = 'forecast';
let currentPlan = 'premium';
let currentUser = null;
let chartLayout = 'combined';
let currentForecastModel = 'openmeteo';
let userResizedDrawer = false;
let searchAbortController = null;
let skiResortLayer = null;
let renderedResortMarkers = [];

const $ = (id) => document.getElementById(id);
const drawer = $('drawer');
const drawerGrab = $('drawerGrab');
const drawerContent = $('drawerContent');
const header = $('drawerHeader');
const closeBtn = $('closeBtn');
const placeNameEl = $('placeName');
const placeElevEl = $('placeElev');
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
const layerToggles = chartSettingsRow ? Array.from(chartSettingsRow.querySelectorAll('input[data-layer]')) : [];
const layoutRadios = Array.from(document.querySelectorAll('input[name="chartLayout"]'));
const modelSelect = $('modelSelect');
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
const placeSearchForm = $('placeSearchForm');
const placeSearchInput = $('placeSearchInput');
const placeSearchResults = $('placeSearchResults');

function safeGetJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function safeSetJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function hourlyLabel(d) {
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`;
}
function dayLabelShort(d) {
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}`;
}
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function sum(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) : 0; }

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

const map = L.map('map', { zoomControl: true }).setView([DEFAULT_LAT, DEFAULT_LON], DEFAULT_ZOOM);
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 });
const esriTopoLayer = L.tileLayer('https://server.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri', maxZoom: 19 });
const esriHillshadeLayer = L.tileLayer('https://server.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', { attribution: 'Hillshade &copy; Esri', maxZoom: 19, opacity: 0.35, className: 'hillshade-tiles' });
esriTopoLayer.addTo(map);
esriHillshadeLayer.addTo(map);
skiResortLayer = L.layerGroup().addTo(map);
L.control.layers(
  { 'Esri Topo': esriTopoLayer, 'OpenStreetMap Street': streetLayer },
  { 'Hillshade overlay': esriHillshadeLayer, 'Ski resorts': skiResortLayer },
  { collapsed: true }
).addTo(map);

const weatherPinIcon = L.divIcon({ className: 'weather-pin-icon', html: '⌖', iconSize: [30, 30], iconAnchor: [15, 15] });
const skiIcon = L.divIcon({ className: 'ski-resort-icon', html: '⛰', iconSize: [24, 24], iconAnchor: [12, 12] });
function placeMarker(lat, lon) {
  if (clickMarker) map.removeLayer(clickMarker);
  clickMarker = L.marker([lat, lon], { icon: weatherPinIcon }).addTo(map);
}
map.on('click', (ev) => loadDataAt(ev.latlng.lat, ev.latlng.lng, currentMode));

function renderSkiResorts() {
  if (!skiResortLayer || !map.hasLayer(skiResortLayer)) return;
  skiResortLayer.clearLayers();
  renderedResortMarkers = [];
  const zoom = map.getZoom();
  if (zoom < 5) return;
  const bounds = map.getBounds().pad(0.25);
  const priorityLimit = zoom < 6 ? 1 : zoom < 7 ? 2 : 99;
  const maxMarkers = zoom < 6 ? 25 : zoom < 7 ? 70 : 500;
  const visible = SKI_RESORTS
    .filter((r) => r.priority <= priorityLimit && bounds.contains([r.lat, r.lon]))
    .slice(0, maxMarkers);
  visible.forEach((resort) => {
    const marker = L.marker([resort.lat, resort.lon], { icon: skiIcon, title: resort.name })
      .bindPopup(`<div class="resort-popup-title">${resort.name}</div><div class="resort-popup-meta">${resort.country}</div><div class="resort-popup-note">Click the mountain icon to load this forecast.</div>`)
      .on('click', () => {
        map.setView([resort.lat, resort.lon], Math.max(map.getZoom(), 9));
        loadDataAt(resort.lat, resort.lon, 'forecast', resort.name);
      });
    marker.addTo(skiResortLayer);
    renderedResortMarkers.push(marker);
  });
}
map.on('zoomend moveend overlayadd overlayremove', renderSkiResorts);
setTimeout(renderSkiResorts, 250);

function loadUsers() { return safeGetJson(STORAGE_USERS_KEY, []); }
function saveUsers(users) { safeSetJson(STORAGE_USERS_KEY, users); }
function getCurrentUserFromStorage() {
  try {
    const email = localStorage.getItem(STORAGE_CURRENT_KEY);
    return loadUsers().find((u) => u.email === email) || null;
  } catch { return null; }
}
function setCurrentUser(user) {
  try {
    if (user) localStorage.setItem(STORAGE_CURRENT_KEY, user.email);
    else localStorage.removeItem(STORAGE_CURRENT_KEY);
  } catch {}
  currentUser = user;
  renderSavedSpots();
}
function isPremium() { return currentPlan === 'premium'; }
function ensureLoggedIn() { if (currentUser) return true; openAuthModal(); return false; }
function getSpotsStorageKey(email) { return `${STORAGE_SPOTS_PREFIX}${email}`; }
function loadSavedSpots() {
  if (!currentUser) return [];
  return safeGetJson(getSpotsStorageKey(currentUser.email), []);
}
function saveSavedSpots(spots) {
  if (currentUser) safeSetJson(getSpotsStorageKey(currentUser.email), spots);
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

const DEFAULT_LAYER_VISIBILITY = { temp: true, snowline: true, precip: true, snowfall: true, cloud: true, wind: false, cloudBase: false };
function getLayerPrefs() { return { ...DEFAULT_LAYER_VISIBILITY, ...safeGetJson(STORAGE_LAYERS_KEY, {}) }; }
function saveLayerPrefs() {
  const prefs = {};
  layerToggles.forEach((input) => { prefs[input.dataset.layer] = input.checked; });
  safeSetJson(STORAGE_LAYERS_KEY, prefs);
}
function restoreLayerPrefs() {
  const prefs = getLayerPrefs();
  layerToggles.forEach((input) => { input.checked = prefs[input.dataset.layer] !== false; });
  refreshPillStates();
}
function refreshPillStates() {
  layerToggles.forEach((input) => input.closest('.pill-toggle')?.classList.toggle('pill-toggle-active', input.checked));
  layoutRadios.forEach((input) => input.closest('.pill-toggle')?.classList.toggle('pill-toggle-active', input.checked));
}
restoreLayerPrefs();

function normalizeForecastModelKey(v) { return ['openmeteo', 'ecmwf', 'icon'].includes(v) ? v : 'openmeteo'; }
function loadForecastModelFromStorage() {
  try { return normalizeForecastModelKey(localStorage.getItem(STORAGE_MODEL_KEY)); } catch { return 'openmeteo'; }
}
function modelParam(key) {
  if (key === 'ecmwf') return 'ecmwf_ifs';
  if (key === 'icon') return 'icon_seamless';
  return '';
}
function arr(h, ...names) {
  for (const n of names) if (Array.isArray(h[n])) return h[n];
  return [];
}
function computeCloudBase(temp, dew, gridElev) {
  return temp.map((t, i) => t == null || dew[i] == null ? null : Math.max(0, gridElev + 125 * (t - dew[i])));
}
function computeSnowfall(precip, temp, snowline, gridElev) {
  return precip.map((p, i) => {
    if (p == null || p <= 0) return 0;
    const t = temp[i];
    const sl = snowline[i];
    const coldEnoughAtGrid = t != null && t <= 0.8;
    const gridAboveSnowline = sl != null && gridElev >= sl;
    const marginal = t != null && t > 0.8 && t <= 1.8;
    if (gridAboveSnowline || coldEnoughAtGrid) return p * 1.0;
    if (marginal) return p * 0.5;
    return 0;
  });
}
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
  const snowfall = computeSnowfall(precip, temp, snowline, gridElev);
  return { times, temp, cloud, precip, wind, dew, snowline, snowfall, cloudBase: computeCloudBase(temp, dew, gridElev), gridElev };
}
function saveLastLocation(lat, lon, label) {
  safeSetJson(STORAGE_LAST_LOCATION_KEY, { lat, lon, label: label || `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`, zoom: map.getZoom(), savedAt: Date.now() });
}
function getLastLocation() { return safeGetJson(STORAGE_LAST_LOCATION_KEY, null); }
async function loadDataAt(lat, lon, mode = 'forecast', label = null) {
  if (isLoading) return;
  isLoading = true;
  placeMarker(lat, lon);
  lastLat = lat;
  lastLon = lon;
  lastPlaceLabel = label;
  placeNameEl.textContent = 'Loading…';
  placeElevEl.textContent = '';
  summaryEl.innerHTML = '';
  try {
    const data = mode === 'archive' ? await fetchArchiveData(lat, lon, ARCHIVE_DAYS_BACK) : await fetchForecastData(lat, lon, currentForecastModel);
    currentTimes = data.times;
    currentData = { ...data, placeName: label || `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}` };
    placeNameEl.textContent = currentData.placeName;
    placeElevEl.textContent = `Grid elevation: ${Math.round(data.gridElev)} m`;
    currentMode = mode;
    saveLastLocation(lat, lon, currentData.placeName);
    buildChart();
    buildSlider();
    updateSummary(0, getSliderMaxIndex());
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

function applyFreeMask(a) {
  if (isPremium() || currentMode === 'archive') return a;
  return a.map((v, i) => i < FREE_DAYS_VISIBLE * 24 ? v : null);
}
function destroyCharts() {
  if (chart) chart.destroy();
  extraCharts.forEach((c) => c.destroy());
  chart = null;
  extraCharts = [];
}
function tooltipHandler(context) {
  const { chart: ch, tooltip } = context;
  let el = $('chartTooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chartTooltip';
    el.className = 'chart-tooltip';
    document.body.appendChild(el);
  }
  if (!tooltip || tooltip.opacity === 0) { el.style.opacity = 0; return; }
  const lines = (tooltip.dataPoints || [])
    .filter((dp) => dp.dataset.label !== '0°C')
    .map((dp) => `<div class="chart-tooltip-line">${dp.dataset.label}: ${dp.formattedValue}</div>`)
    .join('');
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
function datasetDefs() {
  const ds = [
    { label: 'Temperature (°C)', data: applyFreeMask([...currentData.temp]), borderColor: 'red', backgroundColor: 'transparent', yAxisID: 'yTemp', pointRadius: 0, tension: 0.2, _layerKey: 'temp' },
    { label: 'Snowline (approx, m)', data: applyFreeMask([...currentData.snowline]), borderColor: 'blue', backgroundColor: 'transparent', yAxisID: 'ySnow', pointRadius: 0, tension: 0.2, _layerKey: 'snowline' },
    { label: '0°C', data: new Array(currentData.temp.length).fill(0), borderColor: 'black', borderDash: [4, 4], pointRadius: 0, yAxisID: 'yTemp' },
    { label: 'Cloud Cover (%)', data: applyFreeMask([...currentData.cloud]), borderColor: 'gray', backgroundColor: 'transparent', yAxisID: 'yCloud', pointRadius: 0, tension: 0.2, _layerKey: 'cloud' },
    { type: 'bar', label: 'Precipitation (mm)', data: applyFreeMask(currentData.precip.map((v) => v > 0 ? v : null)), backgroundColor: 'rgba(0,128,0,0.45)', borderColor: 'green', yAxisID: 'yPrec', barPercentage: 0.8, categoryPercentage: 1, _layerKey: 'precip' },
    { type: 'bar', label: 'Snowfall est. (cm)', data: applyFreeMask(currentData.snowfall.map((v) => v > 0 ? v : null)), backgroundColor: 'rgba(0,155,255,0.38)', borderColor: '#008bd6', yAxisID: 'ySnowfall', barPercentage: 0.8, categoryPercentage: 1, _layerKey: 'snowfall' }
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
  updateLayerVisibility(false);
  setTimeout(alignSliderWithChart, 50);
}
function buildCombinedChart() {
  const labels = currentTimes.map(hourlyLabel);
  $('weatherChart').classList.remove('hidden');
  $('weatherChart2').classList.add('hidden');
  $('weatherChart3').classList.add('hidden');
  const options = baseChartOptions();
  options.scales = {
    ...options.scales,
    yTemp: { type: 'linear', position: 'left', title: { display: true, text: '°C' } },
    yCloud: { type: 'linear', position: 'right', display: false, grid: { drawOnChartArea: false } },
    yPrec: { type: 'linear', position: 'right', title: { display: true, text: 'mm / cm' }, grid: { drawOnChartArea: false } },
    ySnowfall: { type: 'linear', position: 'right', display: false, grid: { drawOnChartArea: false } },
    ySnow: { type: 'linear', position: 'right', title: { display: true, text: 'Snowline (m, approx)' }, grid: { drawOnChartArea: false } },
    yWind: { type: 'linear', position: 'right', display: false, grid: { drawOnChartArea: false } },
    yCloudBase: { type: 'linear', position: 'right', display: false, grid: { drawOnChartArea: false } }
  };
  chart = new Chart($('weatherChart').getContext('2d'), { type: 'line', data: { labels, datasets: datasetDefs() }, options });
}
function buildSplitCharts() {
  const labels = currentTimes.map(hourlyLabel);
  $('weatherChart').classList.remove('hidden');
  $('weatherChart2').classList.remove('hidden');
  $('weatherChart3').classList.remove('hidden');
  const opt1 = baseChartOptions();
  opt1.scales = { ...opt1.scales, yTemp: { type: 'linear', position: 'left', title: { display: true, text: '°C' } }, ySnow: { type: 'linear', position: 'right', title: { display: true, text: 'Snowline (m)' }, grid: { drawOnChartArea: false } } };
  chart = new Chart($('weatherChart').getContext('2d'), { type: 'line', data: { labels, datasets: datasetDefs().filter((d) => ['temp', 'snowline', undefined].includes(d._layerKey)) }, options: opt1 });
  const opt2 = baseChartOptions();
  opt2.scales = { ...opt2.scales, yPrec2: { type: 'linear', position: 'left', title: { display: true, text: 'mm / cm' } }, yCloud2: { type: 'linear', position: 'right', title: { display: true, text: 'Cloud cover (%)' }, grid: { drawOnChartArea: false } } };
  const c2 = new Chart($('weatherChart2').getContext('2d'), { type: 'bar', data: { labels, datasets: [
    { type: 'bar', label: 'Precipitation (mm)', data: currentData.precip.map((v) => v > 0 ? v : null), backgroundColor: 'rgba(0,128,0,0.45)', borderColor: 'green', yAxisID: 'yPrec2', _layerKey: 'precip' },
    { type: 'bar', label: 'Snowfall est. (cm)', data: currentData.snowfall.map((v) => v > 0 ? v : null), backgroundColor: 'rgba(0,155,255,0.38)', borderColor: '#008bd6', yAxisID: 'yPrec2', _layerKey: 'snowfall' },
    { type: 'line', label: 'Cloud Cover (%)', data: currentData.cloud, borderColor: 'gray', backgroundColor: 'transparent', yAxisID: 'yCloud2', pointRadius: 0, tension: 0.2, _layerKey: 'cloud' }
  ] }, options: opt2 });
  const opt3 = baseChartOptions();
  opt3.scales = { ...opt3.scales, yWind3: { type: 'linear', position: 'left', title: { display: true, text: 'km/h' } }, yCloudBase3: { type: 'linear', position: 'right', title: { display: true, text: 'Cloud base (m)' }, grid: { drawOnChartArea: false } } };
  const c3 = new Chart($('weatherChart3').getContext('2d'), { type: 'line', data: { labels, datasets: [
    { label: 'Wind speed (10 m, km/h)', data: currentData.wind, borderColor: 'purple', backgroundColor: 'transparent', yAxisID: 'yWind3', pointRadius: 0, tension: 0.2, _layerKey: 'wind' },
    { label: 'Cloud base (approx, m)', data: currentData.cloudBase, borderColor: 'orange', backgroundColor: 'transparent', yAxisID: 'yCloudBase3', pointRadius: 0, tension: 0.2, _layerKey: 'cloudBase' }
  ] }, options: opt3 });
  extraCharts = [c2, c3];
}
function updateLayerVisibility(rebuildSlider = true) {
  refreshPillStates();
  getAllCharts().forEach((ch) => {
    layerToggles.forEach((input) => ch.data.datasets.forEach((ds) => { if (ds._layerKey === input.dataset.layer) ds.hidden = !input.checked; }));
    ch.update('none');
  });
  if (rebuildSlider && currentTimes.length) {
    buildSlider();
    updateSummary(0, getSliderMaxIndex());
  }
}
layerToggles.forEach((i) => i.addEventListener('change', () => {
  saveLayerPrefs();
  updateLayerVisibility(true);
}));
layoutRadios.forEach((r) => r.addEventListener('change', () => {
  if (!r.checked || !isPremium()) return;
  chartLayout = r.value;
  refreshPillStates();
  buildChart();
  buildSlider();
  updateSummary(0, getSliderMaxIndex());
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
function getSelectedLayerKeys() {
  return layerToggles.filter((input) => input.checked).map((input) => input.dataset.layer);
}
function getSliderMaxIndex() {
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
}
function buildSlider() {
  if (!currentTimes.length) return;
  if (slider) slider.destroy();
  const max = getSliderMaxIndex();
  slider = noUiSlider.create(sliderEl, {
    start: [0, max],
    connect: true,
    step: 1,
    range: { min: 0, max: Math.max(max, 1) },
    tooltips: [
      { to: (v) => currentTimes[Math.round(v)] ? hourlyLabel(currentTimes[Math.round(v)]) : '' },
      { to: (v) => currentTimes[Math.round(v)] ? hourlyLabel(currentTimes[Math.round(v)]) : '' }
    ]
  });
  slider.on('update', (v) => highlightRangeOnChart(Math.round(v[0]), Math.round(v[1])));
  slider.on('change', (v) => updateSummary(Math.round(v[0]), Math.round(v[1])));
}
function updateSummary(start, end) {
  if (!currentData) return;
  const idx = [];
  const max = Math.min(end, getSliderMaxIndex());
  for (let i = start; i <= max && i < currentData.temp.length; i++) idx.push(i);
  const pick = (a) => idx.map((i) => a[i]).filter((v) => v != null && !Number.isNaN(v));
  const temps = pick(currentData.temp);
  const clouds = pick(currentData.cloud);
  const precs = pick(currentData.precip);
  const snows = pick(currentData.snowline);
  const snowfalls = pick(currentData.snowfall);
  const winds = pick(currentData.wind);
  const bases = pick(currentData.cloudBase);
  const avgTemp = avg(temps);
  const avgCloud = avg(clouds);
  const avgSnow = avg(snows);
  const avgWind = avg(winds);
  const avgBase = avg(bases);
  summaryEl.innerHTML = `<div class="legend-item"><span class="legend-swatch" style="background:red"></span>Average Temp: <strong>${avgTemp == null ? '—' : avgTemp.toFixed(1) + ' °C'}</strong></div><div class="legend-item"><span class="legend-swatch" style="background:gray"></span>Average Cloud: <strong>${avgCloud == null ? '—' : avgCloud.toFixed(1) + ' %'}</strong></div><div class="legend-item"><span class="legend-swatch" style="background:green"></span>Total Precip: <strong>${sum(precs).toFixed(1)} mm</strong></div><div class="legend-item"><span class="legend-swatch" style="background:#009bff"></span>Snowfall est.: <strong>${sum(snowfalls).toFixed(1)} cm</strong></div>${isPremium() ? `<div class="legend-item"><span class="legend-swatch" style="background:#555"></span>Average Wind: <strong>${avgWind == null ? '—' : avgWind.toFixed(1) + ' km/h'}</strong></div>` : ''}<div class="summary-meta">Average snowline (approx): <strong>${avgSnow == null ? '—' : Math.round(avgSnow) + ' m'}</strong></div>${isPremium() ? `<div class="summary-meta">Average cloud base (approx): <strong>${avgBase == null ? '—' : Math.round(avgBase) + ' m'}</strong></div>` : ''}<div class="summary-meta">Hours at or below 0°C: <strong>${temps.filter((t) => t <= 0).length}</strong></div><div class="summary-meta">Selected: ${hourlyLabel(currentTimes[start])} → ${hourlyLabel(currentTimes[max])} (${idx.length} hours)</div>`;
}

async function searchPlaces(query) {
  if (!query.trim()) return [];
  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, { signal: searchAbortController.signal });
  if (!resp.ok) throw new Error('Place search failed');
  return resp.json();
}
function hideSearchResults() { placeSearchResults.classList.add('hidden'); placeSearchResults.innerHTML = ''; }
function renderSearchResults(results) {
  if (!results.length) {
    placeSearchResults.innerHTML = '<div class="search-result-item">No places found</div>';
    placeSearchResults.classList.remove('hidden');
    return;
  }
  placeSearchResults.innerHTML = results.map((r, i) => `<button class="search-result-item" type="button" data-index="${i}"><div class="search-result-title">${r.name || r.display_name.split(',')[0]}</div><div class="search-result-meta">${r.display_name}</div></button>`).join('');
  placeSearchResults.classList.remove('hidden');
  placeSearchResults.querySelectorAll('[data-index]').forEach((btn) => btn.addEventListener('click', () => {
    const r = results[Number(btn.dataset.index)];
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    const label = r.name || r.display_name.split(',')[0];
    map.setView([lat, lon], 10);
    loadDataAt(lat, lon, 'forecast', label);
    hideSearchResults();
  }));
}
placeSearchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = placeSearchInput.value.trim();
  if (!query) return;
  placeSearchResults.innerHTML = '<div class="search-result-item">Searching…</div>';
  placeSearchResults.classList.remove('hidden');
  try {
    const results = await searchPlaces(query);
    renderSearchResults(results);
    if (results.length === 1) placeSearchResults.querySelector('[data-index="0"]')?.click();
  } catch (err) {
    if (err.name !== 'AbortError') {
      placeSearchResults.innerHTML = '<div class="search-result-item">Search failed. Try again.</div>';
      placeSearchResults.classList.remove('hidden');
    }
  }
});
document.addEventListener('click', (e) => { if (!placeSearchForm.contains(e.target)) hideSearchResults(); });

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
  if (lastLat != null) loadDataAt(lastLat, lastLon, currentMode, lastPlaceLabel);
});
modelSelect.addEventListener('change', () => {
  currentForecastModel = normalizeForecastModelKey(modelSelect.value);
  try { localStorage.setItem(STORAGE_MODEL_KEY, currentForecastModel); } catch {}
  if (lastLat != null && currentMode === 'forecast') loadDataAt(lastLat, lastLon, 'forecast', lastPlaceLabel);
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
    if (s) { map.setView([s.lat, s.lon], 10); loadDataAt(s.lat, s.lon, 'forecast', s.name); }
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
    if (hit >= 0) lines.push(`• ${s.name}: ${hourlyLabel(d.times[hit])} — T ${d.temp[hit]?.toFixed(1)} °C, snowline ~${d.snowline[hit]?.toFixed(0)} m, precip ${d.precip[hit]?.toFixed(1)} mm/h, snow ${d.snowfall[hit]?.toFixed(1)} cm`);
  }
  alertsResultsEl.textContent = lines.join('\n') || 'No upcoming hours match your rules.';
});
forecastModeBtn.addEventListener('click', () => {
  forecastModeBtn.classList.add('chip-active');
  archiveModeBtn.classList.remove('chip-active');
  currentMode = 'forecast';
  if (lastLat != null) loadDataAt(lastLat, lastLon, 'forecast', lastPlaceLabel);
});
archiveModeBtn.addEventListener('click', () => {
  if (!isPremium()) return alert('Archive view is a Premium feature.');
  archiveModeBtn.classList.add('chip-active');
  forecastModeBtn.classList.remove('chip-active');
  currentMode = 'archive';
  if (lastLat != null) loadDataAt(lastLat, lastLon, 'archive', lastPlaceLabel);
});
window.addEventListener('resize', () => setTimeout(alignSliderWithChart, 50));

(async function init() {
  currentUser = getCurrentUserFromStorage();
  updatePlanUI();
  renderSavedSpots();
  currentForecastModel = loadForecastModelFromStorage();
  modelSelect.value = currentForecastModel;
  refreshPillStates();
  const saved = getLastLocation();
  const lat = typeof saved?.lat === 'number' ? saved.lat : DEFAULT_LAT;
  const lon = typeof saved?.lon === 'number' ? saved.lon : DEFAULT_LON;
  const zoom = typeof saved?.zoom === 'number' ? saved.zoom : DEFAULT_ZOOM;
  const label = saved?.label || null;
  map.setView([lat, lon], zoom);
  await loadDataAt(lat, lon, 'forecast', label);
})();

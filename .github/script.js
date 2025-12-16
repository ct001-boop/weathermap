// ---------- Config ----------
const LAPSE_RATE = 0.0065;     // °C per meter (standard atmosphere approx)
const SNOWLINE_OFFSET = 300;   // metres below freezing level (very rough)

// ---------- State ----------
let chart=null, slider=null, currentData=null, currentTimes=[], clickMarker=null;
let isLoading = false; // in-flight guard

// DOM
const drawer = document.getElementById('drawer');
const drawerContent = document.getElementById('drawerContent');
const header = document.getElementById('drawerHeader');
const closeBtn = document.getElementById('closeBtn');
const placeNameEl = document.getElementById('placeName');
const placeElevEl = document.getElementById('placeElev');
const sliderEl = document.getElementById('slider');
const summaryEl = document.getElementById('summary');

// ---------- Drawer handling ----------
function setCollapsed(collapsed){
  if(collapsed){
    drawer.style.display='none';
    drawer.setAttribute('aria-hidden','true');
  } else {
    drawer.style.display='flex';
    drawer.setAttribute('aria-hidden','false');
  }
}
setCollapsed(true);

// Drawer toggle handlers
header.addEventListener('click', ()=>setCollapsed(drawer.style.display==='flex'));
closeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); setCollapsed(true); });

// ---------- Map ----------
const map = L.map('map').setView([60,13],5);

// Street layer
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
});

// Topo layer (default)
const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenTopoMap & OpenStreetMap contributors',
  maxZoom: 17
});

// Add default layer
topoLayer.addTo(map);

// Layer control
const baseMaps = {
  "Street": streetLayer,
  "Topo": topoLayer
};
L.control.layers(baseMaps).addTo(map);

// ---------- Marker helper ----------
function placeMarker(lat,lon){
  if(clickMarker) map.removeLayer(clickMarker);
  clickMarker = L.marker([lat,lon]).addTo(map);
}

// ---------- Helpers ----------
function hourlyLabel(d){
  return d.toLocaleDateString(undefined,{weekday:'short'}) + ' ' +
         d.getDate() + ' ' +
         String(d.getHours()).padStart(2,'0') + ':00';
}
function dayLabelShort(d){
  return d.toLocaleDateString(undefined,{weekday:'short'}) + ' ' + d.getDate();
}
function highlightRangeOnChart(s,e){
  if(!chart) return;
  chart.data.datasets.forEach(ds=>{
    if(ds.type === 'bar') return;
    ds.backgroundColor = chart.data.labels.map((_,i)=>
      (i>=s && i<=e) ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0)'
    );
  });
  chart.update('none');
}
function alignSliderWithChart(){
  if(!chart) return;
  const area = chart.chartArea;
  if(!area) return;
  const wrapper = document.getElementById('sliderWrapper');
  wrapper.style.width = (area.right - area.left) + 'px';
  wrapper.style.marginLeft = area.left + 'px';
}

// ---------- Load data (derive snowline from temp + elevation) ----------
async function loadDataAt(lat, lon){
  if (isLoading) return;
  isLoading = true;

  placeMarker(lat, lon);
  placeNameEl.textContent='Loading…';
  placeElevEl.textContent='';
  summaryEl.innerHTML='';

  try {
    const furl = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,cloudcover,precipitation` +
      `&forecast_days=16&timezone=auto`;

    const fresp = await axios.get(furl);

    // Model grid elevation at this point
    const gridElev = fresp.data.elevation ?? 0;
    let placeName = `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`;

    const h = fresp.data.hourly;
    currentTimes = h.time.map(t => new Date(t));

    const temp    = h.temperature_2m;
    const cloud   = h.cloudcover;
    const precip  = h.precipitation;

    // --- Derive snowline from surface temp + grid elevation ---
    const snowline = temp.map(t => {
      if (t == null || Number.isNaN(t)) return null;

      // Approx freezing level height above sea level
      const freezingLevel = gridElev + (t / LAPSE_RATE); // metres
      const approxSnowline = freezingLevel - SNOWLINE_OFFSET;

      // Clamp at sea level
      return Math.max(0, approxSnowline);
    });

    currentData = {
      temp,
      cloud,
      precip,
      snowline,
      gridElev,
      placeName
    };

    placeNameEl.textContent = placeName;
    placeElevEl.textContent = `Grid elevation: ${Math.round(gridElev)} m`;

    buildChart();
    buildSlider();
    updateSummary(0, currentTimes.length - 1);
    setCollapsed(false);
  } catch(err){
    console.error(err);
    placeNameEl.textContent='Error loading data';
    placeElevEl.textContent='';
    summaryEl.innerHTML='<span style="color:crimson">Failed to load data</span>';
  } finally {
    isLoading = false;
  }
}

// ---------- Chart (snowline axis & line) ----------
function buildChart(){
  const ctx = document.getElementById('weatherChart').getContext('2d');
  if(chart) chart.destroy();

  const labels = currentTimes.map(d => hourlyLabel(d));

  chart = new Chart(ctx,{
    type:'line',
    data:{
      labels,
      datasets:[
        {
          label:'Temperature (°C)',
          data: currentData.temp,
          borderColor:'red',
          backgroundColor:'transparent',
          yAxisID:'yTemp',
          pointRadius:0,
          tension:0.2
        },
        {
          label:'Snowline (approx, m)',
          data: currentData.snowline,
          borderColor:'blue',
          backgroundColor:'transparent',
          yAxisID:'ySnow',
          pointRadius:0,
          tension:0.2
        },
        {
          label:'0°C',
          data:new Array(currentData.temp.length).fill(0),
          borderColor:'black',
          borderDash:[4,4],
          pointRadius:0,
          yAxisID:'yTemp'
        },
        {
          label:'Cloud Cover (%)',
          data: currentData.cloud,
          borderColor:'gray',
          backgroundColor:'transparent',
          yAxisID:'yCloud',
          pointRadius:0,
          tension:0.2
        },
        {
          type:'bar',
          label:'Precipitation (mm)',
          data: currentData.precip.map(v => v>0 ? v : null),
          backgroundColor:'rgba(0,128,0,0.45)',
          borderColor:'green',
          yAxisID:'yPrec',
          barPercentage:0.8,
          categoryPercentage:1.0
        }
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top'}},
      scales:{
        x:{
          ticks:{
            maxRotation:0,
            autoSkip:true,
            maxTicksLimit:16,
            callback:function(val,idx){
              const d=currentTimes[idx];
              return d.getHours()===0 ? dayLabelShort(d) : '';
            }
          }
        },
        yTemp:{
          type:'linear',
          position:'left',
          title:{display:true,text:'°C'}
        },
        // Cloud axis (hidden, just for scaling)
        yCloud:{
          type:'linear',
          position:'right',
          display:false,
          grid:{drawOnChartArea:false}
        },
        // Precip axis (bars)
        yPrec:{
          type:'linear',
          position:'right',
          title:{display:true,text:'mm'},
          grid:{drawOnChartArea:false},
          offset:true
        },
        // Snowline axis
        ySnow:{
          type:'linear',
          position:'right',
          title:{display:true,text:'Snowline (m, approx)'},
          grid:{drawOnChartArea:false}
        }
      }
    }
  });

  setTimeout(alignSliderWithChart,100);
}

// ---------- Slider ----------
function buildSlider(){
  if(!currentTimes || currentTimes.length===0) return;
  if(slider){ try{ slider.destroy(); } catch(e){} }

  slider = noUiSlider.create(sliderEl,{
    start:[0,currentTimes.length-1],
    connect:true,
    step:1,
    range:{min:0,max:currentTimes.length-1},
    tooltips:[
      {
        to: v => {
          const i = Math.round(v);
          if(!currentTimes[i]) return '';
          const d = currentTimes[i];
          return `${d.toLocaleDateString(undefined,{weekday:'short'})} ${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00`;
        }
      },
      {
        to: v => {
          const i = Math.round(v);
          if(!currentTimes[i]) return '';
          const d = currentTimes[i];
          return `${d.toLocaleDateString(undefined,{weekday:'short'})} ${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00`;
        }
      }
    ]
  });

  slider.on('update',(values)=>{
    const s=Math.round(values[0]), e=Math.round(values[1]);
    highlightRangeOnChart(s,e);
  });
  slider.on('change',(values)=>{
    const s=Math.round(values[0]), e=Math.round(values[1]);
    updateSummary(s,e);
  });
}

// ---------- Summary (uses snowline) ----------
function updateSummary(start,end){
  const tempSlice   = currentData.temp.slice(start,end+1);
  const cloudSlice  = currentData.cloud.slice(start,end+1);
  const precipSlice = currentData.precip.slice(start,end+1);
  const snowSliceRaw = currentData.snowline
    ? currentData.snowline.slice(start,end+1)
    : [];

  const avgTemp  = tempSlice.reduce((a,b)=>a+b,0) / tempSlice.length;
  const avgCloud = cloudSlice.reduce((a,b)=>a+b,0) / cloudSlice.length;
  const totalPrecip = precipSlice.reduce((a,b)=>a+b,0);

  const freezingHours = tempSlice.filter(t => t <= 0).length;
  const hours = end - start + 1;

  const startLabel = hourlyLabel(currentTimes[start]);
  const endLabel   = hourlyLabel(currentTimes[end]);

  // Average snowline, ignoring nulls
  const snowSlice = snowSliceRaw.filter(v => v != null && !Number.isNaN(v));
  let snowMeta = '';
  if (snowSlice.length > 0) {
    const avgSnow = snowSlice.reduce((a,b)=>a+b,0) / snowSlice.length;
    snowMeta = `<div class="summary-meta">Average snowline (approx): <strong>${Math.round(avgSnow)} m</strong></div>`;
  }

  summaryEl.innerHTML = `
    <div class="legend-item"><span class="legend-swatch" style="background:red"></span>Average Temp: <strong>${avgTemp.toFixed(1)} °C</strong></div>
    <div class="legend-item"><span class="legend-swatch" style="background:gray"></span>Average Cloud: <strong>${avgCloud.toFixed(1)} %</strong></div>
    <div class="legend-item"><span class="legend-swatch" style="background:green"></span>Total Precip: <strong>${totalPrecip.toFixed(1)} mm</strong></div>
    ${snowMeta}
    <div class="summary-meta">Hours at or below 0°C in selection: <strong>${freezingHours}</strong></div>
    <div class="summary-meta">Selected: ${startLabel} → ${endLabel} (${hours} hours)</div>
  `;
}

// ---------- Map click ----------
map.on('click', ev => loadDataAt(ev.latlng.lat, ev.latlng.lng));

// ---------- Window resize ----------
window.addEventListener('resize', ()=> setTimeout(alignSliderWithChart,100));

// ---------- Init ----------
(async function init(){
  const lat=57.363, lon=13.545;
  map.setView([lat, lon],7);
  await loadDataAt(lat, lon);
})();

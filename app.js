// ==========================================
// CONFIGURATION
// ==========================================
const trackFiles = [
    { id: 'track1', name: 'Track April 30 (GT corrected)', url: 'Bike_2026-04-30_18-28_webapp.geojson' },
    { id: 'track2', name: 'Track May 02 (13:43)', url: 'Bike_2026-05-02_13-43_webapp.geojson' },
    { id: 'track3', name: 'Track May 02 (14:01)', url: 'Bike_2026-05-02_14-01_webapp.geojson' },
    { id: 'track4', name: 'Track May 02 (14:13)', url: 'Bike_2026-05-02_14-13_webapp.geojson' }
];

// --- 1. MAP SETUP ---
const map = L.map('map', { zoomControl: false }).setView([47.2, 8.7], 13);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 120 }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors, &copy; swisstopo'
}).addTo(map);

map.createPane('swisstopoPane'); map.getPane('swisstopoPane').style.zIndex = 400;
map.createPane('senseboxPane');  map.getPane('senseboxPane').style.zIndex = 410;
map.createPane('resultPane');    map.getPane('resultPane').style.zIndex = 420;

let currentMode = 'raw'; 
let isColorblind = false;
let currentLayerControl = null;
let legendControl = null;

const loadedTracksData = {};
const activeTrackLayers = {
    swisstopo: L.layerGroup(), senseboxKnown: L.layerGroup(), senseboxUnknown: L.layerGroup(),
    resultMatch: L.layerGroup(), resultMismatch: L.layerGroup()
};

// --- 2. FARBEN ---
function getTopoColor(surface) { return surface === 'paved' ? '#a7a7a7' : surface === 'nature' ? (isColorblind ? '#56B4E9' : '#03fb6f') : '#e0e0e0'; }
function getSenseboxColor(surface) { return surface === 'paved' ? '#696969' : surface === 'nature' ? (isColorblind ? '#0072B2' : '#06632e') : (isColorblind ? '#F0E442' : '#fec44f'); }
function getResultColor(isMatchStr) { return isMatchStr === 'True' ? (isColorblind ? '#0072B2' : '#1a9641') : isMatchStr === 'False' ? (isColorblind ? '#D55E00' : '#d7191c') : '#aaaaaa'; }

// --- 3. POPUPS ---
function bindDetailedPopup(feature, layer) {
    const p = feature.properties;
    const matchVal = p.match !== undefined ? p.match : p.is_match;
    const matchText = matchVal === 'True' ? "✅ Correct" : matchVal === 'False' ? "❌ Wrong" : "❓ Unknown";
    layer.bindPopup(`<div style="font-family: Arial, sans-serif; font-size: 13px;">
        <h4 style="margin: 0 0 8px 0; border-bottom: 1px solid #ccc; padding-bottom: 4px;">${matchText}</h4>
        <b>swisstopo:</b> ${p.surface_swisstopo}<br><b>SenseBox AI:</b> ${p.surface_sensebox}<br>
        <span style="color: #666; font-size: 11px;">Probability: ${(p.surface_sensebox_probability * 100).toFixed(1)}%</span></div>`);
}

// --- 4. LAYER ENGINE ---
function createLayersForData(data) {
    const layers = {};
    layers.swisstopo = L.geoJSON(data, { pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'swisstopoPane', radius: 6, weight: 1, fillOpacity: 0.8 }), style: (f) => ({ fillColor: getTopoColor(f.properties.surface_swisstopo), color: getTopoColor(f.properties.surface_swisstopo) }), onEachFeature: bindDetailedPopup });
    layers.senseboxKnown = L.geoJSON(data, { filter: (f) => f.properties.surface_sensebox !== 'unknown', pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'senseboxPane', radius: 3, weight: 0.5, fillOpacity: 1 }), style: (f) => ({ fillColor: getSenseboxColor(f.properties.surface_sensebox), color: getSenseboxColor(f.properties.surface_sensebox) }), onEachFeature: bindDetailedPopup });
    layers.senseboxUnknown = L.geoJSON(data, { filter: (f) => f.properties.surface_sensebox === 'unknown', pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'senseboxPane', radius: 3, weight: 0.5, fillOpacity: 1 }), style: (f) => ({ fillColor: getSenseboxColor(f.properties.surface_sensebox), color: getSenseboxColor(f.properties.surface_sensebox) }), onEachFeature: bindDetailedPopup });
    layers.resultMatch = L.geoJSON(data, { filter: (f) => f.properties.match === 'True', pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'resultPane', radius: 5, weight: 1, fillOpacity: 0.9 }), style: (f) => ({ fillColor: getResultColor(f.properties.match), color: getResultColor(f.properties.match) }), onEachFeature: bindDetailedPopup });
    layers.resultMismatch = L.geoJSON(data, { filter: (f) => f.properties.match === 'False', pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'resultPane', radius: 5, weight: 1, fillOpacity: 0.9 }), style: (f) => ({ fillColor: getResultColor(f.properties.match), color: getResultColor(f.properties.match) }), onEachFeature: bindDetailedPopup });
    return layers;
}

// --- 5. ROUTER & STATS ENGINE ---
function handleTrackSelectionChange(trackId, isChecked) {
    if (isChecked) {
        if (!loadedTracksData[trackId]) {
            const trackConfig = trackFiles.find(t => t.id === trackId);
            fetch(trackConfig.url).then(r => r.json()).then(data => {
                loadedTracksData[trackId] = createLayersForData(data);
                loadedTracksData[trackId].rawData = data.features; 
                addTrackToActiveGroups(trackId);
                updateMapLayersAndControl();
                if (Object.keys(loadedTracksData).length === 1) map.fitBounds(loadedTracksData[trackId].swisstopo.getBounds());
            });
        } else {
            addTrackToActiveGroups(trackId);
            updateMapLayersAndControl();
        }
    } else {
        removeTrackFromActiveGroups(trackId);
        updateMapLayersAndControl();
    }
}

function addTrackToActiveGroups(trackId) { if(loadedTracksData[trackId]) Object.keys(activeTrackLayers).forEach(key => activeTrackLayers[key].addLayer(loadedTracksData[trackId][key])); }
function removeTrackFromActiveGroups(trackId) { if(loadedTracksData[trackId]) Object.keys(activeTrackLayers).forEach(key => activeTrackLayers[key].removeLayer(loadedTracksData[trackId][key])); }

// --- STATISTIK GENERATOR ---
window.generateStatistics = function() {
    const container = document.getElementById('stats-container');
    const activeToggles = document.querySelectorAll('.track-toggle:checked');
    const activeIds = Array.from(activeToggles).map(cb => cb.getAttribute('data-id'));

    if (activeIds.length === 0) {
        container.innerHTML = '<p>No tracks selected. Please select at least one track to view statistics.</p>';
        return;
    }

    let overall = { name: "Total Aggregated Data", total: 0, valid: 0, match: 0, gtPaved: 0, gtNature: 0, sbPaved: 0, sbNature: 0, sbUnknown: 0, validGtPaved: 0, validGtNature: 0, gtPavedMatch: 0, gtNatureMatch: 0 };
    let trackStatsHTML = '';

    activeIds.forEach(id => {
        if (!loadedTracksData[id]) return;
        let t = { name: trackFiles.find(x => x.id === id).name, total: 0, valid: 0, match: 0, gtPaved: 0, gtNature: 0, sbPaved: 0, sbNature: 0, sbUnknown: 0, validGtPaved: 0, validGtNature: 0, gtPavedMatch: 0, gtNatureMatch: 0 };
        
        loadedTracksData[id].rawData.forEach(f => {
            const p = f.properties;
            const gt = p.surface_swisstopo; const sb = p.surface_sensebox;
            const isMatch = (p.match === 'True' || p.match === true);
            
            t.total++;
            if (gt === 'paved') t.gtPaved++;
            if (gt === 'nature') t.gtNature++;
            if (sb === 'paved') t.sbPaved++;
            else if (sb === 'nature') t.sbNature++;
            else t.sbUnknown++;

            if (sb !== 'unknown' && gt !== 'unknown') {
                t.valid++;
                if (isMatch) t.match++;
                if (gt === 'paved') { t.validGtPaved++; if (isMatch) t.gtPavedMatch++; }
                if (gt === 'nature') { t.validGtNature++; if (isMatch) t.gtNatureMatch++; }
            }
        });

        overall.total += t.total; overall.valid += t.valid; overall.match += t.match;
        overall.gtPaved += t.gtPaved; overall.gtNature += t.gtNature;
        overall.sbPaved += t.sbPaved; overall.sbNature += t.sbNature; overall.sbUnknown += t.sbUnknown;
        overall.validGtPaved += t.validGtPaved; overall.validGtNature += t.validGtNature;
        overall.gtPavedMatch += t.gtPavedMatch; overall.gtNatureMatch += t.gtNatureMatch;

        trackStatsHTML += buildStatCardHTML(t);
    });

    container.innerHTML = buildStatCardHTML(overall, true) + trackStatsHTML;
};

function buildStatCardHTML(s, isOverall = false) {
    if (s.total === 0) return '';
    
    // Genauigkeiten
    const acc = s.valid > 0 ? ((s.match / s.valid) * 100).toFixed(1) : 0;
    const errPaved = s.validGtPaved > 0 ? (100 - ((s.gtPavedMatch / s.validGtPaved) * 100)).toFixed(1) : 0;
    const errNature = s.validGtNature > 0 ? (100 - ((s.gtNatureMatch / s.validGtNature) * 100)).toFixed(1) : 0;
    
    // Ground Truth Verteilung (berechnet vom Total)
    const pctGtPaved = s.total > 0 ? ((s.gtPaved / s.total) * 100).toFixed(1) : 0;
    const pctGtNature = s.total > 0 ? ((s.gtNature / s.total) * 100).toFixed(1) : 0;
    
    // NEU: SenseBox Verteilung (nur berechnet auf Basis der KLASSIFIZIERTEN Punkte!)
    const sbClassifiedTotal = s.sbPaved + s.sbNature;
    const pctSbPaved = sbClassifiedTotal > 0 ? ((s.sbPaved / sbClassifiedTotal) * 100).toFixed(1) : 0;
    const pctSbNature = sbClassifiedTotal > 0 ? ((s.sbNature / sbClassifiedTotal) * 100).toFixed(1) : 0;

    // NEU: Quote der Unknowns (Sensor-Aussetzer / stehend) berechnet vom Total
    const pctUnknown = s.total > 0 ? ((s.sbUnknown / s.total) * 100).toFixed(1) : 0;

    return `
    <div class="stat-card" ${isOverall ? 'style="border: 2px solid #0072B2; background: #f0f7fb;"' : ''}>
        <h4>${s.name} <span style="float:right; font-weight:normal; font-size:12px; color:#666;">Total Points: ${s.total}</span></h4>
        <div class="stat-grid">
            <div class="stat-box">
                <strong>Accuracy (Valid Points)</strong>
                Overall AI Success: <span class="${acc > 80 ? 'highlight-green' : 'highlight-red'}">${acc}%</span><br>
                <div style="margin-top: 5px; font-size: 12px; color: #555;">
                    Error Rate Paved: <b>${errPaved}%</b><br>
                    Error Rate Nature: <b>${errNature}%</b>
                </div>
            </div>
            <div class="stat-box">
                <strong>Surface Distribution</strong>
                <span style="font-size:11px;">Ground Truth (swisstopo):</span><br>
                ${pctGtPaved}% Paved | ${pctGtNature}% Nature<br>
                <div style="margin-top: 5px; font-size:11px;">SenseBox Predictions (Classified):</div>
                ${pctSbPaved}% Paved | ${pctSbNature}% Nature<br>
                <span style="color:#888; font-size: 11px;">(Ignored Unknowns: ${s.sbUnknown} points / ${pctUnknown}%)</span>
            </div>
        </div>
    </div>`;
}

// --- 6. LAYER MANAGEMENT CONTROL ---
function updateMapLayersAndControl() {
    Object.values(activeTrackLayers).forEach(group => map.removeLayer(group));
    if (currentLayerControl) map.removeControl(currentLayerControl);
    let overlays = {};
    if (currentMode === 'raw') {
        activeTrackLayers.swisstopo.addTo(map); activeTrackLayers.senseboxKnown.addTo(map);
        overlays = { "Ground Truth (swisstopo)": activeTrackLayers.swisstopo, "SenseBox AI (Classified)": activeTrackLayers.senseboxKnown, "<span class='layer-indent'>Unknowns (Yellow)</span>": activeTrackLayers.senseboxUnknown };
    } else {
        activeTrackLayers.resultMatch.addTo(map); activeTrackLayers.resultMismatch.addTo(map);
        overlays = { "Correct Predictions": activeTrackLayers.resultMatch, "Errors (Mismatches)": activeTrackLayers.resultMismatch };
    }
    currentLayerControl = L.control.layers(null, overlays, { position: 'topright', collapsed: false }).addTo(map);
    if (legendControl) legendControl.update();
}

function redrawColors() {
    Object.values(loadedTracksData).forEach(trackLayers => {
        trackLayers.swisstopo.setStyle(f => ({ fillColor: getTopoColor(f.properties.surface_swisstopo), color: getTopoColor(f.properties.surface_swisstopo) }));
        trackLayers.senseboxKnown.setStyle(f => ({ fillColor: getSenseboxColor(f.properties.surface_sensebox), color: getSenseboxColor(f.properties.surface_sensebox) }));
        trackLayers.senseboxUnknown.setStyle(f => ({ fillColor: getSenseboxColor(f.properties.surface_sensebox), color: getSenseboxColor(f.properties.surface_sensebox) }));
        trackLayers.resultMatch.setStyle(f => ({ fillColor: getResultColor(f.properties.match), color: getResultColor(f.properties.match) }));
        trackLayers.resultMismatch.setStyle(f => ({ fillColor: getResultColor(f.properties.match), color: getResultColor(f.properties.match) }));
    });
    if (legendControl) legendControl.update();
}

// --- 7. LEGENDE ---
function createLegend() {
    legendControl = L.control({ position: 'bottomright' });
    legendControl.onAdd = function () { this._div = L.DomUtil.create('div', 'legend'); this.update(); return this._div; };
    legendControl.update = function () {
        let html = '<div class="legend-title">Legend</div>';
        if (currentMode === 'raw') {
            html += `<i style="background: ${getTopoColor('nature')}"></i> Ground Truth: Nature<br><i style="background: ${getTopoColor('paved')}"></i> Ground Truth: Paved<br><i style="background: ${getSenseboxColor('nature')}"></i> AI Classified: Nature<br><i style="background: ${getSenseboxColor('paved')}"></i> AI Classified: Paved<br><i style="background: ${getSenseboxColor('unknown')}"></i> AI Unknown<br>`;
        } else {
            html += `<i style="background: ${getResultColor('True')}"></i> Correct Prediction<br><i style="background: ${getResultColor('False')}"></i> Error / Mismatch<br>`;
        }
        this._div.innerHTML = html;
    };
    legendControl.addTo(map);
}

// --- 8. DASHBOARD PANEL ---
const CustomUI = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control ui-panel');
        L.DomEvent.disableClickPropagation(div); 
        let trackListHTML = '';
        trackFiles.forEach((track, index) => {
            trackListHTML += `<div class="track-item"><span>${track.name}</span><label class="switch"><input type="checkbox" class="track-toggle" data-id="${track.id}" ${index === 0 ? 'checked' : ''}><span class="slider"></span></label></div>`;
        });
        div.innerHTML = `
            <div class="panel-title">Select Tracks</div>
            <div class="track-list">${trackListHTML}</div>
            <hr style="width: 100%; border: 0; border-top: 1px solid rgba(0,0,0,0.06); margin: 2px 0;">
            <div class="panel-title">Visualization Mode</div>
            <div class="slider-container"><span id="label-raw" class="mode-label active">Raw Data</span><label class="switch"><input type="checkbox" id="mode-toggle"><span class="slider"></span></label><span id="label-result" class="mode-label inactive">Results</span></div>
            <hr style="width: 100%; border: 0; border-top: 1px solid rgba(0,0,0,0.06); margin: 2px 0;">
            <button class="btn-ui" style="background: white; border-color: #0072B2; color: #0072B2;" onclick="openStatsModal()"><span>📊</span> Statistical Results</button>
            <button id="btn-colorblind" class="btn-ui"><span>👁️</span> Colorblind Mode: Off</button>
            <button class="btn-ui" style="background: white;" onclick="openInfoModal()"><span>ℹ️</span> Project Info & Metadata</button>
        `;
        return div;
    }
});
map.addControl(new CustomUI());

const NorthArrow = L.Control.extend({ options: { position: 'topright' }, onAdd: function() { const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control north-arrow-float'); div.innerHTML = `<span class="letter">N</span><span class="arrow">↑</span>`; return div; } });
map.addControl(new NorthArrow());

// --- 9. EVENT LISTENERS ---
document.querySelector('.track-list').addEventListener('change', function(e) { if (e.target.classList.contains('track-toggle')) handleTrackSelectionChange(e.target.getAttribute('data-id'), e.target.checked); });
document.getElementById('mode-toggle').addEventListener('change', function(e) { currentMode = e.target.checked ? 'result' : 'raw'; document.getElementById('label-raw').className = e.target.checked ? 'mode-label inactive' : 'mode-label active'; document.getElementById('label-result').className = e.target.checked ? 'mode-label active' : 'mode-label inactive'; updateMapLayersAndControl(); });
document.getElementById('btn-colorblind').addEventListener('click', function(e) { isColorblind = !isColorblind; const btn = e.currentTarget; if (isColorblind) { btn.classList.add('active'); btn.innerHTML = '👁️ Colorblind Mode: ON'; } else { btn.classList.remove('active'); btn.innerHTML = '👁️ Colorblind Mode: Off'; } redrawColors(); });

createLegend();
handleTrackSelectionChange(trackFiles[0].id, true);
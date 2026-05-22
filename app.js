// ==========================================
// CONFIGURATION: HIER DEINE DATEIEN EINTRAGEN
// ==========================================
const trackFiles = [
    { id: 'track1', name: 'Track April 30', url: 'Bike_2026-04-30_18-28_webapp.geojson' },
    { id: 'track2', name: 'Track May 02 (13:43)', url: 'Bike_2026-05-02_13-43_webapp.geojson' },
    { id: 'track3', name: 'Track May 02 (14:13)', url: 'Bike_2026-05-02_14-13_webapp.geojson' }
];

// --- 1. MAP SETUP ---
// ACHTUNG: preferCanvas gelöscht, damit Popups mit Panes einwandfrei klicken!
const map = L.map('map', { zoomControl: false }).setView([47.2, 8.7], 13);

// Anordnung unten links: Zuerst Zoom (wird oben platziert), dann Scale (ganz unten)
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 120 }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors, &copy; swisstopo'
}).addTo(map);

// Z-Index Ebenen für perfekte Überlagerungen
map.createPane('swisstopoPane'); map.getPane('swisstopoPane').style.zIndex = 400;
map.createPane('senseboxPane');  map.getPane('senseboxPane').style.zIndex = 410;
map.createPane('resultPane');    map.getPane('resultPane').style.zIndex = 420;

// App State
let currentMode = 'raw'; 
let isColorblind = false;
let currentLayerControl = null;
let legendControl = null;

// Datenspeicher für geladene Tracks und deren Layer-Instanzen
const loadedTracksData = {};
const activeTrackLayers = {
    swisstopo: L.layerGroup(),
    senseboxKnown: L.layerGroup(),
    senseboxUnknown: L.layerGroup(),
    resultMatch: L.layerGroup(),
    resultMismatch: L.layerGroup()
};

// --- 2. KARTOGRAFISCHE FARB-LOGIK ---
function getTopoColor(surface) {
    if (surface === 'paved') return '#a7a7a7'; 
    if (surface === 'nature') return isColorblind ? '#56B4E9' : '#03fb6f'; 
    return '#e0e0e0'; 
}
function getSenseboxColor(surface) {
    if (surface === 'paved') return '#696969'; 
    if (surface === 'nature') return isColorblind ? '#0072B2' : '#06632e'; 
    return isColorblind ? '#F0E442' : '#fec44f'; 
}
function getResultColor(isMatchStr) {
    if (isMatchStr === 'True') return isColorblind ? '#0072B2' : '#1a9641'; 
    if (isMatchStr === 'False') return isColorblind ? '#D55E00' : '#d7191c'; 
    return '#aaaaaa'; 
}

// --- 3. POPUP RENDERING ---
function bindDetailedPopup(feature, layer) {
    const p = feature.properties;
    const matchVal = p.match !== undefined ? p.match : p.is_match;
    const matchText = matchVal === 'True' ? "✅ Correct" : matchVal === 'False' ? "❌ Wrong" : "❓ Unknown";
    
    layer.bindPopup(`
        <div style="font-family: Arial, sans-serif; font-size: 13px;">
            <h4 style="margin: 0 0 8px 0; border-bottom: 1px solid #ccc; padding-bottom: 4px;">${matchText}</h4>
            <b>swisstopo:</b> ${p.surface_swisstopo}<br>
            <b>SenseBox AI:</b> ${p.surface_sensebox}<br>
            <span style="color: #666; font-size: 11px;">Probability: ${(p.surface_sensebox_probability * 100).toFixed(1)}%</span>
        </div>
    `);
}

// --- 4. LAYER GENERATION ENGINE ---
function createLayersForData(data) {
    const layers = {};

    layers.swisstopo = L.geoJSON(data, {
        pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'swisstopoPane', radius: 10, weight: 1, fillOpacity: 0.8 }),
        style: (f) => ({ fillColor: getTopoColor(f.properties.surface_swisstopo), color: getTopoColor(f.properties.surface_swisstopo) }),
        onEachFeature: bindDetailedPopup
    });

    layers.senseboxKnown = L.geoJSON(data, {
        filter: (f) => f.properties.surface_sensebox !== 'unknown',
        pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'senseboxPane', radius: 3, weight: 0.5, fillOpacity: 1 }),
        style: (f) => ({ fillColor: getSenseboxColor(f.properties.surface_sensebox), color: getSenseboxColor(f.properties.surface_sensebox) }),
        onEachFeature: bindDetailedPopup
    });

    layers.senseboxUnknown = L.geoJSON(data, {
        filter: (f) => f.properties.surface_sensebox === 'unknown',
        pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'senseboxPane', radius: 3, weight: 0.5, fillOpacity: 1 }),
        style: (f) => ({ fillColor: getSenseboxColor(f.properties.surface_sensebox), color: getSenseboxColor(f.properties.surface_sensebox) }),
        onEachFeature: bindDetailedPopup
    });

    layers.resultMatch = L.geoJSON(data, {
        filter: (f) => f.properties.match === 'True',
        pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'resultPane', radius: 5, weight: 1, fillOpacity: 0.9 }),
        style: (f) => ({ fillColor: getResultColor(f.properties.match), color: getResultColor(f.properties.match) }),
        onEachFeature: bindDetailedPopup
    });

    layers.resultMismatch = L.geoJSON(data, {
        filter: (f) => f.properties.match === 'False',
        pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'resultPane', radius: 5, weight: 1, fillOpacity: 0.9 }),
        style: (f) => ({ fillColor: getResultColor(f.properties.match), color: getResultColor(f.properties.match) }),
        onEachFeature: bindDetailedPopup
    });

    return layers;
}

// --- 5. MULTI-TRACK DATA ROUTER ---
function handleTrackSelectionChange(trackId, isChecked) {
    if (isChecked) {
        // Falls noch nicht im RAM, per Fetch laden
        if (!loadedTracksData[trackId]) {
            const trackConfig = trackFiles.find(t => t.id === trackId);
            fetch(trackConfig.url)
                .then(r => r.json())
                .then(data => {
                    loadedTracksData[trackId] = createLayersForData(data);
                    addTrackToActiveGroups(trackId);
                    updateMapLayersAndControl();
                    
                    // Beim allerersten geladenen Track automatisch hinzoomen
                    if (Object.keys(loadedTracksData).length === 1) {
                        map.fitBounds(loadedTracksData[trackId].swisstopo.getBounds());
                    }
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

function addTrackToActiveGroups(trackId) {
    const trackLayers = loadedTracksData[trackId];
    if (!trackLayers) return;
    Object.keys(activeTrackLayers).forEach(key => {
        activeTrackLayers[key].addLayer(trackLayers[key]);
    });
}

function removeTrackFromActiveGroups(trackId) {
    const trackLayers = loadedTracksData[trackId];
    if (!trackLayers) return;
    Object.keys(activeTrackLayers).forEach(key => {
        activeTrackLayers[key].removeLayer(trackLayers[key]);
    });
}

// --- 6. LAYER MANAGEMENT CONTROL ---
function updateMapLayersAndControl() {
    // Alle Layer-Gruppen kurz entfernen
    Object.values(activeTrackLayers).forEach(group => map.removeLayer(group));
    if (currentLayerControl) map.removeControl(currentLayerControl);

    let overlays = {};
    if (currentMode === 'raw') {
        activeTrackLayers.swisstopo.addTo(map);
        activeTrackLayers.senseboxKnown.addTo(map);
        overlays = {
            "Ground Truth (swisstopo)": activeTrackLayers.swisstopo,
            "SenseBox AI (Classified)": activeTrackLayers.senseboxKnown,
            "<span class='layer-indent'>Unknowns (Yellow)</span>": activeTrackLayers.senseboxUnknown
        };
    } else {
        activeTrackLayers.resultMatch.addTo(map);
        activeTrackLayers.resultMismatch.addTo(map);
        overlays = {
            "Correct Predictions": activeTrackLayers.resultMatch,
            "Errors (Mismatches)": activeTrackLayers.resultMismatch
        };
    }

    // Das Layer-Menü ganz oben rechts platzieren
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

// --- 7. DYNAMISCHE LEGENDE (Ganz unten rechts) ---
function createLegend() {
    legendControl = L.control({ position: 'bottomright' });
    legendControl.onAdd = function () {
        this._div = L.DomUtil.create('div', 'legend');
        this.update();
        return this._div;
    };
    legendControl.update = function () {
        let html = '<div class="legend-title">Legend</div>';
        if (currentMode === 'raw') {
            html += `<i style="background: ${getTopoColor('nature')}"></i> Ground Truth: Nature<br>`;
            html += `<i style="background: ${getTopoColor('paved')}"></i> Ground Truth: Paved<br>`;
            html += `<i style="background: ${getSenseboxColor('nature')}"></i> AI Classified: Nature<br>`;
            html += `<i style="background: ${getSenseboxColor('paved')}"></i> AI Classified: Paved<br>`;
            html += `<i style="background: ${getSenseboxColor('unknown')}"></i> AI Unknown<br>`;
        } else {
            html += `<i style="background: ${getResultColor('True')}"></i> Correct Prediction<br>`;
            html += `<i style="background: ${getResultColor('False')}"></i> Error / Mismatch<br>`;
        }
        this._div.innerHTML = html;
    };
    legendControl.addTo(map);
}

// --- 8. DASHBOARD CONTROL PANEL (Oben Links) ---
const CustomUI = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control ui-panel');
        L.DomEvent.disableClickPropagation(div); 
        
        // Track-Liste dynamisch generieren
        let trackListHTML = '';
        trackFiles.forEach((track, index) => {
            const checkedAttr = index === 0 ? 'checked' : ''; // Ersten Track vorauswählen
            trackListHTML += `
                <div class="track-item">
                    <span>${track.name}</span>
                    <label class="switch">
                        <input type="checkbox" class="track-toggle" data-id="${track.id}" ${checkedAttr}>
                        <span class="slider"></span>
                    </label>
                </div>
            `;
        });

        div.innerHTML = `
            <div class="panel-title">Select Tracks</div>
            <div class="track-list">${trackListHTML}</div>
            <hr style="width: 100%; border: 0; border-top: 1px solid rgba(0,0,0,0.06); margin: 2px 0;">
            <div class="panel-title">Visualization Mode</div>
            <div class="slider-container">
                <span id="label-raw" class="mode-label active">Raw Data</span>
                <label class="switch">
                    <input type="checkbox" id="mode-toggle">
                    <span class="slider"></span>
                </label>
                <span id="label-result" class="mode-label inactive">Results</span>
            </div>
            <hr style="width: 100%; border: 0; border-top: 1px solid rgba(0,0,0,0.06); margin: 2px 0;">
            <button id="btn-colorblind" class="btn-ui">
                <span>👁️</span> Colorblind Mode: Off
            </button>
            <button class="btn-ui" style="background: white;" onclick="openModal()">
                <span>ℹ️</span> Project Info & Metadata
            </button>
        `;
        return div;
    }
});
map.addControl(new CustomUI());

// Minimalistischer Nordpfeil (Oben Rechts, wird unter Layer-Control angehängt)
const NorthArrow = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control north-arrow-minimal north-arrow-float');
        div.innerHTML = `<span class="letter">N</span><span class="arrow">↑</span>`;
        return div;
    }
});
map.addControl(new NorthArrow());

// --- 9. REACTIVE EVENT LISTENERS ---
// Event-Delegation für die dynamischen Track-Switches
document.querySelector('.track-list').addEventListener('change', function(e) {
    if (e.target.classList.contains('track-toggle')) {
        handleTrackSelectionChange(e.target.getAttribute('data-id'), e.target.checked);
    }
});

document.getElementById('mode-toggle').addEventListener('change', function(e) {
    const isResultMode = e.target.checked;
    currentMode = isResultMode ? 'result' : 'raw';
    document.getElementById('label-raw').className = isResultMode ? 'mode-label inactive' : 'mode-label active';
    document.getElementById('label-result').className = isResultMode ? 'mode-label active' : 'mode-label inactive';
    updateMapLayersAndControl();
});

document.getElementById('btn-colorblind').addEventListener('click', function(e) {
    isColorblind = !isColorblind;
    const btn = e.currentTarget; 
    if (isColorblind) {
        btn.classList.add('active');
        btn.innerHTML = '👁️ Colorblind Mode: ON';
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '👁️ Colorblind Mode: Off';
    }
    redrawColors(); 
});

// App-Initialisierung für den vorausgewählten ersten Track
createLegend();
const firstTrack = trackFiles[0];
handleTrackSelectionChange(firstTrack.id, true);
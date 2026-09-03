// Driver GPS Console Logic
const IIITDM_DEFAULT = [15.761411, 78.039151];

// UI Element References
const busSelect = document.getElementById("bus-select");
const routeText = document.getElementById("route-text");
const toggleBtn = document.getElementById("toggle-broadcast-btn");
const btnText = document.getElementById("btn-text");
const statusBanner = document.getElementById("status-banner");
const statusLabel = document.getElementById("status-label");
const wakelockStatus = document.getElementById("wakelock-status");
const wakelockText = document.getElementById("wakelock-text");
const driverError = document.getElementById("driver-error");

// HUD Elements
const hudSpeed = document.getElementById("hud-speed");
const hudAccuracy = document.getElementById("hud-accuracy");
const hudPings = document.getElementById("hud-pings");
const hudLat = document.getElementById("hud-lat");
const hudLng = document.getElementById("hud-lng");
const hudTime = document.getElementById("hud-time");

// Simulation Elements
const simToggleHeader = document.getElementById("sim-toggle-header");
const toggleSimModeBtn = document.getElementById("toggle-sim-mode");
const simModeStatus = document.getElementById("sim-mode-status");
const simControls = document.getElementById("sim-controls");
const simStepBtn = document.getElementById("sim-step-btn");
const simAutoBtn = document.getElementById("sim-auto-btn");
const recenterBtn = document.getElementById("recenter-btn");

// State Variables
let buses = [];
let selectedBus = null;
let isBroadcasting = false;
let watchId = null;
let wakeLock = null;
let pingCount = 0;
let lastPosition = null;
let lastTimestamp = 0;

// Map Variables
let driverMap = null;
let driverMarker = null;
let accuracyCircle = null;
let pathPolyline = null;
let pathCoordinates = [];

// Simulation State
let simActive = false;
let simInterval = null;
let simStepIndex = 0;

// 1. Initialize Map
function initMap() {
  driverMap = L.map("driver-map", {
    zoomControl: false,
  }).setView(IIITDM_DEFAULT, 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(driverMap);

  L.control.zoom({ position: "bottomright" }).addTo(driverMap);

  pathPolyline = L.polyline([], {
    color: "#3b82f6",
    weight: 4,
    opacity: 0.8,
  }).addTo(driverMap);
}

// 2. Fetch Available Buses
async function loadBuses() {
  try {
    const res = await fetch("/api/v1/buses");
    const data = await res.json();
    buses = data.buses || [];

    busSelect.innerHTML = "";
    if (buses.length === 0) {
      busSelect.innerHTML = '<option value="">No buses registered</option>';
      return;
    }

    buses.forEach((bus, index) => {
      const option = document.createElement("option");
      option.value = bus.id;
      option.textContent = `${bus.name} (${bus.id})`;
      if (index === 0) option.selected = true;
      busSelect.appendChild(option);
    });

    onBusChange();
    loadDriverSchedule();
  } catch (err) {
    showError("Could not connect to campus bus server. Ensure backend is running.");
  }
}

async function loadDriverSchedule() {
  const driverTripDesc = document.getElementById("driver-trip-desc");
  if (!driverTripDesc) return;
  try {
    const res = await fetch("/api/v1/schedule");
    const data = await res.json();
    if (data && data.status) {
      const status = data.status;
      if (status.currentTrip) {
        driverTripDesc.textContent = `🟢 En Route (${status.currentTrip.pickup} - ${status.currentTrip.drop}): ${status.currentTrip.from} ➔ ${status.currentTrip.to}`;
        driverTripDesc.style.color = "#34d399";
      } else if (status.nextTrip) {
        driverTripDesc.textContent = `🟡 Next Trip (${status.nextTrip.pickup}): ${status.nextTrip.from} ➔ ${status.nextTrip.to}`;
        driverTripDesc.style.color = "#fbbf24";
      } else {
        driverTripDesc.textContent = "No more trips scheduled for today.";
        driverTripDesc.style.color = "#94a3b8";
      }
    }
  } catch (err) {
    console.warn("Could not load driver schedule:", err);
  }
}

function onBusChange() {
  const busId = busSelect.value;
  selectedBus = buses.find((b) => b.id === busId) || null;
  if (selectedBus) {
    routeText.textContent = selectedBus.route || "Default Campus Route";
    // If bus already has a last known location, center on it
    if (selectedBus.live) {
      const pos = [selectedBus.live.lat, selectedBus.live.lng];
      updateMarker(pos[0], pos[1], selectedBus.live.accuracyMeters);
      driverMap.setView(pos, 16);
    }
  }
}

busSelect.addEventListener("change", onBusChange);

// 3. Screen Wake Lock Management
async function requestWakeLock() {
  if ("wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakelockStatus.classList.add("active");
      wakelockText.textContent = "Screen Awake";
      wakeLock.addEventListener("release", () => {
        if (!isBroadcasting) {
          wakelockStatus.classList.remove("active");
          wakelockText.textContent = "WakeLock Idle";
        }
      });
    } catch (err) {
      console.warn("WakeLock request failed:", err.message);
    }
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
    wakelockStatus.classList.remove("active");
    wakelockText.textContent = "WakeLock Idle";
  }
}

document.addEventListener("visibilitychange", async () => {
  if (wakeLock !== null && document.visibilityState === "visible" && isBroadcasting) {
    await requestWakeLock();
  }
});

// 4. Update Map Marker
function updateMarker(lat, lng, accuracy) {
  const pos = [lat, lng];

  if (!driverMarker) {
    const busIcon = L.divIcon({
      className: "driver-custom-marker",
      html: `
        <div style="
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="
            width: 44px;
            height: 44px;
            background: #ffffff;
            border-radius: 50%;
            border: 2.5px solid #10b981;
            box-shadow: 0 0 16px rgba(16,185,129,0.6);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <svg viewBox="0 0 64 64" width="28" height="28">
              <rect x="11" y="10" width="42" height="40" rx="9" fill="#1E3A8A" stroke="#FFFFFF" stroke-width="2.5"/>
              <rect x="19" y="13" width="26" height="4" rx="2" fill="#FBBF24"/>
              <rect x="15" y="19" width="34" height="14" rx="3" fill="#E0F2FE" stroke="#1E3A8A" stroke-width="1"/>
              <line x1="32" y1="19" x2="32" y2="33" stroke="#1E3A8A" stroke-width="1.5"/>
              <rect x="23" y="36" width="18" height="5" rx="2.5" fill="#0F172A"/>
              <circle cx="17" cy="38.5" r="3" fill="#FEF08A"/>
              <circle cx="47" cy="38.5" r="3" fill="#FEF08A"/>
              <rect x="14" y="44" width="36" height="4" rx="2" fill="#334155"/>
            </svg>
          </div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    driverMarker = L.marker(pos, { icon: busIcon }).addTo(driverMap);
  } else {
    driverMarker.setLatLng(pos);
  }

  if (accuracy && accuracy > 0) {
    if (!accuracyCircle) {
      accuracyCircle = L.circle(pos, {
        radius: accuracy,
        color: "#10b981",
        weight: 1,
        fillColor: "#10b981",
        fillOpacity: 0.15,
      }).addTo(driverMap);
    } else {
      accuracyCircle.setLatLng(pos);
      accuracyCircle.setRadius(accuracy);
    }
  }

  pathCoordinates.push(pos);
  if (pathCoordinates.length > 50) pathCoordinates.shift();
  pathPolyline.setLatLngs(pathCoordinates);
}

// 5. Send GPS Telemetry to Server
async function sendTelemetry(payload) {
  try {
    const res = await fetch("/api/v1/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Server rejected update");
    }

    pingCount++;
    hudPings.textContent = `${pingCount} sent`;
    const now = new Date();
    hudTime.textContent = now.toLocaleTimeString();
    clearError();
  } catch (err) {
    showError(`Transmission failed: ${err.message}`);
  }
}

// 6. Handle Geolocation Updates
function handlePosition(position) {
  const coords = position.coords;
  const lat = coords.latitude;
  const lng = coords.longitude;
  const accuracy = coords.accuracy || 0;
  const now = Date.now();

  let speedKmh = 0;
  if (coords.speed !== null && coords.speed !== undefined && !isNaN(coords.speed) && coords.speed >= 0) {
    speedKmh = coords.speed * 3.6;
  } else if (lastPosition && lastTimestamp > 0) {
    // Calculate approximate speed from distance / time
    const distMeters = calculateDistance(lastPosition.lat, lastPosition.lng, lat, lng);
    const timeDeltaHours = (now - lastTimestamp) / 3600000;
    if (timeDeltaHours > 0) {
      speedKmh = Math.min(120, distMeters / 1000 / timeDeltaHours);
    }
  }

  let heading = coords.heading || null;
  if (heading === null && lastPosition) {
    heading = calculateHeading(lastPosition.lat, lastPosition.lng, lat, lng);
  }

  lastPosition = { lat, lng };
  lastTimestamp = now;

  // Update HUD
  hudSpeed.textContent = speedKmh.toFixed(1);
  hudAccuracy.textContent = accuracy ? `±${Math.round(accuracy)} m` : "High Precision";
  hudLat.textContent = lat.toFixed(6);
  hudLng.textContent = lng.toFixed(6);

  // Update Mini Map
  updateMarker(lat, lng, accuracy);
  driverMap.panTo([lat, lng]);

  // Send to backend
  if (selectedBus) {
    sendTelemetry({
      busId: selectedBus.id,
      lat,
      lng,
      speedKmh: Number(speedKmh.toFixed(1)),
      heading: heading != null ? Math.round(heading) : null,
      accuracyMeters: Math.round(accuracy),
      recordedAt: new Date().toISOString(),
    });
  }
}

function handlePositionError(err) {
  let msg = "GPS error occurred.";
  switch (err.code) {
    case err.PERMISSION_DENIED:
      msg = "Location permission denied! Please allow GPS access in your mobile browser settings.";
      break;
    case err.POSITION_UNAVAILABLE:
      msg = "GPS signal unavailable. Please ensure Location is enabled on your phone.";
      break;
    case err.TIMEOUT:
      msg = "GPS request timed out. Retrying...";
      break;
  }
  showError(msg);
}

// 7. Toggle Broadcast
async function toggleBroadcast() {
  if (isBroadcasting) {
    stopBroadcast();
  } else {
    startBroadcast();
  }
}

function startBroadcast() {
  if (!selectedBus) {
    showError("Please select a bus first.");
    return;
  }

  if (!("geolocation" in navigator)) {
    showError("Geolocation is not supported by your browser.");
    return;
  }

  isBroadcasting = true;
  clearError();

  // UI state
  toggleBtn.classList.remove("btn-start");
  toggleBtn.classList.add("btn-stop");
  btnText.textContent = "STOP SHARING LOCATION";
  statusBanner.querySelector(".status-indicator").classList.add("active");
  statusLabel.textContent = "Broadcasting Live GPS";
  busSelect.disabled = true;

  // Wake lock
  requestWakeLock();

  // Start watching position
  const options = {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 1000,
  };

  watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, options);
}

function stopBroadcast() {
  isBroadcasting = false;

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  stopSimulation();
  releaseWakeLock();

  // Reset UI
  toggleBtn.classList.remove("btn-stop");
  toggleBtn.classList.add("btn-start");
  btnText.textContent = "START SHARING LOCATION";
  statusBanner.querySelector(".status-indicator").classList.remove("active");
  statusLabel.textContent = "Broadcast Stopped";
  busSelect.disabled = false;
  hudSpeed.textContent = "0.0";
}

toggleBtn.addEventListener("click", toggleBroadcast);

// 8. Error Helpers
function showError(msg) {
  driverError.textContent = msg;
  driverError.classList.remove("hidden");
}

function clearError() {
  driverError.textContent = "";
  driverError.classList.add("hidden");
}

// 9. Distance & Heading Math Helpers
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function calculateHeading(lat1, lon1, lat2, lon2) {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(((lon2 - lon1) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// 10. Recenter Button
recenterBtn.addEventListener("click", () => {
  if (lastPosition) {
    driverMap.setView([lastPosition.lat, lastPosition.lng], 16);
  } else {
    driverMap.setView(IIITDM_DEFAULT, 16);
  }
});

// 11. Simulation / Desktop Test Suite (City Shuttle Route)
const CITY_SHUTTLE_SIM_POINTS = [
  { lat: 15.828735, lng: 78.038423, speed: 20 }, // Raj Vihar
  { lat: 15.807002, lng: 78.042479, speed: 32 }, // C Camp Circle
  { lat: 15.797984, lng: 78.052022, speed: 38 }, // Nandyal Check post
  { lat: 15.774741, lng: 78.058717, speed: 28 }, // Pulla Reddy Engineering College
  { lat: 15.761411, lng: 78.039151, speed: 15 }, // IIITDM Kurnool Campus
];

simToggleHeader.addEventListener("click", () => {
  const isHidden = simControls.classList.contains("hidden");
  simControls.classList.toggle("hidden");
  toggleSimModeBtn.classList.toggle("active", isHidden);
  simModeStatus.textContent = isHidden ? "Open" : "Off";
});

function stepSimulation() {
  const point = CITY_SHUTTLE_SIM_POINTS[simStepIndex % CITY_SHUTTLE_SIM_POINTS.length];
  simStepIndex++;

  handlePosition({
    coords: {
      latitude: point.lat + (Math.random() - 0.5) * 0.0001,
      longitude: point.lng + (Math.random() - 0.5) * 0.0001,
      accuracy: 3.5,
      speed: point.speed / 3.6,
      heading: (simStepIndex * 45) % 360,
    },
  });
}

function startAutoSimulation() {
  if (simInterval) {
    stopSimulation();
  } else {
    simInterval = setInterval(stepSimulation, 2000);
    simAutoBtn.textContent = "Stop Auto-Drive";
    simAutoBtn.style.background = "#dc2626";
    isBroadcasting = true;
    toggleBtn.classList.remove("btn-start");
    toggleBtn.classList.add("btn-stop");
    btnText.textContent = "STOP SHARING (SIMULATING)";
    statusBanner.querySelector(".status-indicator").classList.add("active");
    statusLabel.textContent = "Virtual Route Simulation Running";
    requestWakeLock();
    stepSimulation();
  }
}

function stopSimulation() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
    simAutoBtn.textContent = "Auto-Drive Loop";
    simAutoBtn.style.background = "";
  }
}

simStepBtn.addEventListener("click", () => {
  if (!isBroadcasting) {
    isBroadcasting = true;
    toggleBtn.classList.remove("btn-start");
    toggleBtn.classList.add("btn-stop");
    btnText.textContent = "STOP SHARING";
    statusBanner.querySelector(".status-indicator").classList.add("active");
    statusLabel.textContent = "Simulation Step Active";
  }
  stepSimulation();
});

simAutoBtn.addEventListener("click", startAutoSimulation);

// Click on mini map to teleport position in test mode
driverMap = null;
window.addEventListener("DOMContentLoaded", () => {
  initMap();
  loadBuses();

  driverMap.on("click", (e) => {
    if (!simControls.classList.contains("hidden")) {
      handlePosition({
        coords: {
          latitude: e.latlng.lat,
          longitude: e.latlng.lng,
          accuracy: 4,
          speed: 25 / 3.6,
          heading: 90,
        },
      });
    }
  });
});

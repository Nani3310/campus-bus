# Campus Bus — Live Real-Time Web Platform & GPS Tracker

A complete, responsive web platform for live campus bus tracking at **IIITDM Kurnool**. 
- **No authentication or sign-in required** — students and staff get instant access to real-time bus locations, speeds, and routes.
- **Dedicated Driver GPS Webpage** — allows drivers to broadcast their smartphone's live GPS directly from their mobile browser with high accuracy and Screen WakeLock support.

---

## System Architecture

```
[Driver Smartphone Browser / GPS Module]
       │
       │  HTTP POST /api/v1/telemetry (Coordinates, Speed, Heading)
       ▼
[Node.js + Express Backend]
       │
       │  Socket.IO real-time broadcasts
       ▼
[Public Live Bus Tracking Webpage] (Leaflet OSM, live bus markers, route timelines)
```

---

## 1. Quick Start

### Prerequisites
- Node.js 18+

### Setup & Run
```powershell
cd server
npm install
npm start
```

Once running:
- **Public Student/Staff Tracking Map**: [http://localhost:8080/](http://localhost:8080/)
- **Driver GPS Update Console**: [http://localhost:8080/driver](http://localhost:8080/driver)

---

## 2. Driver GPS Console (`/driver`)

Bus drivers can open `http://<SERVER_IP>:8080/driver` on their phone's mobile browser:
1. Select their assigned bus (`BUS-01 City Shuttle`).
2. Tap **"START SHARING LOCATION"**.
3. The driver console uses:
   - **HTML5 High-Accuracy Geolocation API** (`navigator.geolocation.watchPosition`)
   - **Screen Wake Lock API** (`navigator.wakeLock`) so the phone screen stays active while driving.
   - Real-time speedometer gauge (km/h), GPS precision indicator, coordinates, transmission counter, and mini live map preview.
4. All connected students and campus members immediately see the bus moving live on their maps!

---

## 3. Public Student Live Map (`/`)

Open [http://localhost:8080/](http://localhost:8080/) in any browser (mobile or desktop):
- **Instant Access**: Zero login gates or password requirements.
- **Live Vehicle List**: Shows all registered buses with real-time status (`LIVE`, `STALE`, `OFFLINE`) and speed.
- **Interactive Leaflet Map**: Custom vehicle markers with pulse rings, direction indicators, and route polylines.
- **Route Timeline**: View scheduled stops for any selected route.
- **Controls**: Recenter on campus, locate user position, follow bus toggle, and map layer switcher.

---

## 4. API Endpoints

All endpoints are open and public:

- `GET /api/v1/health` — System status and campus coordinates.
- `GET /api/v1/campus` — Campus name and center coordinates.
- `GET /api/v1/buses` — List all buses with current live positions, status, and stops.
- `GET /api/v1/buses/:id` — Details for a specific bus.
- `POST /api/v1/telemetry` — Update vehicle GPS position (from driver phone or hardware GPS box).
  ```json
  {
    "busId": "BUS-01",
    "lat": 15.759314,
    "lng": 78.039152,
    "speedKmh": 24.5,
    "heading": 180,
    "satellites": 8,
    "accuracyMeters": 4
  }
  ```

---

## 5. Onelap Micro GPS Hardware Integration

You can bypass driver phone location access entirely using a **Onelap Micro GPS** hardware tracker installed in the bus:

1. Add your Onelap account credentials to `server/.env`:
   ```env
   ONELAP_ENABLED=true
   ONELAP_PHONE=your_registered_phone_number
   ONELAP_PASSWORD=your_onelap_password
   ONELAP_DEVICE_ID=115491
   ONELAP_BUS_ID=BUS-01
   ONELAP_POLL_INTERVAL_MS=5000
   ```
2. Test connection and view live GPS diagnostics:
   ```powershell
   node server/scripts/test-onelap.js
   ```
3. Start the server (`npm start`). The backend automatically polls Onelap Cloud in real-time, ingests satellite telemetry, and broadcasts live vehicle positions to all students.

---

## 6. Simulating GPS for Testing

To test bus movement on desktop without a physical drive, you can:
1. Use the **Simulator / Desktop Testing** panel directly on [http://localhost:8080/driver](http://localhost:8080/driver) (click "Step Forward" or "Auto-Drive Loop").
2. Or run the terminal simulator script:
   ```powershell
   cd server
   npm run simulate
   ```


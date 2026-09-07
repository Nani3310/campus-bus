const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const config = require("./config");
const { createStore } = require("./store");
const schedule = require("./schedule");
const { createOnelapService } = require("./integrations/onelap");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});
const store = createStore();
const onelap = createOnelapService({ config, store, io });

app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "../public")));

// Page route shortcuts
app.get("/driver", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/driver.html"));
});

// API Routes (All Public - No Authentication Required)
app.get("/api/v1/health", (_req, res) => {
  res.json({
    ok: true,
    campus: config.campus,
    onelap: {
      enabled: config.onelap.enabled,
      status: onelap.getStatus(),
    },
  });
});

app.get("/api/v1/integrations/onelap/status", (_req, res) => {
  res.json(onelap.getStatus());
});

app.get("/api/v1/campus", (_req, res) => {
  res.json(config.campus);
});


// Schedule API
app.get("/api/v1/schedule", (_req, res) => {
  const status = schedule.getStatus();
  res.json({
    stops: schedule.STOPS,
    weekday: schedule.WEEKDAY_SCHEDULE,
    weekend: schedule.WEEKEND_SCHEDULE,
    status,
  });
});

app.get("/api/v1/buses", async (_req, res) => {
  try {
    const buses = await store.listBuses();
    res.json({ buses });
  } catch (err) {
    console.error("Error listing buses:", err);
    res.status(500).json({ error: "Failed to load buses" });
  }
});

app.get("/api/v1/buses/:id", async (req, res) => {
  try {
    const bus = await store.getBus(req.params.id);
    if (!bus) return res.status(404).json({ error: "Bus not found" });
    res.json(bus);
  } catch (err) {
    console.error("Error fetching bus:", err);
    res.status(500).json({ error: "Failed to load bus" });
  }
});

// Telemetry endpoint for Driver Web App and Hardware GPS modules
app.post("/api/v1/telemetry", async (req, res) => {
  try {
    const { busId, lat, lng, speedKmh, heading, satellites, accuracyMeters, recordedAt } = req.body || {};
    const latitude = Number(lat);
    const longitude = Number(lng);

    if (!busId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: "busId, lat, and lng are required" });
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return res.status(400).json({ error: "Invalid GPS coordinates" });
    }

    const result = await store.updatePosition({
      busId: String(busId).trim(),
      lat: latitude,
      lng: longitude,
      speedKmh: speedKmh == null ? null : Number(speedKmh),
      heading: heading == null ? null : Number(heading),
      satellites: satellites == null ? null : Number(satellites),
      accuracyMeters: accuracyMeters == null ? null : Number(accuracyMeters),
      recordedAt: recordedAt || new Date().toISOString(),
    });

    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    // Broadcast live update to all connected web clients in real-time
    io.emit("bus:update", result.bus);
    res.json({ ok: true, bus: result.bus });
  } catch (err) {
    console.error("Telemetry error:", err);
    res.status(500).json({ error: "Failed to update location" });
  }
});

// Real-time Socket.IO Connection (Public - No Token Required)
io.on("connection", async (socket) => {
  try {
    const buses = await store.listBuses();
    socket.emit("buses:snapshot", buses);
  } catch (err) {
    console.error("Socket snapshot error:", err);
  }
});

async function start() {
  try {
    await store.ensureSeed();
  } catch (err) {
    console.warn("Seed info:", err.message);
  }

  // Start Onelap hardware GPS poller if enabled
  if (config.onelap.enabled) {
    onelap.start();
  }

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`\n=================================================`);
    console.log(`🚌 Campus Bus Live Tracker Server is running!`);
    console.log(`📍 Public Tracker Webpage : http://localhost:${config.port}/`);
    console.log(`📱 Driver GPS Update Page : http://localhost:${config.port}/driver`);
    console.log(`📡 Ingest API Endpoint   : POST http://localhost:${config.port}/api/v1/telemetry`);
    if (config.onelap.enabled) {
      console.log(`🛰️ Onelap GPS Ingestion  : ACTIVE (Device #${config.onelap.deviceId} -> Bus ${config.onelap.busId})`);
    } else {
      console.log(`🛰️ Onelap GPS Ingestion  : DISABLED (Set ONELAP_ENABLED=true in .env to activate)`);
    }
    console.log(`=================================================\n`);
  });
}

// Start standalone HTTP & Socket.IO server when run directly
if (!process.env.VERCEL) {
  start();
}

module.exports = app;
module.exports.server = server;
module.exports.io = io;

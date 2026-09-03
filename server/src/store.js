const { createSupabase } = require("./db");

const STALE_MS = 90_000;

const DEFAULT_BUSES = [
  {
    id: "BUS-01",
    name: "City Shuttle",
    route: "IIITDM Kurnool ↔ G. Pulla Reddy ↔ Nandyal Check post ↔ C-Camp ↔ Raj Vihar",
    color: "#1E3A8A",
    stops: [
      { id: "campus", name: "IIITDM Kurnool Campus", lat: 15.761411, lng: 78.039151 },
      { id: "gpr", name: "Pulla Reddy Engineering College", lat: 15.774741, lng: 78.058717 },
      { id: "nandyal", name: "Nandyal Check post", lat: 15.797984, lng: 78.052022 },
      { id: "ccamp", name: "C Camp Circle", lat: 15.807002, lng: 78.042479 },
      { id: "rajvihar", name: "Raj Vihar (Kurnool Center)", lat: 15.828735, lng: 78.038423 },
    ],
  },
];

function liveFromRow(row) {
  if (!row) return null;
  const recordedAt = row.recorded_at || row.recordedAt;
  const updatedAt = recordedAt ? new Date(recordedAt).getTime() : Date.now();
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    speedKmh: row.speed_kmh == null && row.speedKmh == null ? null : Number(row.speed_kmh ?? row.speedKmh),
    heading: row.heading == null ? null : Number(row.heading),
    satellites: row.satellites == null ? null : Number(row.satellites),
    accuracyMeters: row.accuracy_meters == null && row.accuracyMeters == null ? null : Number(row.accuracy_meters ?? row.accuracyMeters),
    recordedAt: recordedAt || new Date().toISOString(),
    updatedAt,
  };
}

function withLive(bus, live) {
  const updatedAt = live?.updatedAt || null;
  const stale = !updatedAt || Date.now() - updatedAt > STALE_MS;
  return { ...bus, live, stale, online: Boolean(live) && !stale };
}

function createStore() {
  let supabase = null;
  try {
    supabase = createSupabase();
  } catch (err) {
    console.log("Supabase not configured; using built-in in-memory store.");
  }

  // In-memory cache & fallback store
  const memoryBuses = new Map(DEFAULT_BUSES.map((b) => [b.id, { ...b }]));
  const memoryLatest = new Map();

  async function ensureSeed() {
    if (!supabase) return;
    try {
      const allowedIds = DEFAULT_BUSES.map((b) => b.id);

      // Clean up obsolete buses from Supabase
      const { data: existingBuses } = await supabase.from("buses").select("id");
      if (existingBuses && existingBuses.length > 0) {
        const obsolete = existingBuses.filter((b) => !allowedIds.includes(b.id)).map((b) => b.id);
        if (obsolete.length > 0) {
          await supabase.from("stops").delete().in("bus_id", obsolete);
          await supabase.from("telemetry").delete().in("bus_id", obsolete);
          await supabase.from("buses").delete().in("id", obsolete);
        }
      }

      // Upsert default buses and their stops
      for (const bus of DEFAULT_BUSES) {
        await supabase.from("buses").upsert({
          id: bus.id,
          name: bus.name,
          route: bus.route,
          color: bus.color,
        });

        await supabase.from("stops").delete().eq("bus_id", bus.id);
        for (const stop of bus.stops) {
          await supabase.from("stops").insert({
            id: stop.id,
            bus_id: bus.id,
            name: stop.name,
            lat: stop.lat,
            lng: stop.lng,
          });
        }
      }
    } catch (err) {
      console.warn("Supabase seed warning:", err.message);
    }
  }

  async function listBuses() {
    if (supabase) {
      try {
        const { data: buses, error } = await supabase.from("buses").select("*").order("id");
        if (!error && buses && buses.length > 0) {
          const { data: stops } = await supabase.from("stops").select("*");
          const { data: latestRows } = await supabase.from("bus_latest").select("*");

          const stopsByBus = new Map();
          for (const stop of stops || []) {
            const list = stopsByBus.get(stop.bus_id) || [];
            list.push({
              id: stop.id,
              name: stop.name,
              lat: Number(stop.lat),
              lng: Number(stop.lng),
            });
            stopsByBus.set(stop.bus_id, list);
          }

          const latestMap = new Map();
          for (const row of latestRows || []) {
            latestMap.set(row.bus_id, liveFromRow(row));
          }

          return buses.map((bus) => {
            const live = latestMap.get(bus.id) || memoryLatest.get(bus.id) || null;
            return withLive(
              {
                id: bus.id,
                name: bus.name,
                route: bus.route,
                color: bus.color,
                stops: stopsByBus.get(bus.id) || [],
              },
              live
            );
          });
        }
      } catch (err) {
        console.warn("Supabase fetch failed, falling back to in-memory:", err.message);
      }
    }

    // In-memory fallback
    return Array.from(memoryBuses.values()).map((bus) =>
      withLive(bus, memoryLatest.get(bus.id) || null)
    );
  }

  async function getBus(id) {
    const buses = await listBuses();
    return buses.find((b) => b.id === id) || null;
  }

  async function updatePosition(payload) {
    const busId = payload.busId;
    if (!memoryBuses.has(busId)) {
      // Check if exists in db or create dynamically
      const buses = await listBuses();
      const found = buses.find((b) => b.id === busId);
      if (!found) {
        // Register newly seen bus or reject
        memoryBuses.set(busId, {
          id: busId,
          name: `Bus ${busId}`,
          route: "Campus Route",
          color: "#2D368B",
          stops: [],
        });
      }
    }

    const live = liveFromRow(payload);
    memoryLatest.set(busId, live);

    if (supabase) {
      try {
        await supabase.from("telemetry").insert({
          bus_id: busId,
          lat: payload.lat,
          lng: payload.lng,
          speed_kmh: payload.speedKmh,
          heading: payload.heading,
          satellites: payload.satellites,
          recorded_at: payload.recordedAt || new Date().toISOString(),
        });
      } catch (err) {
        console.warn("Supabase telemetry insert error:", err.message);
      }
    }

    return { bus: await getBus(busId) };
  }

  return {
    ensureSeed,
    listBuses,
    getBus,
    updatePosition,
  };
}

module.exports = { createStore, STALE_MS };

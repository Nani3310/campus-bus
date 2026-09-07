const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { getAuthHeader, fetchDevices, fetchLatestPosition, normalizePosition } = require("../src/integrations/onelap");

const baseUrl = (process.env.ONELAP_BASE_URL || "https://web.onelap.in").replace(/\/+$/, "");
const phone = process.env.ONELAP_PHONE || "";
const password = process.env.ONELAP_PASSWORD || "";
const deviceId = process.env.ONELAP_DEVICE_ID || "";
const busId = process.env.ONELAP_BUS_ID || "BUS-01";

async function run() {
  console.log("==================================================");
  console.log("🛰️  Onelap Micro GPS Diagnostic & Connection Test");
  console.log("==================================================");
  console.log(`Endpoint Base URL : ${baseUrl}`);
  console.log(`Registered Phone  : ${phone ? phone.replace(/(\d{3})\d+(\d{2})/, "$1****$2") : "(Not set in .env)"}`);
  console.log(`Configured Device : ${deviceId || "(Not set in .env)"}`);
  console.log(`Target Bus ID     : ${busId}\n`);

  if (!phone || !password) {
    console.error("❌ ERROR: ONELAP_PHONE and ONELAP_PASSWORD are not set in server/.env.");
    console.log("👉 Please add your Onelap phone number and password to server/.env and run this test again.\n");
    process.exit(1);
  }

  // 1. Test Device List & Authentication
  console.log("📡 Step 1: Testing Onelap Authentication & Fetching Devices...");
  let devices = [];
  try {
    devices = await fetchDevices({ baseUrl, phone, password });
    console.log(`✅ Authentication Successful! Found ${devices.length} registered device(s):\n`);

    if (Array.isArray(devices) && devices.length > 0) {
      devices.forEach((d, idx) => {
        console.log(`  [${idx + 1}] ID: ${d.id}`);
        console.log(`      Name      : ${d.name || "Unnamed"}`);
        console.log(`      IMEI      : ${d.uniqueId || d.imei || "N/A"}`);
        console.log(`      Status    : ${d.status || "N/A"}`);
        console.log(`      Last Seen : ${d.lastUpdate || "N/A"}`);
        console.log(`      Validity  : ${d.validity || "N/A"}\n`);
      });
    } else {
      console.log("  ⚠️ No devices found under this account. Make sure you activated your device via Onelap app or API.\n");
    }
  } catch (err) {
    console.error(`❌ Authentication / Device fetch failed: ${err.message}`);
    console.log("👉 Please verify your phone number and password.\n");
  }

  // 2. Test Latest Position
  const cleanConfiguredId = deviceId && deviceId !== "your_device_id" ? deviceId : "";
  const targetId = cleanConfiguredId || (devices[0]?.id ? String(devices[0].id) : "");
  if (!targetId) {
    console.log("ℹ️ Note: No physical GPS device is linked to this Onelap account yet.");
    console.log("👉 When your Onelap Micro GPS tracker arrives/installs:");
    console.log("   1. Open the Onelap Mobile App on your phone.");
    console.log("   2. Add/Scan the 15-digit IMEI written on the GPS unit.");
    console.log("   3. Run 'node server/scripts/test-onelap.js' again — it will auto-detect your Device ID!\n");
    return;
  }

  console.log(`📍 Step 2: Fetching Latest GPS Position for Device #${targetId}...`);
  try {
    const raw = await fetchLatestPosition({ baseUrl, phone, password, deviceId: targetId });
    console.log("✅ Received Position Object from Onelap:");
    console.log(JSON.stringify(raw, null, 2));

    const telemetry = normalizePosition(raw, busId);
    console.log("\n🔄 Normalized Campus Bus Telemetry:");
    console.log(`  • Bus ID       : ${telemetry.busId}`);
    console.log(`  • Coordinates  : ${telemetry.lat}, ${telemetry.lng}`);
    console.log(`  • Google Maps  : https://www.google.com/maps?q=${telemetry.lat},${telemetry.lng}`);
    console.log(`  • Speed (km/h) : ${telemetry.speedKmh}`);
    console.log(`  • Heading (°)  : ${telemetry.heading ?? "N/A"}`);
    console.log(`  • Satellites   : ${telemetry.satellites ?? "N/A"}`);
    console.log(`  • Battery Level: ${raw.attributes?.battery ?? "N/A"}`);
    console.log(`  • Recorded At  : ${telemetry.recordedAt}`);
    console.log(`  • Fix Status   : ${raw.valid ? "VALID 3D FIX" : "NO GPS LOCK / CELL TOWER"}`);

    console.log("\n==================================================");
    console.log("🎉 Onelap GPS integration is working perfectly!");
    console.log("Set ONELAP_ENABLED=true in server/.env to start live tracking.");
    console.log("==================================================");
  } catch (err) {
    console.error(`❌ Failed to fetch latest position for device #${targetId}: ${err.message}\n`);
  }
}

run().catch((err) => {
  console.error("Fatal test error:", err);
});

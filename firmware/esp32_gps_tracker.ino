/*
  ESP32 + NEO-6M (or any NMEA GPS) → campus bus server
  Wiring (typical):
    GPS TX  -> ESP32 RX2 (GPIO16)
    GPS RX  -> ESP32 TX2 (GPIO17)
    GPS VCC -> 3.3V
    GPS GND -> GND
  Set Wi-Fi, SERVER_HOST, DEVICE_API_KEY, and BUS_ID before flashing.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>

const char* WIFI_SSID = "CAMPUS_WIFI";
const char* WIFI_PASS = "wifi-password";
const char* SERVER_HOST = "http://10.0.0.5:8080"; // LAN IP of the Node server
const char* DEVICE_API_KEY = "campus-bus-gps-secret";
const char* BUS_ID = "BUS-01";

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWi-Fi connected");
}

void loop() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  static unsigned long lastPost = 0;
  if (millis() - lastPost < 2000) return;
  lastPost = millis();

  if (!gps.location.isValid()) {
    Serial.println("Waiting for GPS fix...");
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    return;
  }

  String body = "{";
  body += "\"busId\":\"" + String(BUS_ID) + "\",";
  body += "\"lat\":" + String(gps.location.lat(), 6) + ",";
  body += "\"lng\":" + String(gps.location.lng(), 6) + ",";
  body += "\"speedKmh\":" + String(gps.speed.kmph(), 1) + ",";
  body += "\"heading\":" + String(gps.course.deg(), 1) + ",";
  body += "\"satellites\":" + String(gps.satellites.value());
  body += "}";

  HTTPClient http;
  http.begin(String(SERVER_HOST) + "/api/v1/telemetry");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_API_KEY);
  int code = http.POST(body);
  Serial.printf("POST %d %s\n", code, body.c_str());
  http.end();
}

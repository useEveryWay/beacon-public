#include <Arduino.h>
#include <HTTPClient.h>
#include <VL53L1X.h>
#include <WiFi.h>
#include <Wire.h>
#include <esp_random.h>

#if __has_include("config.h")
#include "config.h"
#else
#include "config.example.h"
#endif

namespace {

constexpr char kDeviceId[] = "beacon-north-ramp";
constexpr char kSchemaVersion[] = "1.0";
constexpr char kKind[] = "distance";
constexpr uint8_t kI2cSda = 4;
constexpr uint8_t kI2cScl = 5;
constexpr uint32_t kSampleIntervalMs = 1000;
constexpr uint16_t kSensorTimeoutMs = 500;

VL53L1X sensor;
char bootId[37] = {};
uint32_t deviceSeq = 0;
bool sensorReady = false;

void generateBootId(char* out, size_t outLen) {
  if (outLen < 37) {
    return;
  }
  uint8_t bytes[16];
  esp_fill_random(bytes, sizeof(bytes));
  bytes[6] = static_cast<uint8_t>((bytes[6] & 0x0f) | 0x40);
  bytes[8] = static_cast<uint8_t>((bytes[8] & 0x3f) | 0x80);
  snprintf(
      out,
      outLen,
      "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
      bytes[0],
      bytes[1],
      bytes[2],
      bytes[3],
      bytes[4],
      bytes[5],
      bytes[6],
      bytes[7],
      bytes[8],
      bytes[9],
      bytes[10],
      bytes[11],
      bytes[12],
      bytes[13],
      bytes[14],
      bytes[15]);
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const uint32_t deadline = millis() + 30000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

bool initSensor() {
  Wire.begin(kI2cSda, kI2cScl);
  Wire.setClock(400000);
  sensor.setTimeout(kSensorTimeoutMs);
  if (!sensor.init()) {
    Serial.println("VL53L1X init failed");
    return false;
  }
  sensor.setDistanceMode(VL53L1X::Long);
  sensor.setMeasurementTimingBudget(50000);
  sensor.startContinuous(kSampleIntervalMs);
  return true;
}

struct Sample {
  uint16_t distanceMm;
  bool valid;
};

bool isRangeValid(VL53L1X::RangeStatus status) {
  return status == VL53L1X::RangeValid;
}

Sample readSample() {
  Sample sample{};
  if (!sensorReady) {
    return sample;
  }
  const uint16_t distanceMm = sensor.read(true);
  if (sensor.timeoutOccurred()) {
    sample.valid = false;
    sample.distanceMm = 0;
    return sample;
  }
  sample.distanceMm = distanceMm;
  sample.valid =
      isRangeValid(sensor.ranging_data.range_status) && distanceMm > 0;
  return sample;
}

bool ensureBootIdentity() {
  if (bootId[0] != '\0') {
    return true;
  }
  if (!connectWifi()) {
    return false;
  }
  generateBootId(bootId, sizeof(bootId));
  return true;
}

bool postDeviceReading(const Sample& sample, uint32_t seq, uint32_t monotonicMs) {
  if (!ensureBootIdentity()) {
    Serial.println("WiFi not connected");
    return false;
  }

  char body[320];
  const int written = snprintf(
      body,
      sizeof(body),
      "{\"schemaVersion\":\"%s\",\"deviceId\":\"%s\",\"bootId\":\"%s\","
      "\"deviceSeq\":%lu,\"monotonicMs\":%lu,\"kind\":\"%s\",\"value\":{"
      "\"distanceMm\":%u,\"valid\":%s}}",
      kSchemaVersion,
      kDeviceId,
      bootId,
      static_cast<unsigned long>(seq),
      static_cast<unsigned long>(monotonicMs),
      kKind,
      sample.distanceMm,
      sample.valid ? "true" : "false");
  if (written <= 0 || static_cast<size_t>(written) >= sizeof(body)) {
    Serial.println("DeviceReading JSON buffer overflow");
    return false;
  }

  char url[128];
  snprintf(
      url,
      sizeof(url),
      "http://%s:%d/v1/device-readings",
      CONDUIT_HOST,
      CONDUIT_PORT);

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);
  const int status = http.POST(body);
  http.end();

  if (status < 200 || status >= 300) {
    Serial.printf("POST /v1/device-readings failed: HTTP %d\n", status);
    return false;
  }
  return true;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(100);
  deviceSeq = 0;
  bootId[0] = '\0';
  sensorReady = initSensor();
  if (ensureBootIdentity()) {
    Serial.printf("bootId=%s sensorReady=%d\n", bootId, sensorReady ? 1 : 0);
  } else {
    Serial.printf("WiFi pending sensorReady=%d\n", sensorReady ? 1 : 0);
  }
}

void loop() {
  const uint32_t monotonicMs = millis();
  deviceSeq += 1;
  const Sample sample = readSample();

  Serial.printf(
      "seq=%lu monotonicMs=%lu distanceMm=%u valid=%d\n",
      static_cast<unsigned long>(deviceSeq),
      static_cast<unsigned long>(monotonicMs),
      sample.distanceMm,
      sample.valid ? 1 : 0);

  if (!postDeviceReading(sample, deviceSeq, monotonicMs)) {
    Serial.println("ingress POST failed");
  }

  const uint32_t elapsed = millis() - monotonicMs;
  if (elapsed < kSampleIntervalMs) {
    delay(kSampleIntervalMs - elapsed);
  }
}

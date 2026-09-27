# Beacon hardware (Wave 2)

ESP32-C3 SuperMini with a CQRobot VL53L1X time-of-flight sensor. The firmware emits frozen `DeviceReading` JSON and POSTs it to Conduit `POST /v1/device-readings` with source type `sensor`.

Measurements only: no `edgeId`, obstruction labels, or route fields on the wire.

## Wiring (proposed, not confirmed on this build machine)

| VL53L1X | ESP32-C3 SuperMini |
|---------|-------------------|
| VCC     | 3V3               |
| GND     | GND               |
| SDA     | GPIO4             |
| SCL     | GPIO5             |

Default I2C address `0x29`.

## Configuration

Copy `include/config.example.h` to `include/config.h` and set WiFi and Conduit host:

- `WIFI_SSID` / `WIFI_PASSWORD`
- `CONDUIT_HOST` (hostname or IP, no scheme)
- `CONDUIT_PORT` (default `8080`)

`deviceId` is fixed to `beacon-north-ramp` to match Conduit device bindings.

## Build and flash

Requires [PlatformIO](https://platformio.org/).

```bash
cd firmware
cp include/config.example.h include/config.h
# edit include/config.h
pio run
pio run -t upload
pio device monitor
```

## Runtime behavior

- On boot: init VL53L1X, connect WiFi, then generate a new lowercase UUID `bootId`; `deviceSeq` starts at 1 on first loop.
- Each sample (~1 Hz): read distance in millimeters, set `valid` from the sensor status, attach monotonic `monotonicMs` from `millis()`, POST JSON to `/v1/device-readings`.
- Obstruction projection (including the synthetic 150 mm Atlas cutoff) stays on the server; the device does not apply it.

## JSON shape

```json
{
  "schemaVersion": "1.0",
  "deviceId": "beacon-north-ramp",
  "bootId": "<uuid>",
  "deviceSeq": 1,
  "monotonicMs": 1000,
  "kind": "distance",
  "value": {
    "distanceMm": 400,
    "valid": true
  }
}
```

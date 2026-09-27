import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Ajv2020 as Ajv } from "ajv/dist/2020.js";
import {
  createBeaconSimulator,
  DEVICE_ID,
  emitDeviceReading,
  type DeviceReading,
} from "../src/simulator/index.ts";

const CONTRACTS_DIR =
  process.env.CONDUIT_CONTRACTS_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../conduit/contracts");

type JsonObject = Record<string, unknown>;

function readContract(relativePath: string): JsonObject {
  const fullPath = resolve(CONTRACTS_DIR, relativePath);
  return JSON.parse(readFileSync(fullPath, "utf8")) as JsonObject;
}

const deviceReadingSchema = readContract("device-reading.schema.json");
const clearFixture = readContract(
  "fixtures/valid/device-reading-clear.json",
) as DeviceReading;
const blockedFixture = readContract(
  "fixtures/valid/device-reading-blocked.json",
) as DeviceReading;
const demoReset = readContract("demo-reset.json");
const moduleSeams = readContract("module-seams.json");
const clearReading = demoReset.clearReading as DeviceReading;

const ajv = new Ajv({ allErrors: true, strict: true });
const validateDeviceReading = ajv.compile(deviceReadingSchema);

function assertValidReading(reading: DeviceReading): void {
  const valid = validateDeviceReading(reading);
  assert.equal(
    valid,
    true,
    ajv.errorsText(validateDeviceReading.errors),
  );
}

function assertNoForbiddenFields(reading: DeviceReading): void {
  const serialized = JSON.stringify(reading);
  for (const key of ["edgeId", "distanceCm", "accessible", "accessibility"]) {
    assert.equal(serialized.includes(`"${key}"`), false, key);
  }
}

test("emitDeviceReading is the beacon seam and speaks device-reading", () => {
  const seams = moduleSeams.seams as Array<JsonObject>;
  const seam = seams.find((entry) => entry.name === "emitDeviceReading");
  assert.ok(seam);
  assert.equal(seam.owner, "beacon");
  assert.equal(seam.input, "device-reading");
  assert.equal(seam.output, "device-reading");
  assert.equal(typeof emitDeviceReading, "function");
});

test("clear then blocked match the frozen fixtures on one boot", () => {
  const simulator = createBeaconSimulator({ bootId: clearFixture.bootId });

  const clear = emitDeviceReading(simulator, "clear");
  const blocked = emitDeviceReading(simulator, "blocked");

  assert.deepEqual(clear, clearFixture);
  assert.deepEqual(blocked, blockedFixture);
  assert.equal(clear.deviceId, DEVICE_ID);
  assert.equal(clear.bootId, blocked.bootId);
  assert.equal(blocked.deviceSeq, clear.deviceSeq + 1);
  assert.ok(blocked.monotonicMs > clear.monotonicMs);
  assert.ok(clear.monotonicMs < 1_000_000_000);
  assertValidReading(clear);
  assertValidReading(blocked);
  assertNoForbiddenFields(clear);
  assertNoForbiddenFields(blocked);
});

test("reset changes boot identity and restarts sequence without setting Atlas clear", () => {
  const steps = demoReset.steps as string[];
  const mustNot = demoReset.mustNot as string[];
  assert.equal(
    steps.indexOf("reset-simulator-boot-identity") <
      steps.indexOf("ingress-simulated-clear-device-reading"),
    true,
  );
  assert.ok(mustNot.includes("set-obstruction-clear-directly"));

  const initialBootId = "11111111-1111-4111-8111-111111111111";
  const bootIds = [
    clearReading.bootId,
    "00000000-0000-4000-8000-0000000000c3",
  ];
  let index = 0;
  const simulator = createBeaconSimulator({
    bootId: initialBootId,
    createBootId: () => {
      const bootId = bootIds[index];
      index += 1;
      if (bootId === undefined) {
        throw new Error("test boot id sequence exhausted");
      }
      return bootId;
    },
  });

  emitDeviceReading(simulator, "blocked");
  const resetResult = simulator.reset();

  assert.deepEqual(Object.keys(resetResult).sort(), [
    "bootId",
    "deviceId",
    "nextDeviceSeq",
  ]);
  assert.equal(resetResult.deviceId, clearReading.deviceId);
  assert.notEqual(resetResult.bootId, initialBootId);
  assert.equal(resetResult.bootId, clearReading.bootId);
  assert.equal(resetResult.nextDeviceSeq, clearReading.deviceSeq);
  assert.equal("value" in resetResult, false);

  const clear = emitDeviceReading(simulator, "clear");
  assert.deepEqual(clear, clearReading);
  assert.deepEqual(clear, clearFixture);
  assertValidReading(clear);
  assertNoForbiddenFields(clear);

  const blocked = emitDeviceReading(simulator, "blocked");
  assert.deepEqual(blocked, blockedFixture);
  assert.equal(blocked.value.distanceMm, 84);
  assert.equal(blocked.value.valid, true);
  assertValidReading(blocked);

  const restored = emitDeviceReading(simulator, "clear");
  assert.equal(restored.bootId, clear.bootId);
  assert.equal(restored.deviceSeq, 3);
  assert.equal(restored.monotonicMs, 3000);
  assert.equal(restored.value.distanceMm, clearFixture.value.distanceMm);
  assert.equal(restored.value.valid, clearFixture.value.valid);
  assertValidReading(restored);
  assertNoForbiddenFields(restored);

  const secondReset = simulator.reset();
  assert.notEqual(secondReset.bootId, clear.bootId);
  assert.equal(secondReset.nextDeviceSeq, clearReading.deviceSeq);
  const afterSecondReset = emitDeviceReading(simulator, "clear");
  assert.equal(afterSecondReset.bootId, secondReset.bootId);
  assert.equal(afterSecondReset.deviceSeq, clearReading.deviceSeq);
  assert.equal(afterSecondReset.monotonicMs, clearReading.monotonicMs);
  assert.equal(
    afterSecondReset.value.distanceMm,
    clearReading.value.distanceMm,
  );
  assert.equal(afterSecondReset.value.valid, clearReading.value.valid);
  assertValidReading(afterSecondReset);
});

test("default reset uses a new boot id and the clear fixture distance", () => {
  const simulator = createBeaconSimulator();
  const firstBootId = simulator.bootId;
  emitDeviceReading(simulator, "clear");
  emitDeviceReading(simulator, "blocked");

  const resetResult = simulator.reset();
  assert.notEqual(resetResult.bootId, firstBootId);
  assert.equal(resetResult.nextDeviceSeq, 1);
  assert.equal(resetResult.deviceId, "beacon-north-ramp");

  const clear = emitDeviceReading(simulator, "clear");
  assert.equal(clear.deviceId, clearFixture.deviceId);
  assert.equal(clear.bootId, resetResult.bootId);
  assert.equal(clear.deviceSeq, clearFixture.deviceSeq);
  assert.equal(clear.monotonicMs, clearFixture.monotonicMs);
  assert.equal(clear.kind, "distance");
  assert.equal(clear.schemaVersion, "1.0");
  assert.deepEqual(clear.value, clearFixture.value);
  assertValidReading(clear);
  assertNoForbiddenFields(clear);
});

test("frozen schema rejects edge, centimeter, and accessibility fields", () => {
  const invalidPaths = [
    "fixtures/invalid/device-reading-edge-id.json",
    "fixtures/invalid/device-reading-distance-cm.json",
    "fixtures/invalid/device-reading-accessible.json",
  ];
  for (const relativePath of invalidPaths) {
    const invalid = readContract(relativePath);
    assert.equal(validateDeviceReading(invalid), false, relativePath);
  }
});

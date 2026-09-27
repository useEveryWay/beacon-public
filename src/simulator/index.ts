import { randomUUID } from "node:crypto";

export const SCHEMA_VERSION = "1.0" as const;
export const DEVICE_ID = "beacon-north-ramp" as const;
export const CLEAR_DISTANCE_MM = 400;
export const BLOCKED_DISTANCE_MM = 84;

const MONOTONIC_STEP_MS = 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ReadingScenario = "clear" | "blocked";

export type DeviceReading = {
  schemaVersion: typeof SCHEMA_VERSION;
  deviceId: typeof DEVICE_ID;
  bootId: string;
  deviceSeq: number;
  monotonicMs: number;
  kind: "distance";
  value: {
    distanceMm: number;
    valid: true;
  };
};

export type BootReset = {
  deviceId: typeof DEVICE_ID;
  bootId: string;
  nextDeviceSeq: 1;
};

export type BeaconSimulatorOptions = {
  bootId?: string;
  createBootId?: () => string;
};

const DISTANCE_MM: Record<ReadingScenario, number> = {
  clear: CLEAR_DISTANCE_MM,
  blocked: BLOCKED_DISTANCE_MM,
};

function assertBootId(bootId: string): string {
  if (!UUID_PATTERN.test(bootId)) {
    throw new Error(`bootId must be a lowercase UUID, received ${bootId}`);
  }
  return bootId;
}

export class BeaconSimulator {
  readonly deviceId = DEVICE_ID;
  #bootId: string;
  #nextDeviceSeq = 1;
  readonly #createBootId: () => string;

  constructor(options: BeaconSimulatorOptions = {}) {
    this.#createBootId = options.createBootId ?? randomUUID;
    this.#bootId = assertBootId(options.bootId ?? this.#createBootId());
  }

  get bootId(): string {
    return this.#bootId;
  }

  get nextDeviceSeq(): number {
    return this.#nextDeviceSeq;
  }

  emitDeviceReading(scenario: ReadingScenario): DeviceReading {
    const distanceMm = DISTANCE_MM[scenario];
    if (distanceMm === undefined) {
      throw new Error(`unsupported reading scenario: ${String(scenario)}`);
    }

    const reading: DeviceReading = {
      schemaVersion: SCHEMA_VERSION,
      deviceId: this.deviceId,
      bootId: this.#bootId,
      deviceSeq: this.#nextDeviceSeq,
      monotonicMs: this.#nextDeviceSeq * MONOTONIC_STEP_MS,
      kind: "distance",
      value: {
        distanceMm,
        valid: true,
      },
    };
    this.#nextDeviceSeq += 1;
    return reading;
  }

  reset(): BootReset {
    const previous = this.#bootId;
    let next = assertBootId(this.#createBootId());
    if (next === previous) {
      next = assertBootId(this.#createBootId());
    }
    if (next === previous) {
      throw new Error("reset must change bootId");
    }

    this.#bootId = next;
    this.#nextDeviceSeq = 1;
    return {
      deviceId: this.deviceId,
      bootId: this.#bootId,
      nextDeviceSeq: 1,
    };
  }
}

export function createBeaconSimulator(
  options?: BeaconSimulatorOptions,
): BeaconSimulator {
  return new BeaconSimulator(options);
}

export function emitDeviceReading(
  simulator: BeaconSimulator,
  scenario: ReadingScenario,
): DeviceReading {
  return simulator.emitDeviceReading(scenario);
}

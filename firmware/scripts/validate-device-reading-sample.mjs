#!/usr/bin/env node
/**
 * Host check: sample hardware-shaped JSON validates against frozen device-reading schema.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const contractsDir =
  process.env.CONDUIT_CONTRACTS_DIR ??
  fileURLToPath(new URL("../../../conduit/contracts/", import.meta.url));

const schema = JSON.parse(
  readFileSync(resolve(contractsDir, "device-reading.schema.json"), "utf8"),
);
const sample = JSON.parse(
  readFileSync(resolve(here, "sample-device-reading.json"), "utf8"),
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
if (!validate(sample)) {
  console.error(ajv.errorsText(validate.errors));
  process.exit(1);
}

const forbidden = ["edgeId", "blocked", "accessible", "route", "distanceCm"];
const text = JSON.stringify(sample);
for (const key of forbidden) {
  if (text.includes(`"${key}"`)) {
    console.error(`forbidden field present: ${key}`);
    process.exit(1);
  }
}

console.log("sample DeviceReading validates");

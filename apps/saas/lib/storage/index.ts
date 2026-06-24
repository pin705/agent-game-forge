import type { Storage } from "./types";
import { LocalStorage } from "./local";
import { R2Storage } from "./r2";

export type { Storage, ProjectFile } from "./types";
export { textFile, fileText } from "./types";

let cached: Storage | null = null;

/** True when every R2 env var is present (i.e. prod storage is configured). */
function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

/**
 * Storage factory. Returns R2Storage when R2 is fully configured, else the
 * filesystem-backed LocalStorage (dev default — zero accounts).
 */
export function getStorage(): Storage {
  if (cached) return cached;
  // Constructing R2Storage only reads env; the S3 SDK is imported lazily inside
  // its methods, so no network/SDK load happens at module import or for the
  // local path.
  cached = r2Configured() ? new R2Storage() : new LocalStorage();
  return cached;
}

/** Test/diagnostic helper — which driver would be selected, without building it. */
export function storageDriverName(): "r2" | "local" {
  return r2Configured() ? "r2" : "local";
}

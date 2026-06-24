/**
 * User secrets — API keys for image-gen providers, agent CLIs, etc.
 *
 * Stored as JSON in the user's home dir, NOT in the project DB. Keys are
 * per-user (one OpenAI key works across all projects), not per-project.
 *
 * Storage: `~/.ogf/secrets.json`
 *   - File mode 600 (owner read/write only) on POSIX
 *   - Windows: NTFS default ACL — directory under %USERPROFILE% is already
 *     restricted to the current user; mode bits aren't honored but the path
 *     is equivalent in trust to ~/.ssh on POSIX.
 *
 * Env-var precedence: if `OPENAI_API_KEY` (etc.) is set in the daemon's
 * environment, it ALWAYS wins over the file. This is the escape hatch for
 * CI, power users, dynamic injection via 1Password CLI, etc. The Settings
 * UI surfaces "shadowed by env" so the user isn't confused why their saved
 * value doesn't apply.
 *
 * No encryption: see the design discussion — for a single-user local-first
 * tool whose threat model is "don't accidentally commit to git", file mode
 * 600 in user home is equivalent to ~/.aws/credentials / ~/.ssh/id_rsa.
 * Adding keychain (keytar) costs a native dep without changing the
 * realistic threat surface.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';

/** Canonical secret keys. Add new providers here as multi-CLI grows. */
export type SecretKey =
  | 'openai_api_key'
  | 'gemini_api_key'
  | 'anthropic_api_key'
  | 'cloudflare_api_token'
  | 'cloudflare_account_id';

const ALL_KEYS: SecretKey[] = [
  'openai_api_key',
  'gemini_api_key',
  'anthropic_api_key',
  'cloudflare_api_token',
  'cloudflare_account_id',
];

/** Env var that shadows each secret. When set, the env value is what gets
 *  used at runtime, regardless of what's in the file. */
const ENV_VAR_FOR: Record<SecretKey, string> = {
  openai_api_key: 'OPENAI_API_KEY',
  gemini_api_key: 'GEMINI_API_KEY',
  anthropic_api_key: 'ANTHROPIC_API_KEY',
  cloudflare_api_token: 'CLOUDFLARE_API_TOKEN',
  cloudflare_account_id: 'CLOUDFLARE_ACCOUNT_ID',
};

function secretsDir(): string {
  return path.join(homedir(), '.ogf');
}

function secretsPath(): string {
  return path.join(secretsDir(), 'secrets.json');
}

function ensureDir(): void {
  const d = secretsDir();
  if (!existsSync(d)) {
    mkdirSync(d, { recursive: true });
    // 0700 = owner-only dir on POSIX. No-op on Windows but the path is
    // under %USERPROFILE% which is already user-scoped by default ACL.
    if (platform() !== 'win32') {
      try {
        chmodSync(d, 0o700);
      } catch {
        // best-effort; if chmod fails the file still works
      }
    }
  }
}

function readFile(): Partial<Record<SecretKey, string>> {
  const p = secretsPath();
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Partial<Record<SecretKey, string>> = {};
    for (const k of ALL_KEYS) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    return out;
  } catch {
    // Corrupt file — treat as empty rather than crashing the daemon. User
    // can re-enter keys via Settings; their actual API access is unaffected.
    return {};
  }
}

function writeFile(contents: Partial<Record<SecretKey, string>>): void {
  ensureDir();
  const p = secretsPath();
  writeFileSync(p, JSON.stringify(contents, null, 2) + '\n', 'utf8');
  if (platform() !== 'win32') {
    try {
      chmodSync(p, 0o600);
    } catch {
      // best-effort
    }
  }
}

/** Resolved value for a secret — env var if set, else stored file value,
 *  else undefined. This is what the daemon's image-gen router should call. */
export function resolveSecret(key: SecretKey): string | undefined {
  const envVal = process.env[ENV_VAR_FOR[key]];
  if (envVal && envVal.length > 0) return envVal;
  const stored = readFile()[key];
  return stored;
}

/** All secrets, resolved (env > file). Mainly for the image-gen router to
 *  pick the right provider based on which keys are present. */
export function resolveAllSecrets(): Partial<Record<SecretKey, string>> {
  const out: Partial<Record<SecretKey, string>> = {};
  for (const k of ALL_KEYS) {
    const v = resolveSecret(k);
    if (v) out[k] = v;
  }
  return out;
}

/** Mask a value for display: keep first 3 + last 4 chars, dot-fill middle.
 *  "sk-proj-abc123xyz..." → "sk-•••••••xyz". */
function mask(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 3)}${'•'.repeat(7)}${value.slice(-4)}`;
}

/** Status reported to the UI. Never returns the actual key — masked +
 *  flags so the user knows what's set and where it's coming from. */
export interface SecretStatus {
  key: SecretKey;
  /** True when a value resolves (env or file). */
  set: boolean;
  /** True when the env var shadows the file. UI should show "uses env var"
   *  and disable the input. */
  fromEnv: boolean;
  /** Masked value for display when set. Empty string when unset. */
  masked: string;
  /** Env var name we look at for this key — surfaced so the UI can show
   *  "set OPENAI_API_KEY in your shell to override". */
  envVarName: string;
}

export function listSecretStatuses(): SecretStatus[] {
  const fileVals = readFile();
  return ALL_KEYS.map((key) => {
    const envName = ENV_VAR_FOR[key];
    const envVal = process.env[envName];
    const fromEnv = !!(envVal && envVal.length > 0);
    const resolved = fromEnv ? envVal! : fileVals[key];
    return {
      key,
      set: !!resolved,
      fromEnv,
      masked: resolved ? mask(resolved) : '',
      envVarName: envName,
    };
  });
}

/** Save a single secret. Pass empty string or null to clear it. */
export function setSecret(key: SecretKey, value: string | null): void {
  if (!ALL_KEYS.includes(key)) throw new Error(`unknown secret key: ${key}`);
  const cur = readFile();
  if (value === null || value === '') {
    delete cur[key];
  } else {
    cur[key] = value;
  }
  writeFile(cur);
}

/** Check that a key id is valid before accepting it from an HTTP body. */
export function isSecretKey(s: unknown): s is SecretKey {
  return typeof s === 'string' && (ALL_KEYS as string[]).includes(s);
}

/**
 * User preferences — non-sensitive defaults that the daemon needs to know.
 *
 * Kept separate from secrets.ts because:
 *   - Secrets are sensitive (API keys), need masking + env shadowing.
 *   - Prefs are just settings the daemon consults at request time.
 *
 * Storage: `~/.ogf/preferences.json` (plain JSON, no encryption, no env
 * shadowing). Edit-from-disk is fine — daemon re-reads every call.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type ImageGenProvider = 'gemini' | 'openai';
export type ImageGenProviderPref = 'auto' | ImageGenProvider;

export interface ImageGenPrefs {
  /** 'auto' = prefer Gemini if keyed, else OpenAI. */
  provider: ImageGenProviderPref;
  /** Default Gemini model when provider resolves to gemini. */
  geminiModel: string;
  /** Default OpenAI model when provider resolves to openai. */
  openaiModel: string;
}

export interface Preferences {
  image_gen: ImageGenPrefs;
}

const DEFAULTS: Preferences = {
  image_gen: {
    provider: 'auto',
    geminiModel: 'gemini-2.5-flash-image',
    openaiModel: 'gpt-image-1',
  },
};

function prefsPath(): string {
  return path.join(homedir(), '.ogf', 'preferences.json');
}

function ensureDir(): void {
  const d = path.dirname(prefsPath());
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function readPreferences(): Preferences {
  const p = prefsPath();
  if (!existsSync(p)) return DEFAULTS;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return DEFAULTS;
    // Shallow-merge with defaults so missing keys don't blow up the daemon.
    const ig = (parsed as { image_gen?: Partial<ImageGenPrefs> }).image_gen ?? {};
    const provider: ImageGenProviderPref =
      ig.provider === 'gemini' || ig.provider === 'openai' ? ig.provider : 'auto';
    return {
      image_gen: {
        provider,
        geminiModel: typeof ig.geminiModel === 'string' && ig.geminiModel.length > 0
          ? ig.geminiModel
          : DEFAULTS.image_gen.geminiModel,
        openaiModel: typeof ig.openaiModel === 'string' && ig.openaiModel.length > 0
          ? ig.openaiModel
          : DEFAULTS.image_gen.openaiModel,
      },
    };
  } catch {
    return DEFAULTS;
  }
}

export function writePreferences(prefs: Preferences): void {
  ensureDir();
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2) + '\n', 'utf8');
}

export function isImageGenProviderPref(v: unknown): v is ImageGenProviderPref {
  return v === 'auto' || v === 'gemini' || v === 'openai';
}

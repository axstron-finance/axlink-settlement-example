/**
 * Configuration from the environment, with an optional `.env` file in the project folder.
 *
 * No dependency: a tiny KEY=VALUE reader. Variables already set in the shell win over the file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Environment } from './types';

export type { Environment };

/** The production host. The client appends /api/v1. Sandbox and production share it: the API key picks the environment. */
export const DEFAULT_BASE_URL = 'https://axlink.appraglobal.com';

export function loadDotEnv(file = resolve(__dirname, '..', '.env')): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** The environment an API key belongs to, from its prefix. `null` when the prefix is not recognised. */
export function environmentOfKey(apiKey: string): Environment | null {
  if (apiKey.startsWith('axlk_test_')) return 'SANDBOX';
  if (apiKey.startsWith('axlk_live_')) return 'PRODUCTION';
  return null;
}

export interface Config {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  /** From the key prefix; `null` if the prefix is unknown (the demo then treats the key as production). */
  environment: Environment | null;
  allowProductionWrites: boolean;
}

export function loadConfig(): Config {
  loadDotEnv();
  const apiKey = (process.env.AXLINK_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('AXLINK_API_KEY is not set. Copy .env.example to .env and put your API key in it (axlk_test_... for the sandbox).');
  }
  const timeoutMs = Number(process.env.AXLINK_TIMEOUT_MS ?? 30_000);
  return {
    apiKey,
    baseUrl: (process.env.AXLINK_BASE_URL ?? '').trim() || DEFAULT_BASE_URL,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
    environment: environmentOfKey(apiKey),
    allowProductionWrites: process.env.ALLOW_PRODUCTION_WRITES === 'true',
  };
}

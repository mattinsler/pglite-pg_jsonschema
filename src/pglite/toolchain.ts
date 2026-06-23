import path from 'node:path';

import type { EmscriptenToolchain } from './types.js';

const VERSION_RE = /(\d+\.\d+\.\d+)/;

export function parseEmccVersion(output: string): string | null {
  const match = VERSION_RE.exec(output);
  return match ? (match[1] ?? null) : null;
}

export function resolveToolchain(
  env: Record<string, string | undefined>,
  envVar = 'EMSDK'
): EmscriptenToolchain {
  const emsdkPath = env[envVar];
  if (!emsdkPath) {
    throw new Error(
      `${envVar} environment variable is not set. Install the Emscripten SDK and set ${envVar} to its root directory.`
    );
  }

  const emccPath = path.join(emsdkPath, 'upstream', 'emscripten', 'emcc');

  return {
    emsdkPath,
    emccPath,
    version: 'unknown',
  };
}

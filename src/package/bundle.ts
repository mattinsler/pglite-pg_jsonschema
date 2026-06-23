import type { PipelineResult } from '../build/types.js';
import { generateControlFile } from './control.js';
import type { ExtensionBundle } from './types.js';

export interface BundleIdentity {
  readonly name: string;
  readonly version: string;
}

export function createBundle(
  pipeline: PipelineResult,
  wasmBytes: Uint8Array,
  identity: BundleIdentity
): ExtensionBundle {
  if (!pipeline.success) {
    throw new Error('Cannot bundle a failed pipeline result');
  }

  return {
    name: identity.name,
    version: identity.version,
    wasmBytes,
    setupSql: pipeline.prepare.sql,
    controlFile: generateControlFile(identity.name, identity.version),
  };
}

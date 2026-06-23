import type { PipelineResult } from '../build/types.js';
import { createBundle } from './bundle.js';
import { generateEntryPoint } from './descriptor.js';
import { generateManifest } from './manifest.js';
import type { PackageConfig, PackageFiles } from './types.js';

export interface AssembleOptions {
  readonly name: string;
  readonly version: string;
  readonly config?: PackageConfig;
}

export function assemblePackage(
  pipeline: PipelineResult,
  wasmBytes: Uint8Array,
  options: AssembleOptions
): PackageFiles {
  const bundle = createBundle(pipeline, wasmBytes, {
    name: options.name,
    version: options.version,
  });

  const manifest = generateManifest(options.name, options.version, options.config);

  const entryPoint = generateEntryPoint(options.name, bundle.setupSql);

  return { manifest, entryPoint, bundle };
}

import path from 'node:path';

import type { CompilerFlags, PGliteExtensionConfig } from './types.js';

export function buildCompilerFlags(config: PGliteExtensionConfig): CompilerFlags {
  const optimization = `-${config.optimization ?? 'O2'}`;
  const allExports = new Set(['__PG_init', ...(config.exportedFunctions ?? [])]);
  const exportList = `EXPORTED_FUNCTIONS=[${[...allExports].map((e) => `'${e}'`).join(',')}]`;
  const outputFile = path.join(config.outputDir, `${config.name}.wasm`);

  const args: string[] = [
    optimization,
    `-I${config.pgIncludeDir}`,
    ...(config.extraFlags ?? []),
    '-s',
    'SIDE_MODULE=1',
    '-s',
    exportList,
    ...config.sources,
    '-o',
    outputFile,
  ];

  return { args };
}

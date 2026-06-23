import type { PackageConfig, PackageManifest } from './types.js';

export function generateManifest(
  extensionName: string,
  version: string,
  config?: PackageConfig
): PackageManifest {
  const name = config?.scope ? `${config.scope}/${extensionName}` : extensionName;

  return {
    name,
    version,
    description: config?.description ?? `PGlite extension: ${extensionName}`,
    type: 'module',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    files: ['dist/', `${extensionName}.tar.gz`],
    peerDependencies: {
      '@electric-sql/pglite': config?.pgliteVersion ?? '>=0.2.0',
    },
    license: config?.license ?? 'MIT',
  };
}

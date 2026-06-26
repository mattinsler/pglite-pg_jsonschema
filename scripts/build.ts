import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { compileExtension } from '../src/build/compile.js';
import { prepareSources } from '../src/build/prepare.js';
import type { BuildPipelineConfig, PipelineResult, RunCommand } from '../src/build/types.js';
import { assemblePackage } from '../src/package/assemble.js';
import type { PgExtensionDef } from '../src/pgext/types.js';
import { resolveToolchain } from '../src/pglite/toolchain.js';
import { validateWasmModule } from '../src/pglite/validate.js';

const extensionPath = path.resolve('extensions/pg_jsonschema.ts');
const pgIncludeDir = path.resolve('vendor/postgres/include');
const extModule = await import(path.resolve(extensionPath));
const extension: PgExtensionDef = extModule.default;
if (!extension?.name || !extension?.functions) {
  console.error(
    `Extension file must default-export a PgExtensionDef. Got: ${JSON.stringify(extension)}`
  );
  process.exit(1);
}

const extraFlags: string[] = extModule.extraFlags ?? [];

const toolchain = resolveToolchain(process.env);
const outDir = path.resolve('dist');
const buildDir = path.resolve('.build');

await mkdir(buildDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const config: BuildPipelineConfig = {
  extension,
  toolchain,
  pgIncludeDir,
  buildDir,
  extraFlags,
};

const run: RunCommand = async (command, args) => {
  const proc = Bun.spawn([command, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
};

console.log(`Building ${extension.name} v${extension.version}...`);

const prepare = prepareSources(config);
await Bun.write(prepare.cSourcePath, prepare.cSource);
await Bun.write(prepare.sqlPath, prepare.sql);

const compile = await compileExtension(config, prepare, run);
if (!compile.success) {
  console.error('Compilation failed:');
  console.error(compile.stderr);
  process.exit(1);
}

const wasmBytes = new Uint8Array(await Bun.file(compile.wasmPath).arrayBuffer());
const requiredExports = ['_PG_init', ...extension.functions.map((fn) => fn.name)];
const validation = validateWasmModule(wasmBytes, {
  requireExports: requiredExports,
});
if (!validation.valid) {
  console.error('WASM validation failed:');
  for (const err of validation.errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(`Compiled WASM: ${wasmBytes.length} bytes, ${validation.exports.length} exports`);

const pipelineResult: PipelineResult = {
  success: true,
  prepare,
  compile,
  validation,
  errors: [],
  durationMs: 0,
};

const pkg = assemblePackage(pipelineResult, wasmBytes, {
  name: extension.name,
  version: extension.version,
});

await Bun.write(path.join(outDir, 'index.js'), pkg.entryPoint);
await Bun.write(
  path.join(outDir, 'index.d.ts'),
  `export declare function ${extension.name}(): {\n` +
    `  name: string;\n` +
    `  setup: (pg: any, emscriptenOpts: any) => Promise<{\n` +
    `    emscriptenOpts: any;\n` +
    `    bundlePath: URL;\n` +
    `  }>;\n` +
    `};\n`
);

// Build the optional `./drizzle` subpath export: a JS bundle (packages kept
// external) plus its type declarations, so consumers on plain Node can use it
// without a TypeScript-aware bundler.
const drizzleSrc = path.resolve('src/drizzle.ts');
const drizzleJs = await run('bun', [
  'build',
  drizzleSrc,
  '--target=node',
  '--format=esm',
  '--packages=external',
  '--outfile',
  path.join(outDir, 'drizzle.js'),
]);
if (drizzleJs.exitCode !== 0) {
  console.error('Failed to build dist/drizzle.js:');
  console.error(drizzleJs.stderr);
  process.exit(1);
}

const drizzleDts = await run('tsc', ['-p', path.resolve('tsconfig.build.json')]);
if (drizzleDts.exitCode !== 0) {
  console.error('Failed to emit dist/drizzle.d.ts:');
  console.error(drizzleDts.stdout || drizzleDts.stderr);
  process.exit(1);
}

const tarDir = path.join(outDir, '.tar-staging');
const shareDir = path.join(tarDir, 'share', 'postgresql', 'extension');
const libDir = path.join(tarDir, 'lib', 'postgresql');
await mkdir(shareDir, { recursive: true });
await mkdir(libDir, { recursive: true });

await Bun.write(path.join(shareDir, `${extension.name}.control`), pkg.bundle.controlFile);
await Bun.write(
  path.join(shareDir, `${extension.name}--${extension.version}.sql`),
  pkg.bundle.setupSql
);
await Bun.write(path.join(libDir, `${extension.name}.so`), pkg.bundle.wasmBytes);

const tarProc = Bun.spawn(
  ['tar', '-czf', path.join(outDir, `${extension.name}.tar.gz`), '-C', tarDir, 'share', 'lib'],
  { stdout: 'pipe', stderr: 'pipe' }
);
if ((await tarProc.exited) !== 0) {
  console.error('tar failed');
  process.exit(1);
}

const { rm } = await import('node:fs/promises');
await rm(tarDir, { recursive: true });

console.log(`Package assembled in ${outDir}/`);

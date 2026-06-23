import path from 'node:path';

import { buildCompilerFlags } from '../pglite/flags.js';
import type { PGliteExtensionConfig } from '../pglite/types.js';
import type { BuildPipelineConfig, CompileResult, PrepareResult, RunCommand } from './types.js';

export async function compileExtension(
  config: BuildPipelineConfig,
  prepare: PrepareResult,
  run: RunCommand
): Promise<CompileResult> {
  const { extension, toolchain, pgIncludeDir, buildDir, extraFlags } = config;

  // Emscripten mangles C symbols by prefixing an underscore; `_PG_init` is
  // handled inside buildCompilerFlags, so only the SQL-callable functions
  // need to be listed here.
  const exportedFunctions = extension.functions.map((fn) => `_${fn.name}`);

  const pgliteConfig: PGliteExtensionConfig = {
    name: extension.name,
    version: extension.version,
    sources: [prepare.cSourcePath],
    pgIncludeDir,
    outputDir: buildDir,
    exportedFunctions,
    extraFlags,
  };

  const flags = buildCompilerFlags(pgliteConfig);
  const wasmPath = path.join(buildDir, `${extension.name}.wasm`);

  const result = await run(toolchain.emccPath, flags.args);

  return {
    success: result.exitCode === 0,
    wasmPath,
    command: toolchain.emccPath,
    args: flags.args,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

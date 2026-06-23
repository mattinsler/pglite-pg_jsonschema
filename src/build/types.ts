import type { PgExtensionDef } from '../pgext/types.js';
import type { EmscriptenToolchain, WasmValidation } from '../pglite/types.js';

export interface BuildPipelineConfig {
  readonly extension: PgExtensionDef;
  readonly toolchain: EmscriptenToolchain;
  readonly pgIncludeDir: string;
  readonly buildDir: string;
  readonly extraFlags: readonly string[];
}

export interface RunCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type RunCommand = (
  command: string,
  args: readonly string[]
) => Promise<RunCommandResult>;

export interface PrepareResult {
  readonly cSource: string;
  readonly cSourcePath: string;
  readonly sql: string;
  readonly sqlPath: string;
}

export interface CompileResult {
  readonly success: boolean;
  readonly wasmPath: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
}

export interface PipelineResult {
  readonly success: boolean;
  readonly prepare: PrepareResult;
  readonly compile: CompileResult;
  readonly validation: WasmValidation;
  readonly errors: readonly string[];
  readonly durationMs: number;
}

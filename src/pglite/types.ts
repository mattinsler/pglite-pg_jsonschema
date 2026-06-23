export interface EmscriptenToolchain {
  readonly emsdkPath: string;
  readonly emccPath: string;
  readonly version: string;
}

export interface PGliteExtensionConfig {
  readonly name: string;
  readonly version: string;
  readonly sources: readonly string[];
  readonly pgIncludeDir: string;
  readonly outputDir: string;
  readonly optimization?: OptimizationLevel;
  readonly exportedFunctions?: readonly string[];
  readonly extraFlags?: readonly string[];
}

export type OptimizationLevel = 'O0' | 'O1' | 'O2' | 'O3' | 'Os' | 'Oz';

export interface CompilerFlags {
  readonly args: readonly string[];
}

export interface BuildArtifact {
  readonly name: string;
  readonly wasmPath: string;
  readonly size: number;
}

export interface BuildResult {
  readonly success: boolean;
  readonly artifact?: BuildArtifact;
  readonly errors: readonly string[];
  readonly durationMs: number;
}

export interface WasmValidation {
  readonly valid: boolean;
  readonly exports: readonly string[];
  readonly errors: readonly string[];
}

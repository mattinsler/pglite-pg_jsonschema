export interface ExtensionBundle {
  readonly name: string;
  readonly version: string;
  readonly wasmBytes: Uint8Array;
  readonly setupSql: string;
  readonly controlFile: string;
}

export interface PackageConfig {
  readonly scope?: string;
  readonly description?: string;
  readonly license?: string;
  readonly pgliteVersion?: string;
}

export interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly type: 'module';
  readonly main: string;
  readonly types: string;
  readonly files: readonly string[];
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly license: string;
}

export interface PackageFiles {
  readonly manifest: PackageManifest;
  readonly entryPoint: string;
  readonly bundle: ExtensionBundle;
}

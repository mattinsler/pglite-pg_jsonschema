export type PgTypeId = 'bool' | 'text' | 'jsonb' | 'int4' | 'int8' | 'float4' | 'float8';

export interface PgArgDef {
  readonly name: string;
  readonly pgType: PgTypeId;
}

export interface PgFunctionDef {
  readonly name: string;
  readonly args: readonly PgArgDef[];
  readonly returnType: PgTypeId;
  readonly body: string;
  readonly strict?: boolean;
  readonly volatility?: 'immutable' | 'stable' | 'volatile';
}

export interface PgExtensionDef {
  readonly name: string;
  readonly version: string;
  readonly functions: readonly PgFunctionDef[];
  readonly includes?: readonly string[];
  readonly preamble?: string;
  readonly initBody?: string;
}

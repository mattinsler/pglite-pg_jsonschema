import path from 'node:path';

import { generateExtensionC } from '../pgext/codegen.js';
import { generateExtensionSQL } from '../pgext/sql.js';
import type { BuildPipelineConfig, PrepareResult } from './types.js';

export function prepareSources(config: BuildPipelineConfig): PrepareResult {
  const { extension, buildDir } = config;

  const cSource = generateExtensionC(extension);
  const sql = generateExtensionSQL(extension);

  const cSourcePath = path.join(buildDir, `${extension.name}.c`);
  const sqlPath = path.join(buildDir, `${extension.name}--${extension.version}.sql`);

  return { cSource, cSourcePath, sql, sqlPath };
}

import type { PgExtensionDef, PgTypeId } from './types.js';

const PG_SQL_TYPES: Record<PgTypeId, string> = {
  bool: 'boolean',
  text: 'text',
  jsonb: 'jsonb',
  int4: 'integer',
  int8: 'bigint',
  float4: 'real',
  float8: 'double precision',
};

export function generateExtensionSQL(def: PgExtensionDef): string {
  const out: string[] = [];

  for (const fn of def.functions) {
    const argList = fn.args.map((a) => `${a.name} ${PG_SQL_TYPES[a.pgType]}`).join(', ');

    const returnType = PG_SQL_TYPES[fn.returnType];
    const volatility = (fn.volatility ?? 'volatile').toUpperCase();
    const strict = fn.strict ? ' STRICT' : '';

    out.push(`CREATE FUNCTION ${fn.name}(${argList})`);
    out.push(`RETURNS ${returnType}`);
    out.push(`AS '$libdir/${def.name}'`);
    out.push(`LANGUAGE C ${volatility}${strict};`);
    out.push('');
  }

  return out.join('\n');
}

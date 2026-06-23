import type { PgExtensionDef, PgFunctionDef, PgTypeId } from './types.js';

const PG_TYPE_HEADERS: Record<PgTypeId, string | null> = {
  bool: null,
  text: 'utils/builtins.h',
  jsonb: 'utils/jsonb.h',
  int4: null,
  int8: null,
  float4: null,
  float8: null,
};

function collectHeaders(def: PgExtensionDef): string[] {
  const extra = new Set<string>();

  for (const fn of def.functions) {
    for (const arg of fn.args) {
      const h = PG_TYPE_HEADERS[arg.pgType];
      if (h) extra.add(h);
    }
    const h = PG_TYPE_HEADERS[fn.returnType];
    if (h) extra.add(h);
  }

  if (def.includes) {
    for (const h of def.includes) extra.add(h);
  }

  return ['postgres.h', 'fmgr.h', ...extra];
}

function indentBody(body: string): string[] {
  return body.split('\n').map((line) => (line ? `    ${line}` : ''));
}

function generateFunctionC(fn: PgFunctionDef): string[] {
  return [
    `PG_FUNCTION_INFO_V1(${fn.name});`,
    '',
    'Datum',
    `${fn.name}(PG_FUNCTION_ARGS)`,
    '{',
    ...indentBody(fn.body),
    '}',
  ];
}

export function generateExtensionC(def: PgExtensionDef): string {
  const out: string[] = [];

  for (const h of collectHeaders(def)) {
    out.push(`#include "${h}"`);
  }
  out.push('');

  out.push('PG_MODULE_MAGIC;');
  out.push('');

  if (def.preamble) {
    out.push(def.preamble);
    out.push('');
  }

  if (def.initBody) {
    out.push('void');
    out.push('_PG_init(void)');
    out.push('{');
    out.push(...indentBody(def.initBody));
    out.push('}');
    out.push('');
  }

  for (const fn of def.functions) {
    out.push(...generateFunctionC(fn));
    out.push('');
  }

  return out.join('\n');
}

import path from 'node:path';

import type { PgExtensionDef } from '../src/pgext/types';

const extDir = path.dirname(new URL(import.meta.url).pathname);

export const extraFlags = [
  `-I${path.resolve(extDir, '../vendor/cjson')}`,
  path.resolve(extDir, '../vendor/cjson/cJSON.c'),
  path.resolve(extDir, 'validate.c'),
];

const def: PgExtensionDef = {
  name: 'pg_jsonschema',
  version: '1.0.0',
  preamble: 'extern int validate_json_schema(const char *json, const char *schema);',
  initBody: '/* no-op */',
  functions: [
    {
      name: 'jsonb_matches_schema',
      args: [
        { name: 'val', pgType: 'text' },
        { name: 'schema', pgType: 'text' },
      ],
      returnType: 'bool',
      body: [
        'text *schema_text = PG_GETARG_TEXT_PP(1);',
        'char *schema_str = text_to_cstring(schema_text);',
        '',
        'text *val_text = PG_GETARG_TEXT_PP(0);',
        'char *val_str = text_to_cstring(val_text);',
        '',
        'bool result = (bool)validate_json_schema(val_str, schema_str);',
        '',
        'pfree(val_str);',
        'pfree(schema_str);',
        '',
        'PG_RETURN_BOOL(result);',
      ].join('\n'),
      strict: true,
      volatility: 'immutable',
    },
  ],
};

export default def;

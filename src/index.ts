import type { Extension } from '@electric-sql/pglite';

// Resolved relative to this module so it works from `dist/` once bundled.
const bundlePath = new URL('pg_jsonschema.tar.gz', import.meta.url);

/**
 * PGlite extension registering `jsonb_matches_schema(val text, schema text)`,
 * which validates a JSON/JSONB document against a JSON Schema.
 */
export function pg_jsonschema(): Extension {
  return {
    name: 'pg_jsonschema',
    setup: async (_pg, emscriptenOpts) => ({ emscriptenOpts, bundlePath }),
  };
}

import { Extension } from "@electric-sql/pglite";

//#region src/index.d.ts
/**
 * PGlite extension registering `jsonb_matches_schema(val text, schema text)`,
 * which validates a JSON/JSONB document against a JSON Schema.
 */
declare function pg_jsonschema(): Extension;
//#endregion
export { pg_jsonschema };
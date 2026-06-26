//#region src/index.ts
const bundlePath = new URL("pg_jsonschema.tar.gz", import.meta.url);
/**
* PGlite extension registering `jsonb_matches_schema(val text, schema text)`,
* which validates a JSON/JSONB document against a JSON Schema.
*/
function pg_jsonschema() {
	return {
		name: "pg_jsonschema",
		setup: async (_pg, emscriptenOpts) => ({
			emscriptenOpts,
			bundlePath
		})
	};
}
//#endregion
export { pg_jsonschema };

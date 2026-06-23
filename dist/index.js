const bundlePath = new URL("pg_jsonschema.tar.gz", import.meta.url);

export function pg_jsonschema() {
  return {
    name: "pg_jsonschema",
    setup: async (pg, emscriptenOpts) => {
      return {
        emscriptenOpts,
        bundlePath: bundlePath,
      };
    },
  };
}

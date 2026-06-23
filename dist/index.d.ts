export declare function pg_jsonschema(): {
  name: string;
  setup: (pg: any, emscriptenOpts: any) => Promise<{
    emscriptenOpts: any;
    bundlePath: URL;
  }>;
};

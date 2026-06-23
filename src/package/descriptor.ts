export function generateEntryPoint(extensionName: string, setupSql: string): string {
  const _escapedSql = setupSql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

  return `const bundlePath = new URL("${extensionName}.tar.gz", import.meta.url);

export function ${extensionName}() {
  return {
    name: "${extensionName}",
    setup: async (pg, emscriptenOpts) => {
      return {
        emscriptenOpts,
        bundlePath: bundlePath,
      };
    },
  };
}
`;
}

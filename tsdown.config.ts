import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    drizzle: 'src/drizzle.ts',
  },
  format: 'esm',
  platform: 'neutral',
  dts: true,
  clean: true,
  // Validate the published types and package.json on every build. This is an
  // ESM-only package, so the esm-only profile ignores the legacy node10 and
  // node16-cjs resolution failures that don't apply here.
  attw: { profile: 'esm-only', level: 'error' },
  publint: true,
  // Peer deps (pglite, drizzle-orm, zod) are externalized automatically.
});

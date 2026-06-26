# pglite-pg_jsonschema

[`pg_jsonschema`](https://github.com/supabase/pg_jsonschema) for [PGlite](https://pglite.dev) — validate JSON / JSONB documents against [JSON Schema](https://json-schema.org) directly in Postgres `CHECK` constraints, running entirely in WebAssembly.

This is a clean-room reimplementation of `pg_jsonschema` as a PGlite extension. The validator is written in C (compiled to WASM alongside PGlite) and passes **99.9%** of the official [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite) across drafts 3, 4, 6, 7, 2019-09, and 2020-12.

## Install

```sh
npm install pglite-pg_jsonschema @electric-sql/pglite
```

`@electric-sql/pglite` is a peer dependency. The optional `./drizzle` helper additionally requires `drizzle-orm` and `zod`.

## Usage

Register the extension when creating the PGlite instance, then `CREATE EXTENSION`:

```ts
import { PGlite } from '@electric-sql/pglite';
import { pg_jsonschema } from 'pglite-pg_jsonschema';

const pg = await PGlite.create({
  extensions: { pg_jsonschema: pg_jsonschema() },
});

await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_jsonschema;');
```

This registers a single function:

```sql
jsonb_matches_schema(val text, schema text) -> boolean
```

It returns `true` when `val` validates against `schema`, `false` otherwise. It is `STRICT` (a `NULL` argument yields `NULL`) and `IMMUTABLE`.

```ts
await pg.query('SELECT jsonb_matches_schema($1, $2)', [
  '{"name":"launch"}',
  '{"type":"object","required":["name"]}',
]);
// -> true
```

Use it in a `CHECK` constraint to enforce a schema at write time:

```sql
CREATE TABLE events (
  id   serial PRIMARY KEY,
  data text NOT NULL,
  CONSTRAINT data_is_valid
    CHECK (jsonb_matches_schema(data, '{"type":"object","required":["name"]}'))
);
```

## Drizzle + Zod helper (optional)

The `pglite-pg_jsonschema/drizzle` subpath turns a [Zod](https://zod.dev) schema into a `jsonb_matches_schema` `CHECK` constraint, so your validation lives in one place.

```ts
import { pgTable, serial, jsonb } from 'drizzle-orm/pg-core';
import { jsonbCheck, jsonSchema, zodToJsonbSchema } from 'pglite-pg_jsonschema/drizzle';
import { z } from 'zod';

const product = z.object({ sku: z.string(), qty: z.number().int() });

// 1. A self-validating jsonb column type. `.check` lives on the factory:
const payload = jsonSchema(product);
const products = pgTable(
  'products',
  { id: serial().primaryKey(), payload: payload('payload') },
  (t) => [payload.check('payload_schema', t.payload)]
);

// 2. Or a standalone CHECK from an existing column:
const orders = pgTable(
  'orders',
  { id: serial().primaryKey(), data: jsonb() },
  (t) => [jsonbCheck('data_schema', t.data, product)]
);

// 3. A discriminated CASE form keyed on another column:
jsonbCheck('payload_schema', orders.data)
  .case(orders.kind)
  .when(1, z.object({ a: z.number() }))
  .when(2, z.object({ b: z.string() }));
```

- `jsonbCheck(name, col, schema?)` — a `CHECK` constraint builder. With a schema it validates `col`; without one it returns a builder whose `.case(col).when(value, schema)` chain dispatches on a discriminator column.
- `jsonSchema(schema)` — a Drizzle [custom column](https://orm.drizzle.team/docs/custom-types) (`jsonb` under the hood) that carries `schema`'s TypeScript type and exposes `.check(name, col)`.
- `zodToJsonbSchema(schema)` — the underlying Zod → JSON Schema conversion (dates/bigints become strings, sets become unique-item arrays, maps become `[key, value]` tuple arrays).

Nullable columns are validated as `col IS NULL OR jsonb_matches_schema(...)`; the embedded schema JSON is dollar-quoted (`$jsonschema$…$jsonschema$`) so it is injection-safe.

## How it works

`pg_jsonschema()` returns a PGlite extension descriptor pointing at a prebuilt bundle (`dist/pg_jsonschema.tar.gz`) containing the compiled WASM module, the extension control file, and its setup SQL. PGlite loads the module the same way it loads its own contrib extensions.

## Building from source

Requires [Bun](https://bun.sh) and the [Emscripten SDK](https://emscripten.org) (`emsdk`). [`mise`](https://mise.jdx.dev) is configured to provide both:

```sh
mise install        # installs bun + emsdk pinned in mise.toml
bun install
bun run build        # compiles the C validator to WASM and assembles dist/
bun run test         # runs the extension + drizzle test suites
bun run spec-coverage # runs the JSON Schema Test Suite against the validator
```

## License

[MIT](./LICENSE) © Matt Insler

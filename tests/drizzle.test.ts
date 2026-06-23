import { describe, expect, test } from 'bun:test';

import { type SQL } from 'drizzle-orm';
import { CheckBuilder, integer, jsonb, PgDialect, pgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { jsonbCheck, jsonSchema, zodToJsonbSchema } from '../src/drizzle.js';

const dialect = new PgDialect();

/** Render a drizzle `SQL` fragment to its raw SQL string. */
function render(value: SQL): string {
  return dialect.sqlToQuery(value).sql;
}

/** Build a CheckBuilder against a table and render its constraint expression. */
function renderCheck(builder: CheckBuilder, table: object): string {
  // `.build(table)` is how drizzle materializes a CheckBuilder into a Check.
  const built = (builder as unknown as { build(t: object): { value: SQL } }).build(table);
  return render(built.value);
}

describe('zodToJsonbSchema', () => {
  test('converts a plain object schema and strips $schema', () => {
    const out = zodToJsonbSchema(z.object({ a: z.number(), b: z.string().optional() }));
    expect(out).toEqual({
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });
    expect(out).not.toHaveProperty('$schema');
  });

  test('represents date and bigint as strings', () => {
    expect(zodToJsonbSchema(z.date())).toMatchObject({ type: 'string' });
    expect(zodToJsonbSchema(z.bigint())).toMatchObject({ type: 'string' });
  });

  test('represents a set as a unique-items array with bounds', () => {
    const out = zodToJsonbSchema(z.set(z.number()).min(1).max(3));
    expect(out).toMatchObject({
      type: 'array',
      uniqueItems: true,
      items: { type: 'number' },
      minItems: 1,
      maxItems: 3,
    });
  });

  test('represents a map as an array of [key, value] tuples', () => {
    const out = zodToJsonbSchema(z.map(z.string(), z.number()));
    expect(out).toMatchObject({
      type: 'array',
      items: {
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
        minItems: 2,
        maxItems: 2,
      },
    });
  });
});

describe('jsonSchema custom column', () => {
  const col = jsonSchema(z.object({ a: z.number() }));
  const table = pgTable('t', { id: integer(), payload: col('payload') });

  test('declares a jsonb column type', () => {
    expect(table.payload.getSQLType()).toBe('jsonb');
  });

  test('toDriver serializes to a JSON string, fromDriver parses it back', () => {
    const built = table.payload;
    expect(built.mapToDriverValue({ a: 1 })).toBe('{"a":1}');
    expect(built.mapFromDriverValue('{"a":1}')).toEqual({ a: 1 });
    // fromDriver also tolerates already-parsed objects (pglite returns jsonb as objects).
    expect(built.mapFromDriverValue({ a: 2 })).toEqual({ a: 2 });
  });

  test('.check() on a nullable column allows NULL and validates non-null values', () => {
    const sqlText = renderCheck(col.check('payload_ck', table.payload), table);
    expect(sqlText).toContain('"t"."payload" IS NULL OR');
    expect(sqlText).not.toContain('IS NUL ');
    expect(sqlText).toContain('jsonb_matches_schema("t"."payload"::text');
    expect(sqlText).toContain('"type":"object"');
  });
});

describe('jsonbCheck', () => {
  const table = pgTable('t', {
    id: integer(),
    payload: jsonb(),
    kind: integer(),
  });

  test('two-arg form renders a nullable-tolerant constraint', () => {
    const sqlText = renderCheck(
      jsonbCheck('jbc', table.payload, z.object({ a: z.number() })),
      table
    );
    expect(sqlText).toContain('"t"."payload" IS NULL OR');
    expect(sqlText).toContain('jsonb_matches_schema("t"."payload"::text');
  });

  test('CASE form builds a WHEN/THEN/ELSE constraint over a discriminator column', () => {
    const builder = jsonbCheck('jbc_case', table.payload)
      .case(table.kind)
      .when(1, z.object({ a: z.number() }))
      .when(2, z.object({ b: z.string() }));
    const sqlText = renderCheck(builder, table);
    expect(sqlText).toContain('CASE "t"."kind"');
    // `when` discriminator values are bound parameters, not inlined.
    expect(sqlText).toContain('WHEN $1 THEN');
    expect(sqlText).toContain('WHEN $2 THEN');
    expect(sqlText).toContain('ELSE false');
    expect(sqlText).toContain('END');
    expect(sqlText).toContain('jsonb_matches_schema');
  });

  test('embedded schema JSON is delimited with a dollar-quoted tag (injection-safe)', () => {
    const sqlText = renderCheck(
      jsonbCheck('jbc', table.payload, z.object({ note: z.string() })),
      table
    );
    expect(sqlText).toContain('$jsonschema$');
  });
});

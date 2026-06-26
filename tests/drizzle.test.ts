import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type SQL } from 'drizzle-orm';
import { CheckBuilder, integer, jsonb, PgDialect, pgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { jsonbCheck, jsonSchema, zodToJsonbSchema } from '../dist/drizzle.js';

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
    assert.deepEqual(out, {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });
    assert.ok(!('$schema' in out));
  });

  test('represents date and bigint as strings', () => {
    assert.equal(zodToJsonbSchema(z.date()).type, 'string');
    assert.equal(zodToJsonbSchema(z.bigint()).type, 'string');
  });

  test('represents a set as a unique-items array with bounds', () => {
    const out = zodToJsonbSchema(z.set(z.number()).min(1).max(3));
    assert.deepEqual(out, {
      type: 'array',
      uniqueItems: true,
      items: { type: 'number' },
      minItems: 1,
      maxItems: 3,
    });
  });

  test('represents a map as an array of [key, value] tuples', () => {
    const out = zodToJsonbSchema(z.map(z.string(), z.number()));
    assert.deepEqual(out, {
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
    assert.equal(table.payload.getSQLType(), 'jsonb');
  });

  test('toDriver serializes to a JSON string, fromDriver parses it back', () => {
    const built = table.payload;
    assert.equal(built.mapToDriverValue({ a: 1 }), '{"a":1}');
    assert.deepEqual(built.mapFromDriverValue('{"a":1}'), { a: 1 });
    // fromDriver also tolerates already-parsed objects (pglite returns jsonb as objects).
    assert.deepEqual(built.mapFromDriverValue({ a: 2 }), { a: 2 });
  });

  test('.check() on a nullable column allows NULL and validates non-null values', () => {
    const sqlText = renderCheck(col.check('payload_ck', table.payload), table);
    assert.ok(sqlText.includes('"t"."payload" IS NULL OR'));
    assert.ok(!sqlText.includes('IS NUL '));
    assert.ok(sqlText.includes('jsonb_matches_schema("t"."payload"::text'));
    assert.ok(sqlText.includes('"type":"object"'));
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
    assert.ok(sqlText.includes('"t"."payload" IS NULL OR'));
    assert.ok(sqlText.includes('jsonb_matches_schema("t"."payload"::text'));
  });

  test('CASE form builds a WHEN/THEN/ELSE constraint over a discriminator column', () => {
    const builder = jsonbCheck('jbc_case', table.payload)
      .case(table.kind)
      .when(1, z.object({ a: z.number() }))
      .when(2, z.object({ b: z.string() }));
    const sqlText = renderCheck(builder, table);
    assert.ok(sqlText.includes('CASE "t"."kind"'));
    // `when` discriminator values are bound parameters, not inlined.
    assert.ok(sqlText.includes('WHEN $1 THEN'));
    assert.ok(sqlText.includes('WHEN $2 THEN'));
    assert.ok(sqlText.includes('ELSE false'));
    assert.ok(sqlText.includes('END'));
    assert.ok(sqlText.includes('jsonb_matches_schema'));
  });

  test('embedded schema JSON is delimited with a dollar-quoted tag (injection-safe)', () => {
    const sqlText = renderCheck(
      jsonbCheck('jbc', table.payload, z.object({ note: z.string() })),
      table
    );
    assert.ok(sqlText.includes('$jsonschema$'));
  });
});

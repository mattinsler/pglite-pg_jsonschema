import { sql, type GetColumnData } from 'drizzle-orm';
import { type AnyPgColumn, CheckBuilder, type PgColumn } from 'drizzle-orm/pg-core';
import { check, customType } from 'drizzle-orm/pg-core';
import * as z4 from 'zod/v4/core';

export function zodToJsonbSchema(schema: z4.$ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z4.toJSONSchema(schema, {
    unrepresentable: 'any',
    override({ zodSchema, jsonSchema }) {
      const def = zodSchema._zod.def as z4.$ZodTypes['_zod']['def'];
      switch (def.type) {
        case 'date':
          jsonSchema.type = 'string';
          break;
        case 'bigint':
          jsonSchema.type = 'string';
          break;
        case 'set': {
          jsonSchema.type = 'array';
          jsonSchema.uniqueItems = true;
          jsonSchema.items = zodToJsonbSchema(def.valueType);
          const bag = zodSchema._zod.bag as { minimum?: number; maximum?: number };
          if (typeof bag.minimum === 'number') jsonSchema.minItems = bag.minimum;
          if (typeof bag.maximum === 'number') jsonSchema.maxItems = bag.maximum;
          break;
        }
        case 'map': {
          jsonSchema.type = 'array';
          jsonSchema.items = {
            type: 'array',
            prefixItems: [zodToJsonbSchema(def.keyType), zodToJsonbSchema(def.valueType)],
            minItems: 2,
            maxItems: 2,
          };
          break;
        }
      }
    },
  });
  return rest;
}

export function jsonSchema<TData = unknown>(schema: z4.$ZodType<TData>) {
  const schemaJson = JSON.stringify(zodToJsonbSchema(schema));

  const column = customType<{ data: TData }>({
    dataType() {
      return 'jsonb';
    },
    toDriver(value: TData) {
      return JSON.stringify(value);
    },
    fromDriver(value: unknown): TData {
      return (typeof value === 'string' ? JSON.parse(value) : value) as TData;
    },
  });

  return Object.assign(column, {
    check(constraintName: string, col: PgColumn) {
      return check(
        constraintName,
        col.notNull
          ? sql`jsonb_matches_schema(${col}::text, $jsonschema$${sql.raw(schemaJson)}$jsonschema$::text)`
          : sql`${col} IS NULL OR jsonb_matches_schema(${col}::text, $jsonschema$${sql.raw(schemaJson)}$jsonschema$::text)`
      );
    },
  });
}

function jsonSchemaConstraint(col: AnyPgColumn, schema: z4.$ZodType) {
  const schemaJson = JSON.stringify(zodToJsonbSchema(schema));
  return col.notNull
    ? sql`jsonb_matches_schema(${col}::text, $jsonschema$${sql.raw(schemaJson)}$jsonschema$::text)`
    : sql`${col} IS NULL OR jsonb_matches_schema(${col}::text, $jsonschema$${sql.raw(schemaJson)}$jsonschema$::text)`;
}

class JsonbCheckCaseBuilder<TColumn extends AnyPgColumn> extends CheckBuilder {
  readonly #column: AnyPgColumn;
  readonly #caseColumn: TColumn;
  readonly #whenConditions: [GetColumnData<TColumn>, z4.$ZodType][];

  constructor(
    name: string,
    column: AnyPgColumn,
    caseColumn: TColumn,
    whenConditions: [GetColumnData<TColumn>, z4.$ZodType][] = []
  ) {
    super(
      name,
      sql.join(
        [
          sql`CASE ${caseColumn}`,
          ...whenConditions.map(
            ([condition, schema]) =>
              sql`WHEN ${condition} THEN ${jsonSchemaConstraint(column, schema)}`
          ),
          sql`ELSE false`,
          sql`END`,
        ],
        sql`\n`
      )
    );
    this.#column = column;
    this.#caseColumn = caseColumn;
    this.#whenConditions = whenConditions;
  }

  when(condition: GetColumnData<TColumn>, schema: z4.$ZodType) {
    this.value = sql`${condition} THEN ${this.value}`;
    return new JsonbCheckCaseBuilder<TColumn>(this.name, this.#column, this.#caseColumn, [
      ...this.#whenConditions,
      [condition, schema],
    ]);
  }
}

class JsonbCheckBuilder extends CheckBuilder {
  readonly #column: AnyPgColumn;

  constructor(name: string, column: AnyPgColumn) {
    super(name, sql``);
    this.#column = column;
    Object.defineProperty(this, 'value', {
      get() {
        throw new Error('Schema is not set');
      },
    });
  }

  case<TColumn extends AnyPgColumn>(col: TColumn) {
    return new JsonbCheckCaseBuilder<TColumn>(this.name, this.#column, col);
  }
}

export function jsonbCheck<TColumn extends AnyPgColumn>(
  constraintName: string,
  col: TColumn
): JsonbCheckBuilder;
export function jsonbCheck<TColumn extends AnyPgColumn>(
  constraintName: string,
  col: TColumn,
  schema: z4.$ZodType
): CheckBuilder;
export function jsonbCheck<TColumn extends AnyPgColumn>(
  constraintName: string,
  col: TColumn,
  schema?: z4.$ZodType
) {
  if (!schema) {
    return new JsonbCheckBuilder(constraintName, col);
  }

  return check(constraintName, jsonSchemaConstraint(col, schema));
}

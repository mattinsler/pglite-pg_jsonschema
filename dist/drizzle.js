// src/drizzle.ts
import { sql } from "drizzle-orm";
import { CheckBuilder } from "drizzle-orm/pg-core";
import { check, customType } from "drizzle-orm/pg-core";
import * as z4 from "zod/v4/core";
function zodToJsonbSchema(schema) {
  const { $schema: _, ...rest } = z4.toJSONSchema(schema, {
    unrepresentable: "any",
    override({ zodSchema, jsonSchema }) {
      const def = zodSchema._zod.def;
      switch (def.type) {
        case "date":
          jsonSchema.type = "string";
          break;
        case "bigint":
          jsonSchema.type = "string";
          break;
        case "set": {
          jsonSchema.type = "array";
          jsonSchema.uniqueItems = true;
          jsonSchema.items = zodToJsonbSchema(def.valueType);
          const bag = zodSchema._zod.bag;
          if (typeof bag.minimum === "number")
            jsonSchema.minItems = bag.minimum;
          if (typeof bag.maximum === "number")
            jsonSchema.maxItems = bag.maximum;
          break;
        }
        case "map": {
          jsonSchema.type = "array";
          jsonSchema.items = {
            type: "array",
            prefixItems: [zodToJsonbSchema(def.keyType), zodToJsonbSchema(def.valueType)],
            minItems: 2,
            maxItems: 2
          };
          break;
        }
      }
    }
  });
  return rest;
}
function jsonSchema(schema) {
  const schemaJson = JSON.stringify(zodToJsonbSchema(schema));
  const column = customType({
    dataType() {
      return "jsonb";
    },
    toDriver(value) {
      return JSON.stringify(value);
    },
    fromDriver(value) {
      return typeof value === "string" ? JSON.parse(value) : value;
    }
  });
  return Object.assign(column, {
    check(constraintName, col) {
      return check(constraintName, col.notNull ? sql`jsonb_matches_schema(${col}::text, $jsonschema$${sql.raw(schemaJson)}$jsonschema$::text)` : sql`${col} IS NULL OR jsonb_matches_schema(${col}::text, $jsonschema$${sql.raw(schemaJson)}$jsonschema$::text)`);
    }
  });
}
function jsonSchemaConstraint(col, schema) {
  const schemaJson = JSON.stringify(zodToJsonbSchema(schema));
  return col.notNull ? sql`jsonb_matches_schema(${col}::text, $jsonschema$${sql.raw(schemaJson)}$jsonschema$::text)` : sql`${col} IS NULL OR jsonb_matches_schema(${col}::text, $jsonschema$${sql.raw(schemaJson)}$jsonschema$::text)`;
}

class JsonbCheckCaseBuilder extends CheckBuilder {
  #column;
  #caseColumn;
  #whenConditions;
  constructor(name, column, caseColumn, whenConditions = []) {
    super(name, sql.join([
      sql`CASE ${caseColumn}`,
      ...whenConditions.map(([condition, schema]) => sql`WHEN ${condition} THEN ${jsonSchemaConstraint(column, schema)}`),
      sql`ELSE false`,
      sql`END`
    ], sql`\n`));
    this.#column = column;
    this.#caseColumn = caseColumn;
    this.#whenConditions = whenConditions;
  }
  when(condition, schema) {
    this.value = sql`${condition} THEN ${this.value}`;
    return new JsonbCheckCaseBuilder(this.name, this.#column, this.#caseColumn, [
      ...this.#whenConditions,
      [condition, schema]
    ]);
  }
}

class JsonbCheckBuilder extends CheckBuilder {
  #column;
  constructor(name, column) {
    super(name, sql``);
    this.#column = column;
    Object.defineProperty(this, "value", {
      get() {
        throw new Error("Schema is not set");
      }
    });
  }
  case(col) {
    return new JsonbCheckCaseBuilder(this.name, this.#column, col);
  }
}
function jsonbCheck(constraintName, col, schema) {
  if (!schema) {
    return new JsonbCheckBuilder(constraintName, col);
  }
  return check(constraintName, jsonSchemaConstraint(col, schema));
}
export {
  zodToJsonbSchema,
  jsonbCheck,
  jsonSchema
};

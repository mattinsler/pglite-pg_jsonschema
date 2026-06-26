import { type GetColumnData } from 'drizzle-orm';
import { type AnyPgColumn, CheckBuilder, type PgColumn } from 'drizzle-orm/pg-core';
import * as z4 from 'zod/v4/core';
export declare function zodToJsonbSchema(schema: z4.$ZodType): Record<string, unknown>;
export declare function jsonSchema<TData = unknown>(schema: z4.$ZodType<TData>): {
    <TConfig extends Record<string, any>>(fieldConfig?: TConfig | undefined): import("drizzle-orm/pg-core").PgCustomColumnBuilder<{
        dataType: "custom";
        data: TData;
        driverParam: unknown;
    }>;
    (dbName: string, fieldConfig?: unknown): import("drizzle-orm/pg-core").PgCustomColumnBuilder<{
        dataType: "custom";
        data: TData;
        driverParam: unknown;
    }>;
} & {
    check(constraintName: string, col: PgColumn): CheckBuilder;
};
declare class JsonbCheckCaseBuilder<TColumn extends AnyPgColumn> extends CheckBuilder {
    #private;
    constructor(name: string, column: AnyPgColumn, caseColumn: TColumn, whenConditions?: [GetColumnData<TColumn>, z4.$ZodType][]);
    when(condition: GetColumnData<TColumn>, schema: z4.$ZodType): JsonbCheckCaseBuilder<TColumn>;
}
declare class JsonbCheckBuilder extends CheckBuilder {
    #private;
    constructor(name: string, column: AnyPgColumn);
    case<TColumn extends AnyPgColumn>(col: TColumn): JsonbCheckCaseBuilder<TColumn>;
}
export declare function jsonbCheck<TColumn extends AnyPgColumn>(constraintName: string, col: TColumn): JsonbCheckBuilder;
export declare function jsonbCheck<TColumn extends AnyPgColumn>(constraintName: string, col: TColumn, schema: z4.$ZodType): CheckBuilder;
export {};

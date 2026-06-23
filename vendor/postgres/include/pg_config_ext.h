/* src/include/pg_config_ext.h.  Generated from pg_config_ext.h.in by configure.  */
/*
 * src/include/pg_config_ext.h.in.  This is generated manually, not by
 * autoheader, since we want to limit which symbols get defined here.
 */

/* Define to the name of a signed 64-bit integer type. */
/* On the wasm32 target `long` is 32-bit, so int64 must map to `long long int`. */
#define PG_INT64_TYPE long long int

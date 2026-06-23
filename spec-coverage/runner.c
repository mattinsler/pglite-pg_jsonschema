#include "cJSON.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern int validate_json_schema(const char *json, const char *schema);

static char *read_stdin(void) {
    size_t cap = 4096, len = 0;
    char *buf = malloc(cap);
    size_t n;
    while ((n = fread(buf + len, 1, cap - len, stdin)) > 0) {
        len += n;
        if (len == cap) { cap *= 2; buf = realloc(buf, cap); }
    }
    buf[len] = '\0';
    return buf;
}

int main(void) {
    char *input = read_stdin();
    cJSON *suites = cJSON_Parse(input);
    free(input);
    if (!suites) { fprintf(stderr, "failed to parse test file\n"); return 1; }

    int total = 0, passed = 0, failed = 0;
    const cJSON *suite;
    cJSON_ArrayForEach(suite, suites) {
        const char *suite_desc = cJSON_GetObjectItemCaseSensitive(suite, "description")->valuestring;
        const cJSON *schema = cJSON_GetObjectItemCaseSensitive(suite, "schema");
        char *schema_str = cJSON_PrintUnformatted(schema);

        const cJSON *tests = cJSON_GetObjectItemCaseSensitive(suite, "tests");
        const cJSON *test;
        cJSON_ArrayForEach(test, tests) {
            total++;
            const char *test_desc = cJSON_GetObjectItemCaseSensitive(test, "description")->valuestring;
            const cJSON *data = cJSON_GetObjectItemCaseSensitive(test, "data");
            int expected = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(test, "valid"));

            char *data_str = cJSON_PrintUnformatted(data);
            int actual = validate_json_schema(data_str, schema_str);

            if (actual == expected) {
                passed++;
            } else {
                failed++;
                printf("FAIL  %s / %s\n", suite_desc, test_desc);
                printf("      schema: %s\n", schema_str);
                printf("      data:   %s\n", data_str);
                printf("      expected=%s  got=%s\n",
                       expected ? "valid" : "invalid",
                       actual ? "valid" : "invalid");
            }
            free(data_str);
        }
        free(schema_str);
    }

    printf("\n--- %d total, %d passed, %d failed ---\n", total, passed, failed);
    cJSON_Delete(suites);
    return failed > 0 ? 1 : 0;
}

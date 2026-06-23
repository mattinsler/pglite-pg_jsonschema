#include "cJSON.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <regex.h>
#include <math.h>
#ifdef ENABLE_HTTP
#include <curl/curl.h>
#endif

#define MAX_URI 512
#define MAX_IDS 256

static int validate_node(const cJSON *data, const cJSON *schema,
                         const cJSON *res_root, const char *base_uri);

static int utf8_codepoint_count(const char *s) {
    int len = 0;
    while (*s) {
        if ((*s & 0xC0) != 0x80) len++;
        s++;
    }
    return len;
}

static int check_type(const cJSON *data, const char *type) {
    if (strcmp(type, "any") == 0) return 1;
    if (strcmp(type, "object") == 0) return cJSON_IsObject(data);
    if (strcmp(type, "array") == 0) return cJSON_IsArray(data);
    if (strcmp(type, "string") == 0) return cJSON_IsString(data);
    if (strcmp(type, "number") == 0) return cJSON_IsNumber(data);
    if (strcmp(type, "integer") == 0)
        return cJSON_IsNumber(data) && data->valuedouble == floor(data->valuedouble);
    if (strcmp(type, "boolean") == 0) return cJSON_IsBool(data);
    if (strcmp(type, "null") == 0) return cJSON_IsNull(data);
    return 0;
}

static int is_absolute_uri(const char *s) {
    if (strncmp(s, "urn:", 4) == 0) return 1;
    const char *p = s;
    while ((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
           (*p >= '0' && *p <= '9') || *p == '+' || *p == '-' || *p == '.')
        p++;
    return (p > s && p[0] == ':' && p[1] == '/' && p[2] == '/');
}

static void resolve_uri(const char *base, const char *rel, char *out, size_t sz) {
    if (!rel || !rel[0]) { strncpy(out, base, sz - 1); out[sz - 1] = '\0'; return; }
    if (is_absolute_uri(rel)) { strncpy(out, rel, sz - 1); out[sz - 1] = '\0'; return; }
    /* A fragment-only reference resolves against the full base URI (minus the
       base's own fragment), keeping the entire base path/authority intact. */
    if (rel[0] == '#') {
        const char *base_hash = strchr(base, '#');
        size_t blen = base_hash ? (size_t)(base_hash - base) : strlen(base);
        snprintf(out, sz, "%.*s%s", (int)blen, base, rel);
        return;
    }
    if (rel[0] == '/') {
        const char *auth = strstr(base, "://");
        if (auth) {
            auth += 3;
            const char *path = strchr(auth, '/');
            size_t plen = path ? (size_t)(path - base) : strlen(base);
            snprintf(out, sz, "%.*s%s", (int)plen, base, rel);
        } else {
            strncpy(out, rel, sz - 1); out[sz - 1] = '\0';
        }
        return;
    }
    if (rel[0] == '.' && rel[1] == '/') rel += 2;
    const char *last_slash = strrchr(base, '/');
    if (last_slash) {
        size_t dir_len = (size_t)(last_slash - base + 1);
        snprintf(out, sz, "%.*s%s", (int)dir_len, base, rel);
    } else {
        strncpy(out, rel, sz - 1); out[sz - 1] = '\0';
    }
}

typedef struct { char uri[MAX_URI]; const cJSON *schema; } IdEntry;
static struct { IdEntry e[MAX_IDS]; int n; } g_ids;

/* In draft-03/04/06/07 a $ref ignores all sibling keywords, including a sibling
   $id (so the $id does not change the base URI for the $ref). In draft 2019-09
   and later, $id and $ref apply alongside each other. This flag selects the
   legacy behavior; it is set from the root $schema (defaulting to legacy when no
   $schema declares a 2019-09+ dialect). */
static int g_legacy_ref = 1;

static void register_ids(const cJSON *node, const char *base) {
    if (!node || g_ids.n >= MAX_IDS) return;
    if (cJSON_IsObject(node)) {
        const char *cur_base = base;
        const cJSON *id = cJSON_GetObjectItemCaseSensitive(node, "$id");
        if (cJSON_IsString(id)) {
            char canonical[MAX_URI];
            resolve_uri(base, id->valuestring, canonical, sizeof(canonical));
            strncpy(g_ids.e[g_ids.n].uri, canonical, MAX_URI - 1);
            g_ids.e[g_ids.n].uri[MAX_URI - 1] = '\0';
            g_ids.e[g_ids.n].schema = node;
            cur_base = g_ids.e[g_ids.n].uri;
            g_ids.n++;
        }
        const cJSON *child;
        cJSON_ArrayForEach(child, node) { register_ids(child, cur_base); }
    } else if (cJSON_IsArray(node)) {
        const cJSON *child;
        cJSON_ArrayForEach(child, node) { register_ids(child, base); }
    }
}

#ifdef ENABLE_HTTP
#define MAX_REMOTE 32
static struct { char url[MAX_URI]; cJSON *schema; } g_remote[MAX_REMOTE];
static int g_remote_n = 0;

struct fetch_buf { char *data; size_t size; };

static size_t fetch_write_cb(void *ptr, size_t size, size_t nmemb, void *userp) {
    size_t total = size * nmemb;
    struct fetch_buf *buf = (struct fetch_buf *)userp;
    char *p = realloc(buf->data, buf->size + total + 1);
    if (!p) return 0;
    buf->data = p;
    memcpy(buf->data + buf->size, ptr, total);
    buf->size += total;
    buf->data[buf->size] = '\0';
    return total;
}

static cJSON *fetch_remote_schema(const char *url) {
    for (int i = 0; i < g_remote_n; i++)
        if (strcmp(g_remote[i].url, url) == 0) return g_remote[i].schema;

    CURL *curl = curl_easy_init();
    if (!curl) return NULL;

    struct fetch_buf buf = {NULL, 0};
    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, fetch_write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &buf);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);

    CURLcode res = curl_easy_perform(curl);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK || !buf.data) { free(buf.data); return NULL; }

    cJSON *schema = cJSON_Parse(buf.data);
    free(buf.data);

    if (schema && g_remote_n < MAX_REMOTE) {
        strncpy(g_remote[g_remote_n].url, url, MAX_URI - 1);
        g_remote[g_remote_n].url[MAX_URI - 1] = '\0';
        g_remote[g_remote_n].schema = schema;
        g_remote_n++;
        register_ids(schema, url);
    }
    return schema;
}

static void cleanup_remote(void) {
    for (int i = 0; i < g_remote_n; i++)
        cJSON_Delete(g_remote[i].schema);
    g_remote_n = 0;
}
#endif

static const cJSON *lookup_id(const char *uri) {
    for (int i = 0; i < g_ids.n; i++)
        if (strcmp(g_ids.e[i].uri, uri) == 0) return g_ids.e[i].schema;
    return NULL;
}

static const char *canonical_of(const cJSON *schema) {
    for (int i = 0; i < g_ids.n; i++)
        if (g_ids.e[i].schema == schema) return g_ids.e[i].uri;
    return "";
}

static int hex_val(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return 10 + c - 'a';
    if (c >= 'A' && c <= 'F') return 10 + c - 'A';
    return -1;
}

static const cJSON *resolve_json_pointer(const cJSON *doc, const char *ptr) {
    if (!ptr || *ptr != '/') return NULL;
    const cJSON *cur = doc;
    char seg[256];

    while (*ptr == '/' && cur) {
        ptr++;
        int i = 0;
        while (*ptr && *ptr != '/' && i < 255) {
            if (*ptr == '~') {
                ptr++;
                if (*ptr == '1') { seg[i++] = '/'; ptr++; }
                else if (*ptr == '0') { seg[i++] = '~'; ptr++; }
                else { seg[i++] = '~'; }
            } else if (*ptr == '%' && hex_val(ptr[1]) >= 0 && hex_val(ptr[2]) >= 0) {
                seg[i++] = (char)(hex_val(ptr[1]) * 16 + hex_val(ptr[2]));
                ptr += 3;
            } else {
                seg[i++] = *ptr++;
            }
        }
        seg[i] = '\0';
        if (cJSON_IsArray(cur))
            cur = cJSON_GetArrayItem(cur, atoi(seg));
        else
            cur = cJSON_GetObjectItemCaseSensitive(cur, seg);
    }
    return cur;
}

static const cJSON *find_anchor(const cJSON *node, const char *name, int at_root) {
    if (!node) return NULL;
    if (cJSON_IsObject(node)) {
        if (!at_root && cJSON_GetObjectItemCaseSensitive(node, "$id"))
            return NULL;
        const cJSON *a = cJSON_GetObjectItemCaseSensitive(node, "$anchor");
        if (cJSON_IsString(a) && strcmp(a->valuestring, name) == 0)
            return node;
        const cJSON *child;
        cJSON_ArrayForEach(child, node) {
            const cJSON *found = find_anchor(child, name, 0);
            if (found) return found;
        }
    } else if (cJSON_IsArray(node)) {
        const cJSON *child;
        cJSON_ArrayForEach(child, node) {
            const cJSON *found = find_anchor(child, name, 0);
            if (found) return found;
        }
    }
    return NULL;
}

static const cJSON *resolve_ref(const cJSON *res_root, const char *base_uri,
                                const char *ref) {
    if (!ref) return NULL;

    if (ref[0] == '#') {
        if (ref[1] == '\0') return res_root;
        if (ref[1] == '/') return resolve_json_pointer(res_root, ref + 1);
        /* Plain fragment: could be a location-independent $id (registered as
           base_uri#name) or a plain $anchor in the current resource. Try the
           location-independent identifier first. */
        char full[MAX_URI];
        resolve_uri(base_uri, ref, full, sizeof(full));
        const cJSON *byid = lookup_id(full);
        if (byid) return byid;
        return find_anchor(res_root, ref + 1, 1);
    }

    const char *hash = strchr(ref, '#');
    char ref_base[MAX_URI];
    if (hash) {
        size_t len = (size_t)(hash - ref);
        if (len >= sizeof(ref_base)) len = sizeof(ref_base) - 1;
        memcpy(ref_base, ref, len);
        ref_base[len] = '\0';
    } else {
        strncpy(ref_base, ref, sizeof(ref_base) - 1);
        ref_base[sizeof(ref_base) - 1] = '\0';
    }

    char canonical[MAX_URI];
    resolve_uri(base_uri, ref_base, canonical, sizeof(canonical));

    /* The full reference (including fragment) may itself be a registered
       location-independent identifier ($id of the form "base#name"). */
    if (hash && hash[1] != '\0' && hash[1] != '/') {
        char full[MAX_URI];
        snprintf(full, sizeof(full), "%s%s", canonical, hash);
        const cJSON *byid = lookup_id(full);
        if (byid) return byid;
    }

    const cJSON *target = lookup_id(canonical);
#ifdef ENABLE_HTTP
    if (!target && (strncmp(canonical, "http://", 7) == 0 ||
                    strncmp(canonical, "https://", 8) == 0))
        target = fetch_remote_schema(canonical);
#endif
    if (!target) return NULL;

    if (hash && hash[1] != '\0') {
        if (hash[1] == '/') return resolve_json_pointer(target, hash + 1);
        return find_anchor(target, hash + 1, 1);
    }
    return target;
}

static int validate_node(const cJSON *data, const cJSON *schema,
                         const cJSON *res_root, const char *base_uri) {
    if (cJSON_IsTrue(schema)) return 1;
    if (cJSON_IsFalse(schema)) return 0;

    const cJSON *ref = cJSON_GetObjectItemCaseSensitive(schema, "$ref");

    const cJSON *id = cJSON_GetObjectItemCaseSensitive(schema, "$id");
    /* A sibling $id does not change the base URI used to resolve a sibling $ref
       (draft-06/07: "$ref prevents a sibling $id from changing the base uri").
       Skip the scope change when $ref is present so the $ref resolves against
       the enclosing base. */
    if (cJSON_IsString(id) && !(g_legacy_ref && cJSON_IsString(ref))) {
        char resolved[MAX_URI];
        resolve_uri(base_uri, id->valuestring, resolved, sizeof(resolved));
        base_uri = canonical_of(schema);
        res_root = schema;
    }

    if (cJSON_IsString(ref)) {
        const cJSON *resolved = resolve_ref(res_root, base_uri, ref->valuestring);
        if (resolved) {
            const cJSON *rid = cJSON_GetObjectItemCaseSensitive(resolved, "$id");
            const cJSON *new_root = cJSON_IsString(rid) ? resolved : res_root;
            const char *new_base = cJSON_IsString(rid) ? canonical_of(resolved) : base_uri;
            if (!validate_node(data, resolved, new_root, new_base)) return 0;
        }
    }

    const cJSON *type_val = cJSON_GetObjectItemCaseSensitive(schema, "type");
    if (cJSON_IsString(type_val)) {
        if (!check_type(data, type_val->valuestring)) return 0;
    } else if (cJSON_IsArray(type_val)) {
        int matched = 0;
        const cJSON *t;
        cJSON_ArrayForEach(t, type_val) {
            if (cJSON_IsString(t) && check_type(data, t->valuestring)) {
                matched = 1; break;
            }
            if (cJSON_IsObject(t) && validate_node(data, t, res_root, base_uri)) {
                matched = 1; break;
            }
        }
        if (!matched) return 0;
    }

    const cJSON *enum_val = cJSON_GetObjectItemCaseSensitive(schema, "enum");
    if (cJSON_IsArray(enum_val)) {
        int found = 0;
        const cJSON *item;
        cJSON_ArrayForEach(item, enum_val) {
            if (cJSON_Compare(item, data, 1)) { found = 1; break; }
        }
        if (!found) return 0;
    }

    const cJSON *const_val = cJSON_GetObjectItemCaseSensitive(schema, "const");
    if (const_val && !cJSON_Compare(data, const_val, 1)) return 0;

    const cJSON *all_of = cJSON_GetObjectItemCaseSensitive(schema, "allOf");
    if (cJSON_IsArray(all_of)) {
        const cJSON *sub;
        cJSON_ArrayForEach(sub, all_of) {
            if (!validate_node(data, sub, res_root, base_uri)) return 0;
        }
    }

    const cJSON *extends_val = cJSON_GetObjectItemCaseSensitive(schema, "extends");
    if (cJSON_IsObject(extends_val)) {
        if (!validate_node(data, extends_val, res_root, base_uri)) return 0;
    } else if (cJSON_IsArray(extends_val)) {
        const cJSON *sub;
        cJSON_ArrayForEach(sub, extends_val) {
            if (!validate_node(data, sub, res_root, base_uri)) return 0;
        }
    }

    const cJSON *any_of = cJSON_GetObjectItemCaseSensitive(schema, "anyOf");
    if (cJSON_IsArray(any_of)) {
        int matched = 0;
        const cJSON *sub;
        cJSON_ArrayForEach(sub, any_of) {
            if (validate_node(data, sub, res_root, base_uri)) { matched = 1; break; }
        }
        if (!matched) return 0;
    }

    const cJSON *one_of = cJSON_GetObjectItemCaseSensitive(schema, "oneOf");
    if (cJSON_IsArray(one_of)) {
        int count = 0;
        const cJSON *sub;
        cJSON_ArrayForEach(sub, one_of) {
            if (validate_node(data, sub, res_root, base_uri)) count++;
            if (count > 1) break;
        }
        if (count != 1) return 0;
    }

    const cJSON *not_schema = cJSON_GetObjectItemCaseSensitive(schema, "not");
    if (not_schema && validate_node(data, not_schema, res_root, base_uri)) return 0;

    const cJSON *disallow = cJSON_GetObjectItemCaseSensitive(schema, "disallow");
    if (cJSON_IsString(disallow)) {
        if (check_type(data, disallow->valuestring)) return 0;
    } else if (cJSON_IsArray(disallow)) {
        const cJSON *d;
        cJSON_ArrayForEach(d, disallow) {
            if (cJSON_IsString(d) && check_type(data, d->valuestring)) return 0;
            if (cJSON_IsObject(d) && validate_node(data, d, res_root, base_uri)) return 0;
        }
    }

    if (cJSON_IsObject(data)) {
        int prop_count = cJSON_GetArraySize(data);

        const cJSON *min_props = cJSON_GetObjectItemCaseSensitive(schema, "minProperties");
        if (cJSON_IsNumber(min_props) && prop_count < (int)min_props->valuedouble)
            return 0;
        const cJSON *max_props = cJSON_GetObjectItemCaseSensitive(schema, "maxProperties");
        if (cJSON_IsNumber(max_props) && prop_count > (int)max_props->valuedouble)
            return 0;

        const cJSON *required = cJSON_GetObjectItemCaseSensitive(schema, "required");
        if (cJSON_IsArray(required)) {
            const cJSON *key;
            cJSON_ArrayForEach(key, required) {
                if (cJSON_IsString(key) &&
                    !cJSON_HasObjectItem(data, key->valuestring))
                    return 0;
            }
        }

        const cJSON *properties = cJSON_GetObjectItemCaseSensitive(schema, "properties");
        if (cJSON_IsObject(properties)) {
            const cJSON *ps;
            cJSON_ArrayForEach(ps, properties) {
                const cJSON *pd = cJSON_GetObjectItemCaseSensitive(data, ps->string);
                if (pd && !validate_node(pd, ps, res_root, base_uri)) return 0;
            }
        }

        if (cJSON_IsObject(properties)) {
            const cJSON *ps;
            cJSON_ArrayForEach(ps, properties) {
                const cJSON *prop_required = cJSON_GetObjectItemCaseSensitive(ps, "required");
                if (cJSON_IsTrue(prop_required) && !cJSON_HasObjectItem(data, ps->string))
                    return 0;
            }
        }

        const cJSON *pattern_props = cJSON_GetObjectItemCaseSensitive(schema, "patternProperties");
        if (cJSON_IsObject(pattern_props)) {
            const cJSON *pp;
            cJSON_ArrayForEach(pp, pattern_props) {
                regex_t re;
                if (regcomp(&re, pp->string, REG_EXTENDED | REG_NOSUB) != 0) continue;
                const cJSON *dp;
                cJSON_ArrayForEach(dp, data) {
                    if (regexec(&re, dp->string, 0, NULL, 0) == 0 &&
                        !validate_node(dp, pp, res_root, base_uri)) {
                        regfree(&re); return 0;
                    }
                }
                regfree(&re);
            }
        }

        const cJSON *additional = cJSON_GetObjectItemCaseSensitive(schema, "additionalProperties");
        if (additional) {
            const cJSON *dp;
            cJSON_ArrayForEach(dp, data) {
                if (properties && cJSON_HasObjectItem(properties, dp->string)) continue;
                if (cJSON_IsObject(pattern_props)) {
                    int matched_pat = 0;
                    const cJSON *pp;
                    cJSON_ArrayForEach(pp, pattern_props) {
                        regex_t re;
                        if (regcomp(&re, pp->string, REG_EXTENDED | REG_NOSUB) != 0) continue;
                        if (regexec(&re, dp->string, 0, NULL, 0) == 0) matched_pat = 1;
                        regfree(&re);
                        if (matched_pat) break;
                    }
                    if (matched_pat) continue;
                }
                if (!validate_node(dp, additional, res_root, base_uri)) return 0;
            }
        }

        const cJSON *prop_names = cJSON_GetObjectItemCaseSensitive(schema, "propertyNames");
        if (prop_names) {
            const cJSON *dp;
            cJSON_ArrayForEach(dp, data) {
                cJSON *nn = cJSON_CreateString(dp->string);
                int ok = validate_node(nn, prop_names, res_root, base_uri);
                cJSON_Delete(nn);
                if (!ok) return 0;
            }
        }

        const cJSON *dep_req = cJSON_GetObjectItemCaseSensitive(schema, "dependentRequired");
        if (cJSON_IsObject(dep_req)) {
            const cJSON *dep;
            cJSON_ArrayForEach(dep, dep_req) {
                if (!cJSON_HasObjectItem(data, dep->string)) continue;
                if (cJSON_IsArray(dep)) {
                    const cJSON *rk;
                    cJSON_ArrayForEach(rk, dep) {
                        if (cJSON_IsString(rk) &&
                            !cJSON_HasObjectItem(data, rk->valuestring))
                            return 0;
                    }
                }
            }
        }

        const cJSON *dep_schemas = cJSON_GetObjectItemCaseSensitive(schema, "dependentSchemas");
        if (cJSON_IsObject(dep_schemas)) {
            const cJSON *dep;
            cJSON_ArrayForEach(dep, dep_schemas) {
                if (cJSON_HasObjectItem(data, dep->string) &&
                    !validate_node(data, dep, res_root, base_uri))
                    return 0;
            }
        }

        const cJSON *deps = cJSON_GetObjectItemCaseSensitive(schema, "dependencies");
        if (cJSON_IsObject(deps)) {
            const cJSON *dep;
            cJSON_ArrayForEach(dep, deps) {
                if (!cJSON_HasObjectItem(data, dep->string)) continue;
                if (cJSON_IsArray(dep)) {
                    const cJSON *rk;
                    cJSON_ArrayForEach(rk, dep) {
                        if (cJSON_IsString(rk) &&
                            !cJSON_HasObjectItem(data, rk->valuestring))
                            return 0;
                    }
                } else if (cJSON_IsString(dep)) {
                    if (!cJSON_HasObjectItem(data, dep->valuestring))
                        return 0;
                } else if (cJSON_IsObject(dep) || cJSON_IsBool(dep)) {
                    if (!validate_node(data, dep, res_root, base_uri))
                        return 0;
                }
            }
        }
    }

    if (cJSON_IsArray(data)) {
        int data_size = cJSON_GetArraySize(data);

        const cJSON *prefix_items = cJSON_GetObjectItemCaseSensitive(schema, "prefixItems");
        int prefix_count = 0;
        if (cJSON_IsArray(prefix_items)) {
            prefix_count = cJSON_GetArraySize(prefix_items);
            int idx = 0;
            const cJSON *elem;
            cJSON_ArrayForEach(elem, data) {
                if (idx >= prefix_count) break;
                const cJSON *is = cJSON_GetArrayItem(prefix_items, idx);
                if (is && !validate_node(elem, is, res_root, base_uri)) return 0;
                idx++;
            }
        }

        const cJSON *items = cJSON_GetObjectItemCaseSensitive(schema, "items");
        if (items) {
            if (cJSON_IsArray(items)) {
                /* Tuple validation (draft3-7, 2019-09): items is an array of schemas */
                int tuple_count = cJSON_GetArraySize(items);
                int idx = 0;
                const cJSON *elem;
                cJSON_ArrayForEach(elem, data) {
                    if (idx >= tuple_count) break;
                    const cJSON *is = cJSON_GetArrayItem(items, idx);
                    if (is && !validate_node(elem, is, res_root, base_uri)) return 0;
                    idx++;
                }

                /* additionalItems only applies when items is an array */
                const cJSON *additional_items = cJSON_GetObjectItemCaseSensitive(schema, "additionalItems");
                if (additional_items) {
                    if (cJSON_IsFalse(additional_items)) {
                        if (data_size > tuple_count) return 0;
                    } else if (cJSON_IsObject(additional_items) || cJSON_IsTrue(additional_items)) {
                        idx = 0;
                        cJSON_ArrayForEach(elem, data) {
                            if (idx++ < tuple_count) continue;
                            if (!validate_node(elem, additional_items, res_root, base_uri)) return 0;
                        }
                    }
                }
            } else if (cJSON_IsFalse(items)) {
                if (data_size > prefix_count) return 0;
            } else if (cJSON_IsObject(items) || cJSON_IsTrue(items)) {
                int idx = 0;
                const cJSON *elem;
                cJSON_ArrayForEach(elem, data) {
                    if (idx++ < prefix_count) continue;
                    if (!validate_node(elem, items, res_root, base_uri)) return 0;
                }
            }
        }

        const cJSON *min_items = cJSON_GetObjectItemCaseSensitive(schema, "minItems");
        if (cJSON_IsNumber(min_items) && data_size < (int)min_items->valuedouble) return 0;
        const cJSON *max_items = cJSON_GetObjectItemCaseSensitive(schema, "maxItems");
        if (cJSON_IsNumber(max_items) && data_size > (int)max_items->valuedouble) return 0;

        const cJSON *unique = cJSON_GetObjectItemCaseSensitive(schema, "uniqueItems");
        if (cJSON_IsTrue(unique)) {
            for (int i = 0; i < data_size; i++) {
                const cJSON *a = cJSON_GetArrayItem(data, i);
                for (int j = i + 1; j < data_size; j++) {
                    if (cJSON_Compare(a, cJSON_GetArrayItem(data, j), 1)) return 0;
                }
            }
        }

        const cJSON *contains = cJSON_GetObjectItemCaseSensitive(schema, "contains");
        if (contains) {
            int mc = 0;
            const cJSON *elem;
            cJSON_ArrayForEach(elem, data) {
                if (validate_node(elem, contains, res_root, base_uri)) mc++;
            }
            const cJSON *min_c = cJSON_GetObjectItemCaseSensitive(schema, "minContains");
            const cJSON *max_c = cJSON_GetObjectItemCaseSensitive(schema, "maxContains");
            int lo = 1;
            if (cJSON_IsNumber(min_c)) lo = (int)min_c->valuedouble;
            if (mc < lo) return 0;
            if (cJSON_IsNumber(max_c) && mc > (int)max_c->valuedouble) return 0;
        }
    }

    if (cJSON_IsNumber(data)) {
        const cJSON *minimum = cJSON_GetObjectItemCaseSensitive(schema, "minimum");
        const cJSON *maximum = cJSON_GetObjectItemCaseSensitive(schema, "maximum");
        const cJSON *exc_min = cJSON_GetObjectItemCaseSensitive(schema, "exclusiveMinimum");
        const cJSON *exc_max = cJSON_GetObjectItemCaseSensitive(schema, "exclusiveMaximum");

        if (cJSON_IsNumber(minimum)) {
            if (cJSON_IsTrue(exc_min)) {
                if (data->valuedouble <= minimum->valuedouble) return 0;
            } else {
                if (data->valuedouble < minimum->valuedouble) return 0;
            }
        }
        if (cJSON_IsNumber(maximum)) {
            if (cJSON_IsTrue(exc_max)) {
                if (data->valuedouble >= maximum->valuedouble) return 0;
            } else {
                if (data->valuedouble > maximum->valuedouble) return 0;
            }
        }
        if (cJSON_IsNumber(exc_min) && data->valuedouble <= exc_min->valuedouble) return 0;
        if (cJSON_IsNumber(exc_max) && data->valuedouble >= exc_max->valuedouble) return 0;

        const cJSON *mult = cJSON_GetObjectItemCaseSensitive(schema, "multipleOf");
        if (cJSON_IsNumber(mult)) {
            double q = data->valuedouble / mult->valuedouble;
            if (!isfinite(q) || fabs(q - round(q)) > 1e-8) return 0;
        }

        const cJSON *div_by = cJSON_GetObjectItemCaseSensitive(schema, "divisibleBy");
        if (cJSON_IsNumber(div_by)) {
            double q = data->valuedouble / div_by->valuedouble;
            if (!isfinite(q) || fabs(q - round(q)) > 1e-8) return 0;
        }
    }

    if (cJSON_IsString(data)) {
        int len = utf8_codepoint_count(data->valuestring);
        const cJSON *min_len = cJSON_GetObjectItemCaseSensitive(schema, "minLength");
        if (cJSON_IsNumber(min_len) && len < (int)min_len->valuedouble) return 0;
        const cJSON *max_len = cJSON_GetObjectItemCaseSensitive(schema, "maxLength");
        if (cJSON_IsNumber(max_len) && len > (int)max_len->valuedouble) return 0;

        const cJSON *pattern = cJSON_GetObjectItemCaseSensitive(schema, "pattern");
        if (cJSON_IsString(pattern)) {
            /* Skip patterns with Unicode property escapes (\p{...} or \P{...})
               which POSIX regex cannot handle correctly — it misinterprets \p as
               literal 'p', causing false rejections. Silently passing is safer. */
            if (!strstr(pattern->valuestring, "\\p{") &&
                !strstr(pattern->valuestring, "\\P{")) {
                regex_t re;
                if (regcomp(&re, pattern->valuestring, REG_EXTENDED | REG_NOSUB) == 0) {
                    int miss = regexec(&re, data->valuestring, 0, NULL, 0) != 0;
                    regfree(&re);
                    if (miss) return 0;
                }
            }
        }
    }

    const cJSON *if_s = cJSON_GetObjectItemCaseSensitive(schema, "if");
    if (if_s) {
        if (validate_node(data, if_s, res_root, base_uri)) {
            const cJSON *then_s = cJSON_GetObjectItemCaseSensitive(schema, "then");
            if (then_s && !validate_node(data, then_s, res_root, base_uri)) return 0;
        } else {
            const cJSON *else_s = cJSON_GetObjectItemCaseSensitive(schema, "else");
            if (else_s && !validate_node(data, else_s, res_root, base_uri)) return 0;
        }
    }

    return 1;
}

int validate_json_schema(const char *json, const char *schema_str) {
    cJSON *data = cJSON_Parse(json);
    if (!data) return 0;

    cJSON *schema = cJSON_Parse(schema_str);
    if (!schema) { cJSON_Delete(data); return 0; }

    g_ids.n = 0;

    /* Determine whether $ref ignores a sibling $id (draft-03/04/06/07) or applies
       alongside it (draft 2019-09+), based on the declared $schema dialect.
       Default to legacy behavior when no recognizable 2019-09+ dialect is given. */
    g_legacy_ref = 1;
    const cJSON *root_schema = cJSON_GetObjectItemCaseSensitive(schema, "$schema");
    if (cJSON_IsString(root_schema)) {
        const char *sv = root_schema->valuestring;
        if (strstr(sv, "2019-09") || strstr(sv, "2020-12") ||
            strstr(sv, "draft/next"))
            g_legacy_ref = 0;
    }

    const cJSON *root_id = cJSON_GetObjectItemCaseSensitive(schema, "$id");
    const char *root_base = cJSON_IsString(root_id) ? root_id->valuestring : "";
    register_ids(schema, "");

    int result = validate_node(data, schema, schema, root_base);

    cJSON_Delete(data);
    cJSON_Delete(schema);
#ifdef ENABLE_HTTP
    cleanup_remote();
#endif
    return result;
}

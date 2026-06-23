import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { $ } from 'bun';

const ROOT = path.resolve(import.meta.dirname, '..');
const SPEC_ROOT = import.meta.dirname;
const RUNNER_SRC = path.resolve(SPEC_ROOT, 'runner.c');
const RUNNER_BIN = path.resolve(SPEC_ROOT, 'runner');

const DRAFTS = ['draft3', 'draft4', 'draft6', 'draft7', 'draft2019-09', 'draft2020-12'] as const;
type Draft = (typeof DRAFTS)[number];

const GITHUB_API =
  'https://api.github.com/repos/json-schema-org/JSON-Schema-Test-Suite/contents/tests';
const GITHUB_RAW =
  'https://raw.githubusercontent.com/json-schema-org/JSON-Schema-Test-Suite/main/tests';
const GITHUB_TREE =
  'https://api.github.com/repos/json-schema-org/JSON-Schema-Test-Suite/git/trees/main?recursive=1';
const GITHUB_RAW_ROOT =
  'https://raw.githubusercontent.com/json-schema-org/JSON-Schema-Test-Suite/main';

const REMOTES_DIR = path.join(SPEC_ROOT, 'remotes');
const REMOTES_PORT = 1234;

interface KeywordResult {
  keyword: string;
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

interface DraftResult {
  draft: Draft;
  keywords: KeywordResult[];
  total: number;
  passed: number;
  failed: number;
}

async function discoverKeywords(draft: Draft): Promise<string[]> {
  const dir = path.join(SPEC_ROOT, draft);
  if (existsSync(dir)) {
    const local = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''))
      .sort();
    if (local.length > 0) return local;
  }
  const res = await fetch(`${GITHUB_API}/${draft}`);
  if (!res.ok) throw new Error(`GitHub API error for ${draft}: ${res.status}`);
  const entries = (await res.json()) as { name: string; type: string }[];
  return entries
    .filter((e) => e.type === 'file' && e.name.endsWith('.json'))
    .map((e) => e.name.replace('.json', ''))
    .sort();
}

async function downloadTestFiles(draft: Draft, keywords: string[]) {
  const dir = path.join(SPEC_ROOT, draft);
  mkdirSync(dir, { recursive: true });
  const downloads: Promise<void>[] = [];
  for (const kw of keywords) {
    const dest = path.join(dir, `${kw}.json`);
    if (existsSync(dest)) continue;
    downloads.push(
      (async () => {
        const url = `${GITHUB_RAW}/${draft}/${kw}.json`;
        const res = await fetch(url);
        if (!res.ok) {
          console.error(`  Failed to fetch ${url}: ${res.status}`);
          return;
        }
        await Bun.write(dest, await res.text());
      })()
    );
  }
  await Promise.all(downloads);
}

async function ensureRemotes() {
  // Cache: if the remotes dir already has files, assume it's downloaded.
  if (existsSync(REMOTES_DIR) && readdirSync(REMOTES_DIR).length > 0) return;

  console.log('Downloading remote reference fixtures (remotes/)...');
  const res = await fetch(GITHUB_TREE);
  if (!res.ok) throw new Error(`GitHub tree API error: ${res.status}`);
  const tree = (await res.json()) as { tree: { path: string; type: string }[] };

  const blobs = tree.tree.filter(
    (e) => e.type === 'blob' && e.path.startsWith('remotes/')
  );

  await Promise.all(
    blobs.map(async (e) => {
      const rel = e.path.slice('remotes/'.length);
      const dest = path.join(REMOTES_DIR, rel);
      if (existsSync(dest)) return;
      const url = `${GITHUB_RAW_ROOT}/${e.path}`;
      const r = await fetch(url);
      if (!r.ok) {
        console.error(`  Failed to fetch ${url}: ${r.status}`);
        return;
      }
      mkdirSync(path.dirname(dest), { recursive: true });
      await Bun.write(dest, await r.text());
    })
  );
  console.log(`  Downloaded ${blobs.length} remote fixtures.`);
}

function startRemotesServer() {
  return Bun.serve({
    port: REMOTES_PORT,
    async fetch(req) {
      const pathname = decodeURIComponent(new URL(req.url).pathname);
      const filePath = path.join(REMOTES_DIR, pathname);
      // Prevent path traversal outside REMOTES_DIR.
      if (!path.resolve(filePath).startsWith(path.resolve(REMOTES_DIR))) {
        return new Response('Not Found', { status: 404 });
      }
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(file, {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

async function compileRunner() {
  const validateC = path.resolve(ROOT, 'extensions/validate.c');
  const cjsonC = path.resolve(ROOT, 'vendor/cjson/cJSON.c');
  const cjsonInclude = path.resolve(ROOT, 'vendor/cjson');

  await $`cc -O2 -DENABLE_HTTP -o ${RUNNER_BIN} ${RUNNER_SRC} ${validateC} ${cjsonC} -I${cjsonInclude} -lm -lcurl`.quiet();
}

async function runTestFile(draft: Draft, keyword: string): Promise<KeywordResult> {
  const testFile = path.join(SPEC_ROOT, draft, `${keyword}.json`);
  const content = await Bun.file(testFile).text();

  const proc = Bun.spawn([RUNNER_BIN], {
    stdin: new Blob([content]),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const lines = stdout.trim().split('\n');
  const summaryLine = lines.find((l) => l.startsWith('---'));
  const failures = lines.filter((l) => l.startsWith('FAIL'));

  let total = 0,
    passed = 0,
    failed = 0;
  if (summaryLine) {
    const m = summaryLine.match(/(\d+) total, (\d+) passed, (\d+) failed/);
    if (m) {
      total = parseInt(m[1]!);
      passed = parseInt(m[2]!);
      failed = parseInt(m[3]!);
    }
  }

  return { keyword, total, passed, failed, failures };
}

async function runDraft(draft: Draft, keywords: string[]): Promise<DraftResult> {
  const results: KeywordResult[] = [];
  let total = 0,
    passed = 0,
    failed = 0;

  for (const kw of keywords) {
    const r = await runTestFile(draft, kw);
    results.push(r);
    total += r.total;
    passed += r.passed;
    failed += r.failed;
  }

  return { draft, keywords: results, total, passed, failed };
}

function printDraftResult(result: DraftResult) {
  const pct = result.total > 0 ? ((result.passed / result.total) * 100).toFixed(1) : '0.0';
  console.log(`\n${'='.repeat(72)}`);
  console.log(`  ${result.draft}  —  ${result.passed}/${result.total} passed (${pct}%)`);
  console.log('='.repeat(72));

  for (const kw of result.keywords) {
    const status = kw.failed === 0 ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${kw.keyword.padEnd(24)} ${kw.passed}/${kw.total}`);
    if (kw.failures.length > 0) {
      for (const f of kw.failures) {
        console.log(`         ${f}`);
      }
    }
  }
}

function printDetailedFailures(results: DraftResult[]) {
  const hasFailures = results.some((d) => d.keywords.some((k) => k.failed > 0));
  if (!hasFailures) return;

  console.log(`\n${'='.repeat(72)}`);
  console.log('DETAILED FAILURES');
  console.log('='.repeat(72));

  for (const draft of results) {
    const failedKeywords = draft.keywords.filter((k) => k.failed > 0);
    if (failedKeywords.length === 0) continue;

    console.log(`\n--- ${draft.draft} ---`);
    for (const kw of failedKeywords) {
      for (const f of kw.failures) {
        console.log(`  ${f}`);
      }
    }
  }
}

async function main() {
  console.log('Compiling native test runner...\n');
  await compileRunner();

  await ensureRemotes();
  const server = startRemotesServer();
  console.log(`Serving remotes/ fixtures at http://localhost:${REMOTES_PORT}\n`);

  try {
    const draftResults: DraftResult[] = [];
    let grandTotal = 0,
      grandPassed = 0,
      grandFailed = 0;

    for (const draft of DRAFTS) {
      console.log(`\nDiscovering test files for ${draft}...`);
      const keywords = await discoverKeywords(draft);
      console.log(`  Found ${keywords.length} keywords — downloading...`);
      await downloadTestFiles(draft, keywords);

      const result = await runDraft(draft, keywords);
      draftResults.push(result);
      grandTotal += result.total;
      grandPassed += result.passed;
      grandFailed += result.failed;

      printDraftResult(result);
    }

    const grandPct = grandTotal > 0 ? ((grandPassed / grandTotal) * 100).toFixed(1) : '0.0';
    console.log(`\n${'='.repeat(72)}`);
    console.log('GRAND TOTAL');
    console.log('='.repeat(72));
    console.log(
      `  ${grandPassed}/${grandTotal} tests passed across ${DRAFTS.length} drafts (${grandPct}%)`
    );
    console.log(`  ${grandFailed} failures\n`);

    for (const d of draftResults) {
      const pct = d.total > 0 ? ((d.passed / d.total) * 100).toFixed(1) : '0.0';
      const icon = d.failed === 0 ? 'PASS' : 'FAIL';
      console.log(`  [${icon}] ${d.draft.padEnd(16)} ${d.passed}/${d.total} (${pct}%)`);
    }

    console.log('');

    printDetailedFailures(draftResults);
  } finally {
    server.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

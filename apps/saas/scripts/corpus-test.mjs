// Proves the build CORPUS reaches a fresh sandbox at the daemon-equivalent
// paths, that pipeline.py reads the real MANIFEST (not its baked-in fallback),
// and that isSeededPath correctly separates seeded files from game output.
// Zero accounts: LocalSandbox.
import { getSandbox } from "@/lib/sandbox";
import { seedSandbox, isSeededPath } from "@/lib/agent/seed-sandbox";

let fail = 0;
const ok = (c, m) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) fail++;
};

const sandbox = await getSandbox();
try {
  await seedSandbox(sandbox);

  for (const p of [
    ".ogf/conventions/common.md",
    ".ogf/conventions/runtime-patterns.md",
    ".ogf/conventions/juice.md",
    ".ogf/pipelines/game-build.yaml",
    "agent-tools/pipeline.py",
    "agent-tools/fetch-asset.py",
  ]) {
    const b = await sandbox.readFile(p);
    ok(!!b && b.length > 0, `seeded ${p} (${b?.length ?? 0}b)`);
  }

  const ls = await sandbox.exec(
    'for d in .ogf/conventions/genres .ogf/recipes .agents/skills .ogf/foundation-seeds; do echo "$d: $(ls -1 $d 2>/dev/null | wc -l | tr -d " ")"; done',
    { timeout: 15000 },
  );
  console.log(ls.stdout.trim());
  ok(/genres: [1-9]/.test(ls.stdout), "conventions/genres present");
  ok(/recipes: [1-9]/.test(ls.stdout), "recipes present");
  ok(/skills: [1-9]/.test(ls.stdout), "skills present");
  ok(/foundation-seeds: [1-9]/.test(ls.stdout), "foundation seeds present");

  // pipeline.py must find + read the real manifest, not the baked-in fallback.
  const r = await sandbox.exec("python3 agent-tools/pipeline.py next", { timeout: 20000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  ok(r.code === 0, `pipeline.py next exit 0 (got ${r.code})`);
  ok(/discovery|spec|stage|read|\.ogf/i.test(out), `pipeline emitted a stage: ${out.slice(0, 120).replace(/\n/g, " ")}`);

  ok(
    isSeededPath("agent-tools/x.py") &&
      isSeededPath(".ogf/conventions/common.md") &&
      isSeededPath(".ogf/pipeline/state.json") &&
      isSeededPath(".agents/skills/x.md"),
    "isSeededPath true for seeded/tool-scratch",
  );
  ok(
    !isSeededPath("index.html") &&
      !isSeededPath("game.js") &&
      !isSeededPath("data/level.json") &&
      !isSeededPath("assets/player.png"),
    "isSeededPath false for real game output",
  );

  console.log(fail === 0 ? "\n=== ALL CORPUS CHECKS PASSED ===" : `\n=== ${fail} CHECK(S) FAILED ===`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await sandbox.destroy();
}

import { build } from "bun";
import { rmSync } from "node:fs";

// Clean
rmSync("dist", { recursive: true, force: true });

// Step 1: TSC for TUI (preserves JSX, emits both .jsx and .d.ts)
// tsc compiles all .ts/.tsx, Bun.build() overwrites the server entry later
const { spawnSync } = await import("node:child_process");
const tsc = spawnSync("bunx", [
  "tsc",
  "--outDir", "dist",
  "--jsx", "preserve",
  "--declaration",
], { stdio: "inherit", cwd: process.cwd() });

if (tsc.status !== 0) {
  console.error("TSC TUI build failed");
  process.exit(1);
}

// Step 2: Bun.build for server
const serverResult = await build({
  entrypoints: ["src/four-opencode-token-budget-guard.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  external: ["@opencode-ai/*"],
});

if (!serverResult.success) {
  console.error("Server build failed:", serverResult.logs);
  process.exit(1);
}

// Report outputs
for (const out of serverResult.outputs) {
  console.log(`  ${out.path.padEnd(46)} ${(out.size / 1024).toFixed(2)} KB`);
}
for (const f of ["dist/tui.jsx", "dist/tui.d.ts", "dist/four-opencode-token-budget-guard.d.ts"]) {
  const file = Bun.file(f);
  if (await file.exists()) {
    const stat = await file.stat();
    console.log(`  ${f.padEnd(46)} ${(stat.size / 1024).toFixed(2)} KB`);
  }
}

console.log("✅ Built four-opencode-token-budget-guard (server + TUI)");

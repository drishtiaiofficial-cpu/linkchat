import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const say = (s) => process.stdout.write(s + "\n");
const run = (c) => {
  try {
    return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

const node = run("node -v");
const pnpm = run("pnpm -v");
const git = run("git --version");
const tracked = run("git ls-files") ?? "";
const secretsTracked = tracked.split("\n").some((f) => /(^|\/)(\.env|\.dev\.vars)|\.pem$|\.key$/.test(f));

const rows = [
  ["node >= 20", !!node && Number(node.slice(1).split(".")[0]) >= 20, node ?? "missing", "install Node 20+"],
  ["pnpm", !!pnpm, pnpm ?? "missing", "corepack enable"],
  ["git", !!git, git ?? "missing", "install git"],
  ["CI workflow", existsSync(".github/workflows/ci.yml"), ".github/workflows/ci.yml", "redo step 0.4"],
  ["tsconfig", existsSync("tsconfig.json"), "tsconfig.json", "redo step 0.4"],
  ["core package", existsSync("packages/core/src/index.ts"), "packages/core", "redo step 0.4"],
  ["limits doc", existsSync("docs/limits.md"), "docs/limits.md", "redo step 0.6"],
  ["no secrets in git", !secretsTracked, secretsTracked ? "SECRET FILE TRACKED" : "clean", "git rm --cached the file"],
];

let bad = 0;
say("LinkChat doctor");
say("---------------");
for (const [name, ok, detail, fix] of rows) {
  if (!ok) bad++;
  say((ok ? "OK    " : "FAIL  ") + name.padEnd(20) + detail + (ok ? "" : "  -> " + fix));
}
say(bad === 0 ? "DOCTOR OK" : "DOCTOR FAILED: " + bad);
process.exit(bad === 0 ? 0 : 1);

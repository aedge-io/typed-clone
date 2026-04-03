import { format, type SemVer } from "project/version";
import { $ } from "project/shell";
import { Manifest } from "project/manifest";

const root = $.path(import.meta.url).parentOrThrow().parentOrThrow();
const denoJsonc = root.join("deno.jsonc");

export const manifest = await Manifest.loadFrom(denoJsonc);

export const paths = {
  root,
  changelog: root.join("CHANGELOG.md"),
  changesDir: root.join("docs/changes"),
  denoJsonc,
  libEntryPoint: root.join("lib/clone.ts"),
  license: root.join("LICENSE.md"),
  npmDir: root.join("npm"),
  readme: root.join("README.md"),
  planDir: root.join(".release"),
  planJson: root.join(".release/plan.json"),
  planChangelog: root.join(".release/changelog.md"),
  planChange: (ver: SemVer) => paths.planDir.join(`${format(ver)}.md`),
  change: (ver: SemVer) => paths.changesDir.join(`${format(ver)}.md`),
} as const;

export const git = {
  defaultBranch: "main",
  repo: new URL("https://github.com/aedge-io/typed-clone"),
  remote: new URL("git+https://github.com/aedge-io/typed-clone.git"),
  issues: new URL("https://github.com/aedge-io/typed-clone/issues"),
} as const;

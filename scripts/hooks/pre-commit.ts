#!/usr/bin/env -S deno run -A

import { $ } from "project/shell";
import { Cmd, runPipeline, Step } from "project/pipeline";

const root = await $`git rev-parse --show-toplevel`.text();
const staged = (await $`git diff \
  --cached \
  --name-only \
  --diff-filter=ACMR`
  .lines()).map((file) => $.path(root).join(file));

await runPipeline({
  name: "[Pre-commit]>",
  steps: [
    Step("fmt", "fmt staged files...", Cmd($`deno fmt -q ${staged}`)),
    Step("git", "re-add to the index...", Cmd($`git add ${staged}`)),
  ],
});

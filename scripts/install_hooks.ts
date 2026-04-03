#!/usr/bin/env -S deno run --cached-only -A

import { $ as shellBuilder } from "project/shell";
import { paths } from "project/metadata";

const $ = shellBuilder.withLogPrefix("[Install Hooks]>");

const gitHooksDir = paths.root.join(".git", "hooks");

if (!gitHooksDir.existsSync()) {
  $.logError("not a git repository (no .git/hooks directory found).");
  Deno.exit(1);
}

function installHook(hookName: string, sourcePath: string) {
  const source = paths.root.join(sourcePath);
  const target = gitHooksDir.join(hookName);

  $.logLight(`linking ${hookName} -> ${sourcePath}...`);

  if (target.existsSync() || target.isSymlinkSync()) {
    $.logLight(`hook ${hookName} already exists. Removing it...`);
    target.removeSync();
  }

  /* You've read that right */
  target.symlinkToSync(source, { kind: "absolute" });
  source.chmodSync(0o755);

  $.logLight(`hook ${hookName} installed.`);
}

installHook("pre-commit", "scripts/hooks/pre-commit.ts");
installHook("pre-push", "scripts/hooks/pre-push.ts");

$.logStep("all hooks installed.");

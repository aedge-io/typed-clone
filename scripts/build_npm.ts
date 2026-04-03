#!/usr/bin/env -S deno run -A

import { Err, Ok, type Result, Task } from "@aedge-io/grugway";
import { build } from "@deno/dnt";
import { dirIsEmpty } from "project/fs";
import { git, manifest, paths } from "project/metadata";
import { $ as $builder } from "project/shell";
import { format, parse, type SemVer, versionsMatch } from "project/version";

const $ = $builder.withLogPrefix("[Build Npm]>");

$.enableShutdownHooks();

const { root, npmDir, libEntryPoint, readme, license } = paths;

function main() {
  return parse(Deno.args[0])
    .inspect(versionToBuild)
    .andEnsure(releaseVersionsMatch)
    .into(Task.of<SemVer, Error>)
    .andEnsure(npmDirIsEmpty)
    .andThen(buildPackage);
}

await main().then((res) => {
  const code = res
    .inspect(() => $.logStep("succeeded"))
    .inspectErr($.logError)
    .mapOr(() => 0, 1)
    .unwrap();

  Deno.exit(code);
});

/*
 ********************************************************************
 * build definitions and log helpers
 ********************************************************************
 */

function npmDirIsEmpty() {
  return dirIsEmpty(npmDir.toString());
}
function versionToBuild(v: SemVer) {
  $.logStep(`new version ${format(v)}`);
}
function releaseVersionsMatch(v: SemVer) {
  return versionsMatch(manifest.version, v);
}

async function buildPackage(next: SemVer): Promise<Result<void, Error>> {
  try {
    await build({
      entryPoints: [root.relative(libEntryPoint).toString()],
      outDir: npmDir.toString(),
      declaration: "separate",
      scriptModule: false,
      test: false,
      shims: {
        deno: false,
      },
      package: {
        name: manifest.name,
        version: format(next),
        description: manifest.description,
        license: "MIT",
        author: "aedge-io <os@aedge.io>",
        engines: {
          "node": ">=17.0.0", /* needed for structuredClone */
        },
        repository: {
          type: "git",
          url: git.remote.toString(),
        },
        bugs: {
          url: git.issues.toString(),
        },
        publishConfig: {
          access: "public",
          provenance: true,
        },
        keywords: [
          "clanker-friendly",
          "clone",
          "copy",
          "deep",
          "deep-clone",
          "deep-copy",
          "deepclone",
          "deepcopy",
          "extensible",
          "protocol",
          "recursive",
          "safe",
          "structured",
          "type-safe",
          "typed",
          "types",
          "typesafe",
        ],
      },
      compilerOptions: {
        lib: ["DOM", "ES2022"], /* needed for structuredClone */
        target: "ES2022",
      },
      postBuild() {
        license.copyFileSync(npmDir.join("LICENSE.md"));
        readme.copyFileSync(npmDir.join("README.md"));
        npmDir.join("src").removeSync({ recursive: true });
      },
    });
    return Ok(undefined);
  } catch (e: unknown) {
    return Err(Error(`Build failed`, { cause: e }));
  }
}

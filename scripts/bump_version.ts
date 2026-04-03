#!/usr/bin/env -S deno run -A --cached-only

import { manifest } from "project/metadata";
import { tryParse } from "project/version";
import { Task } from "@aedge-io/grugway";

await tryParse(Deno.args[0]).into((res) => Task.of(res)).andThen((v) =>
  manifest.withBumpedVersion(v).flush()
);

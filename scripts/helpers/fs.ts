import { Task } from "@aedge-io/grugway";
import { emptyDir } from "@deno/dnt";
import { $ } from "project/shell";

export async function projectRoot() {
  return $.path(await $`git rev-parse --show-toplevel`.text());
}

export const readFile = Task.liftFallible(Deno.readTextFile, failedToRead);

export const writeFile = Task.liftFallible(Deno.writeTextFile, failedToWrite);

/**
 * {@linkcode emptyDir}
 */
export const dirIsEmpty = Task.liftFallible(emptyDir, failedToEmptyDir);

function failedToRead(e: unknown) {
  return Error("Failed to read file", { cause: e });
}
function failedToWrite(e: unknown) {
  return Error("Failed to write file", { cause: e });
}
function failedToEmptyDir(e: unknown) {
  return Error(`Failed to prepare directory`, { cause: e });
}

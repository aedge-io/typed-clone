import { $, shellTask } from "project/shell";
import type { Result, Task } from "@aedge-io/grugway";
import { Err, None, Ok, Option, Results, Some } from "@aedge-io/grugway";
import { git } from "project/metadata";
import type { SemVer } from "project/version";
import { format, parse } from "project/version";

export type Commit = {
  sha: string;
  author: string;
  date: string;
  summary: string;
  url: string;
  authorUrl: string;
};

export function worktreeIsTidy() {
  return shellTask($`git status --porcelain`.captureCombined(true)).andThen(
    (cmdRes) => {
      const isDirty = cmdRes.combinedBytes.length > 0;
      if (isDirty) return Err(Error("worktree is dirty"));
      return Ok.empty();
    },
  );
}

export function onDefaultBranch() {
  return shellTask($`git branch --show-current`).andThen(
    (cmdRes) => {
      const currentBranch = cmdRes.stdout.trim();
      if (currentBranch !== git.defaultBranch) {
        return Err(
          Error(
            `not on default branch ${git.defaultBranch} (current: ${currentBranch})`,
          ),
        );
      }
      return Ok.empty();
    },
  );
}

/**
 * @default "HEAD"
 */
export function revisionShaOf(rev = "HEAD") {
  return shellTask($`git rev-parse ${rev}`).map((cmdRes) =>
    cmdRes.stdout.trim()
  );
}

export type ReleaseData = {
  tag: SemVer;
  sha: string;
  /** ISOString */
  date: string;
};
export function releaseDataOf(v: SemVer): Task<Option<ReleaseData>, Error> {
  return shellTask(
    $`git log -1 --format="%(describe:tags=true) %H %aI" ${format(v)}`,
  )
    .mapOr((cmdRes) => Option.fromCoercible(cmdRes.stdout.trim()), None)
    .andThen((data) => {
      if (data.isNone()) return Ok<Option<ReleaseData>>(data);
      const dataStr = data.unwrap();

      const [tagStr, shaStr, dateStr] = dataStr.split(" ");

      const parsedTag = parse(tagStr);

      const parsedSha = Option.fromCoercible(shaStr).okOrElse(() =>
        TypeError(`commit sha referring to ${format(v)} was empty`)
      );

      const parsedDate = parseDateString(dateStr);

      const parsed = Results.all([parsedTag, parsedSha, parsedDate] as const);

      if (parsed.isErr()) {
        return parsed.mapErr((e) =>
          TypeError(
            `failed to parse release data referring to ${format(v)}`,
            { cause: e },
          )
        );
      }

      const [tag, sha, date] = parsed.unwrap();

      return Ok(Some({
        tag,
        sha,
        date,
      }));
    });
}

function parseDateString(
  ...args: ConstructorParameters<typeof Date>
): Result<string, TypeError> {
  try {
    const parsed = new Date(...args).toISOString();
    return Ok(parsed);
  } catch (e) {
    return Err(TypeError(`failed to parse ${args} as date`, { cause: e }));
  }
}

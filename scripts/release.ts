#!/usr/bin/env -S deno run -A --cached-only

import type { DeferredTask, Empty, Result } from "@aedge-io/grugway";
import { Err, None, Ok, Option, Some, Task, Tasks } from "@aedge-io/grugway";
import { parseArgs } from "@std/cli/parse-args";
import type { ChangelogOptions } from "project/changes";
import {
  generateChange,
  generateChangelog,
  updateChange,
  updateChangelog,
} from "project/changes";
import { readFile, writeFile } from "project/fs";
import type { Commit, ReleaseData } from "project/git";
import {
  onDefaultBranch,
  releaseDataOf,
  revisionShaOf,
  worktreeIsTidy,
} from "project/git";
import {
  createIntegrityTag,
  extractIntegrityMetadata,
} from "project/integrity";
import { git, manifest, paths } from "project/metadata";
import type { PipelineOptions, Step, TerminatorFn } from "project/pipeline";
import { Cmd, runPipeline } from "project/pipeline";
import type { Path } from "project/shell";
import {
  $ as $builder,
  CommandResult,
  interactiveShellTask,
  shellTask,
} from "project/shell";
import type { SemVer } from "project/version";
import { format, increment } from "project/version";

const PREFIX = "[Release]>";

const $ = $builder.withLogPrefix(PREFIX);

$.enableShutdownHooks();

const RELEASE_TYPES = ["major", "minor", "patch"] as const;

type ReleaseType = typeof RELEASE_TYPES[number];

function isValidRelease(value: string): value is ReleaseType {
  return (RELEASE_TYPES as readonly string[]).includes(value);
}

function initLogState() {
  let VERBOSE = false;
  const set = (option: boolean) => {
    VERBOSE = option;
  };
  const get = () => VERBOSE;

  return { set, get };
}

const verboseMode = initLogState();

/*
 *************************************************************************
 * main flow: options -> release ctx -> generate & save plan -> apply
 *************************************************************************
 */

const usage = `<path/to/release.ts> [<major | minor | patch>] [<options>]

This release script supports a staged execution model: plan -> apply
1.) plan: generate draft change, draft changelog and actions
2.) apply: execute planned actions (move files, commit & tag etc)

Options:
  -a, --apply      apply planned actions (requires: tidy default branch)
  -d, --dirty      allow running in dirty worktree (dry-runs apply)
  -e, --[no-]edit  interactive editing (default: true, requires: TTY)
  -h, --help       display this help message
  -p, --plan       generate change artifacts
  -t, --title      optional title for the release
  -v, --verbose    print intermediate results etc.

Examples: 
  $ <path/to/release.ts> -p -a    //pick release, generate plan & apply
 
  $ <path/to/release.ts> minor -p //generate plan artifacts for minor release
  $ <path/to/release.ts> --apply  //apply planned actions for minor release`;

async function main() {
  const parsedOpts = parseScriptArgs(Deno.args);

  if (parsedOpts.isErr()) return parsedOpts;

  const opts = parsedOpts.unwrap();

  if (opts.help) {
    console.log(usage); /* should go to stdout */
    return Ok(undefined);
  }

  if (!opts.plan && opts.release) {
    $.logWarn("specifying a release type only affects plan mode");
  }

  $.logStep(`executing in ${opts.dirty ? "dry" : "live"}-run mode`);

  return await Task.succeed(opts)
    .inspect(ifVerbose(`plan mode: ${opts.plan}`))
    .inspect(ifVerbose(`apply mode: ${opts.apply}`))
    .andThen(gatherCtx)
    .andThen(generatePlan)
    .andThen(apply);
}

await main().then(exit).catch(abort);

/*
 *************************************************************************
 * release script options
 *************************************************************************
 */

type ReleaseOpts = {
  apply: boolean;
  dirty: boolean;
  edit: boolean;
  help: boolean;
  plan: boolean;
  verbose: boolean;
  title?: string;
  release?: ReleaseType;
};

function parseScriptArgs(args: string[]): Result<ReleaseOpts, Error> {
  const parsed = parseArgs(args, {
    alias: {
      a: "apply",
      d: "dirty",
      "dry-run": "dirty",
      h: "help",
      p: "plan",
      v: "verbose",
      t: "title",
    },
    boolean: ["apply", "edit", "help", "dirty", "plan", "verbose"],
    negatable: ["edit"],
    default: { edit: true },
    string: ["title"],
  });

  const { apply, dirty, edit, help, plan, verbose } = parsed;

  verboseMode.set(verbose);

  const noModeSpecified = !(plan || apply) && !help;
  if (noModeSpecified) {
    return Err(
      Error(
        "no execution mode specified - run with \`--plan\` and/or \`--apply\`",
      ),
    );
  }

  const interactiveWithoutTTY = edit && !Deno.stdin.isTerminal();
  if (interactiveWithoutTTY) {
    return Err(Error("edit mode requires a TTY - run with \`--no-edit\` flag"));
  }

  const release = Option.fromCoercible(args[0]).filter(isValidRelease).unwrap();

  const title = Option.fromCoercible(parsed.title).unwrap();

  return Ok({ apply, plan, edit, help, dirty, title, release, verbose });
}

/*
 *************************************************************************
 * initial context for both plan and apply mode
 *************************************************************************
 */

type Ctx = {
  opts: ReleaseOpts;
  last?: ReleaseData;
  current: {
    headSha: string;
    version: SemVer;
  };
};

async function gatherCtx(
  opts: ReleaseOpts,
): Promise<Result<Ctx, Error | CommandResult>> {
  $.logStep("gathering initial context");

  const version = manifest.version;

  const gitData = await Tasks.all(
    [revisionShaOf("HEAD"), releaseDataOf(version)] as const,
  );

  if (gitData.isErr()) return gitData;

  const [headSha, lastRelease] = gitData.unwrap();

  return Ok({
    opts,
    last: lastRelease.unwrap(),
    current: {
      headSha,
      version,
    },
  }).inspect(ifVerbose((ctx) => {
    const { headSha, version } = ctx.current;
    $.logLight(
      `starting from ${format(version)} (head: ${headSha.slice(0, 7)}...)`,
    );
  }));
}

/*
 *************************************************************************
 * plan mode: enrich context -> generate draft artifacts -> actions
 *************************************************************************
 */

type PlanCtx = Omit<Ctx, "opts"> & {
  opts: Omit<ReleaseOpts, "release" | "title">;
  next: {
    version: SemVer;
    type: ReleaseType;
    title?: string;
  };
  commits: Commit[];
};

type Action = {
  name: string;
  description: string;
  cmd: string;
};

type Plan = {
  ctx: PlanCtx;
  actions: Action[];
};

async function generatePlan(
  ctx: Ctx,
): Promise<Result<Plan, Error | CommandResult>> {
  const activePlan = await loadActivePlan(ctx, paths.planJson);

  if (!ctx.opts.plan) {
    return activePlan
      .inspect((plan) => reportUpcomingRelease(plan.ctx));
  }

  $.logStep("starting to generate plan artifacts");

  const planFilesAreSetup = (ctx: PlanCtx) => {
    const planFiles = [
      paths.planJson,
      paths.planChange(ctx.next.version),
      paths.planChangelog,
    ];
    return filesAreSetUp(planFiles);
  };

  if (!ctx.opts.release && activePlan.isOk()) {
    return activePlan.asResult()
      .inspect(ifVerbose("processing draft release artifacts with active plan"))
      .into((res) => Task.of(res))
      .andEnsure(() => planConditionsAreMet(ctx))
      .andEnsure((plan) => planFilesAreSetup(plan.ctx))
      .andEnsure(releaseArtifactsAreCreated);
  }

  return await Task.succeed(ctx)
    .inspect(ifVerbose("(re)creating draft release artifacs"))
    .andEnsure(planConditionsAreMet)
    .andThen(gatherPlanCtx)
    .andEnsure(planFilesAreSetup)
    .andThen(derivePlan)
    .andEnsure(releaseArtifactsAreCreated);
}

function loadActivePlan(ctx: Ctx, path: Path): Task<Plan, Error> {
  return Task.fromPromise(
    path.readJson<Plan>(),
    (e) => Error(`failed to load existing plan file`, { cause: e }),
  )
    .inspect(ifVerbose("loaded existing plan file"))
    .andEnsure(isValidPlan)
    .andEnsure((plan) => refersToCurrentHead(plan, ctx))
    .map((plan) => updateOpts(plan, ctx.opts))
    .inspect(ifVerbose("updated context options for active plan file"));
}

function isValidPlan(value: unknown) {
  return Option(value).filter(isPlan).okOrElse(() =>
    TypeError(`plan file is invalid`, {
      cause: JSON.stringify(value),
    })
  );
}

function refersToCurrentHead(plan: Plan, ctx: Ctx) {
  const planHeadSha = plan.ctx.current.headSha;
  const currentHeadSha = ctx.current.headSha;

  if (planHeadSha !== currentHeadSha) {
    return Err(
      Error(`plan file refers to a different HEAD`, {
        cause: { plan: planHeadSha, current: currentHeadSha },
      }),
    );
  }

  return Ok.empty();
}

function updateOpts(plan: Plan, opts: ReleaseOpts) {
  const cloned = structuredClone(plan);

  cloned.ctx.opts = opts;

  return cloned;
}

/* Roughly correct */
function isPlan(value: unknown): value is Plan {
  // deno-lint-ignore no-explicit-any
  const v = value as any;

  if (
    typeof v === "object" && v != null && !Array.isArray(v)
    && Object.hasOwn(v, "ctx") && Object.hasOwn(v, "actions")
    && typeof v.ctx === "object" && v.ctx != null
    && typeof v.ctx.opts === "object" && v.ctx.opts != null
    && typeof v.ctx.current === "object" && v.ctx.current != null
    && typeof v.ctx.current.version === "object"
    && typeof v.ctx.current.headSha === "string"
    && typeof v.ctx.next === "object" && v.ctx.next != null
    && typeof v.ctx.next.version === "object"
    && v.ctx.commits != null && Array.isArray(v.ctx.commits)
    && v.actions != null && Array.isArray(v.actions) && v.actions.length > 0
  ) {
    return true;
  }

  return false;
}

function gatherPlanCtx(ctx: Ctx): Task<PlanCtx, Error | CommandResult> {
  return Task.of(releaseType(ctx.opts))
    .inspect(ifVerbose((rt) => {
      $.logLight(`gathering ctx for next ${rt} release`);
    }))
    .map((release) => enrichWithNext(ctx, release))
    .andThen(gatherCommitHistory);
}

async function releaseType(args: Pick<ReleaseOpts, "release" | "edit">) {
  let interactive: Option<ReleaseType> = None;

  const fromStdin = Option.fromCoercible(args.release).filter(isValidRelease);

  if (fromStdin.isNone() && args.edit) {
    interactive = Option(
      await $.maybeSelect({
        message: `${PREFIX} select release type:`,
        options: RELEASE_TYPES.map((rt) => rt),
        initialIndex: RELEASE_TYPES.findIndex((rt) => rt === "minor"),
      }),
    ).map((idx) => RELEASE_TYPES[idx]);
  }

  return fromStdin.or(interactive).okOr(Error("no release type provided"));
}

function enrichWithNext(ctx: Ctx, release: ReleaseType) {
  const next = {
    version: increment(ctx.current.version, release),
    type: release,
    title: ctx.opts.title,
  };

  return { ...ctx, next };
}

function gatherCommitHistory(
  ctx: Omit<PlanCtx, "commits">,
): Task<PlanCtx, CommandResult> {
  const pb = $.progress(`${PREFIX} fetching commit history...`);

  return pb.with(() => {
    const query = Option(ctx.last?.date).map((d) => `?since=${d}`);

    return shellTask(
      $`gh api repos${git.repo.pathname}/commits${query} \
          --jq '[.[] | {
           sha: .sha,
           author: .author.login,
           authorUrl: .author.html_url,
           date: .commit.author.date,
           summary: .commit.message | split(\"\n\")[0],
           url: .html_url
          }]'`,
    ).map((cmdRes) => ({
      ...ctx,
      commits: cmdRes.stdoutJson as Commit[], /* basically parsed */
    }));
  });
}

function reportUpcomingRelease(ctx: PlanCtx) {
  const head = ctx.current.headSha.slice(0, 7);
  const ver = format(ctx.next.version);
  const rt = ctx.next.type;
  const cnt = ctx.commits.length;

  $.logStep(
    `upcoming ${rt} release ${ver} includes ${cnt} commits (head: ${head}...)`,
  );
}

function planConditionsAreMet(
  ctx: Ctx,
): Task<Empty, Error | CommandResult> {
  if (!ctx.opts.dirty) {
    return worktreeIsTidy().inspect(ifVerbose("worktree is tidy"));
  }
  return Task.of(Ok.empty());
}

function filesAreSetUp(paths: Path[]): Task<Empty, Error> {
  const failedToSetup = (e: unknown) =>
    Error(`failed to setup a plan file`, { cause: e });

  return Tasks.all(
    paths.map((p) =>
      Task.fromPromise(p.ensureFile(), failedToSetup).inspect(
        ifVerbose(`set up ${p}`),
      )
    ),
  ).inspect(ifVerbose("all plan files set up"));
}

function releaseArtifactsAreCreated(
  plan: Plan,
): Task<Empty, Error | CommandResult> {
  return Task.succeed(plan)
    .inspect((plan) => reportUpcomingRelease(plan.ctx))
    .andEnsure((plan) => upsertChangeFile(plan.ctx))
    .inspect(ifVerbose("change file saved"))
    .andEnsure((plan) => upsertChangelog(plan.ctx))
    .inspect(ifVerbose("changelog saved"))
    .andEnsure(upsertPlanFile)
    .inspect(ifVerbose("plan file saved"))
    .inspect(() => $.logStep(`plan files saved in ${paths.planDir}`));
}

function upsertChangeFile(
  ctx: PlanCtx,
): Task<Empty, Error | CommandResult> {
  const changeFile = paths.planChange(ctx.next.version);
  const nextVer = format(ctx.next.version);

  const changeOpts = {
    commits: ctx.commits,
    lastTag: Option(ctx.last?.tag),
    nextTag: ctx.next.version,
    title: Option.fromCoercible(ctx.next.title),
    sha: ctx.current.headSha,
    repo: git.repo,
    defaultBranch: git.defaultBranch,
  };

  return readFile(`${changeFile}`)
    .inspect(
      ifVerbose((c) =>
        $.logLight(`read draft change file (length: ${c.length})`)
      ),
    )
    .andThen((content) => {
      if (!content) {
        return writeFile(`${changeFile}`, generateChange(changeOpts))
          .inspect(ifVerbose("wrote initial draft change file"));
      }

      const integrity = extractIntegrityMetadata(content)
        .inspect(ifVerbose(({ version, sha }) => {
          const head = sha.slice(0, 7);
          $.logLight(
            `existing draft change refers to ${version} (head: ${head}...)`,
          );
        }))
        .unwrap();

      if (!integrity) {
        return Task.fail(
          Error(`existing draft change lacks required integrity tag`),
        );
      }

      /* should never happen since change file name is tied to the version */
      if (integrity.version !== nextVer) {
        /* ...BUT: i know myself, so this is for you, beloved future self */
        return Task.fail(
          Error(`existing draft change refers to ${integrity.version}`),
        );
      }

      if (integrity.sha !== ctx.current.headSha) {
        return Task.of(updateChange(content, changeOpts))
          .inspect(ifVerbose("updated draft change content"))
          .andThen((newContent) => writeFile(`${changeFile}`, newContent))
          .inspect(ifVerbose("wrote draft change file"));
      }

      return Task.succeed(undefined);
    }).andThen(() => {
      if (!ctx.opts.edit) return Task.of(Ok.empty());

      return interactiveShellTask($`$EDITOR ${changeFile}`);
    });
}

function upsertChangelog(ctx: PlanCtx): Task<Empty, Error | CommandResult> {
  const nextVer = format(ctx.next.version);

  const changelogOpts = {
    next: ctx.next.version,
    title: Option(ctx.next.title),
    sha: ctx.current.headSha,
    commits: ctx.commits,
    changelog: paths.changelog,
    change: paths.change(ctx.next.version),
  };

  return readFile(`${paths.planChangelog}`)
    .inspect(
      ifVerbose((c) =>
        $.logLight(`read draft changelog file (length: ${c.length})`)
      ),
    )
    .andThen((content) => {
      if (!content) {
        return Task.of(changelogFromOriginal(ctx, changelogOpts))
          .andThen((cl) => writeFile(`${paths.planChangelog}`, cl))
          .inspect(ifVerbose("wrote initial draft changelog"));
      }

      const integrity = extractIntegrityMetadata(content)
        .inspect(ifVerbose(({ version, sha }) => {
          const head = sha.slice(0, 7);
          $.logLight(
            `existing draft changelog refers to ${version} (head: ${head}...)`,
          );
        }))
        .unwrap();

      if (!integrity) {
        return Task.fail(
          Error(`existing draft changelog lacks required integrity tag`),
        );
      }

      if (integrity.version !== nextVer) {
        return Task.of(changelogFromOriginal(ctx, changelogOpts))
          .inspect(ifVerbose("recreated draft changelog content"))
          .andThen((cl) => writeFile(`${paths.planChangelog}`, cl))
          .inspect(ifVerbose("wrote draft changelog file"));
      }

      if (integrity.sha !== ctx.current.headSha) {
        return Task.of(updateChangelog(content, changelogOpts))
          .inspect(ifVerbose("updated draft changelog content"))
          .andThen((cl) => writeFile(`${paths.planChangelog}`, cl))
          .inspect(ifVerbose("wrote draft changelog file"));
      }

      return Task.succeed(undefined);
    }).andThen(() => {
      if (!ctx.opts.edit) return Task.of(Ok.empty());

      return interactiveShellTask($`$EDITOR ${paths.planChangelog}`);
    });
}

async function changelogFromOriginal(
  ctx: PlanCtx,
  opts: ChangelogOptions,
) {
  const original = await readFile(`${paths.changelog}`).inspect(
    ifVerbose((c) =>
      $.logLight(`read orignal changelog file (length: ${c.length})`)
    ),
  );

  if (original.isErr() || original.unwrap().length === 0) {
    return Ok(generateChangelog(opts))
      .inspect(ifVerbose("generated initial draft changelog content"));
  }

  const originalContent = original.unwrap();

  const integrityTag = createIntegrityTag({
    version: format(ctx.next.version),
    sha: ctx.current.headSha,
  });

  return Task.of(updateChangelog(
    originalContent.concat(integrityTag),
    opts,
  )).inspect(ifVerbose("generated draft content from original changelog"));
}

function upsertPlanFile(plan: Plan): Task<void, Error> {
  const ver = format(plan.ctx.next.version);

  /* for now just overwrites any old plan */
  return writeFile(`${paths.planJson}`, JSON.stringify(plan))
    .inspect(ifVerbose(`overwrote plan file for ${ver}`));
}

function derivePlan(ctx: PlanCtx): Task<Plan, Error> {
  const nextVer = ctx.next.version;
  const nextStr = format(nextVer);
  const title = Option.fromCoercible(ctx.next.title).map((t) => ` - ${t}`);
  const tagMsg = `release ${nextStr}${title}`;

  const moveChangeFile: Action = {
    name: "[change]",
    description: "moving draft to docs/changes...",
    cmd: `mv ${paths.planChange(nextVer)} ${paths.change(nextVer)}`,
  };

  const moveChangelog: Action = {
    name: "[changelog]",
    description: "moving draft to project root...",
    cmd: `mv ${paths.planChangelog} ${paths.changelog}`,
  };

  const updateManifest: Action = {
    name: "[manifest]",
    description: "bumping version to next...",
    cmd: `deno task -q bump ${nextStr}`,
  };

  const addChanges: Action = {
    name: "[git]",
    description: "adding changes to index...",
    cmd: "git add -A",
  };

  const commitChanges: Action = {
    name: "[git]",
    description: "commiting changes...",
    cmd: `git commit -m "chore(release): version ${nextStr}"`,
  };

  const tagReleaseCommit: Action = {
    name: "[git]",
    description: "tagging release commit...",
    cmd: `git tag ${nextStr} -m "${tagMsg}"`,
  };

  const pushRelease: Action = {
    name: "[git]",
    description: "pushing to remote repository...",
    cmd: `git push origin ${git.defaultBranch} --tags --force`,
  };

  const cleanup: Action = {
    name: "[cleanup]",
    description: "removing used plan files...",
    cmd: `rm -rf ${paths.planDir}`,
  };

  return Task.succeed({
    ctx,
    actions: [
      moveChangeFile,
      moveChangelog,
      updateManifest,
      addChanges,
      commitChanges,
      tagReleaseCommit,
      pushRelease,
      cleanup,
    ],
  });
}

/*
 *************************************************************************
 * apply mode: ensure state invariants -> execute planned actions
 *************************************************************************
 */

async function apply(plan: Plan) {
  if (!plan.ctx.opts.apply) {
    return Task.succeed(undefined);
  }

  $.logStep(`starting to apply ${plan.actions.length} planned actions`);

  return await Task.succeed(plan)
    .andEnsure(applyConditionsAreMet)
    .map(toPipeline)
    .andThen(async ([opts, completion]) => {
      const { task, succeed, fail } = completion;

      await Promise.race([
        runPipeline(opts).then(() => succeed()),
        $.sleep("15s").then(() => fail(Error("apply timed out"))),
      ]);

      return task;
    })
    .inspect(() => $.logStep("completed successfully"));
}

function applyConditionsAreMet(plan: Plan): Task<Empty, Error | CommandResult> {
  if (plan.ctx.opts.dirty) {
    return Task.of(Ok.empty().asResult())
      .inspect(ifVerbose("no apply conditions checked in dry-run mode"));
  }

  return Tasks.all([
    onDefaultBranch().inspect(ifVerbose("on default branch")),
    worktreeIsTidy().inspect(ifVerbose("worktree is tidy")),
    /* required for signing commits & tags with keychain */
    shellTask($`ssh-add -l`).inspect(ifVerbose("ssh agent is running")),
  ]).inspect(ifVerbose("ensured all apply conditions are met"));
}

function toPipeline(
  plan: Plan,
): [PipelineOptions, DeferredTask<void, Error | CommandResult>] {
  const isDryRun = plan.ctx.opts.dirty;

  const completion = Task.deferred<void, Error | CommandResult>();

  const terminatorFn = completion.fail;

  const steps = plan.actions.map((action) =>
    toStep(action, terminatorFn, isDryRun)
  );

  const name = `${PREFIX}[apply]>${isDryRun ? "(dry-run)>" : ""}`;

  const pipelineOpts: PipelineOptions = {
    name,
    steps,
    executor: $,
  };

  return [pipelineOpts, completion] as const;
}

function toStep(action: Action, termFn: TerminatorFn, isDryRun = true): Step {
  const { name, description, cmd } = action;

  const rawCmd = isDryRun ? $`dry-run '${$.rawArg(cmd)}'` : $.raw`${cmd}`;

  const cmdBuilder = verboseMode.get() ? rawCmd.printCommand() : rawCmd;

  cmdBuilder.setPrintCommandLogger($.logLight); /* Only effects verbose mode */

  const errChannel = verboseMode.get() ? "both" : "none";

  const stepCmd = Cmd(cmdBuilder, errChannel, Some(termFn));

  return { name, description, cmd: stepCmd };
}

/*
 *************************************************************************
 * error & exit utilities
 *************************************************************************
 */

function abort(e: Error | CommandResult): never {
  const [code, err] = errorEssentials(e);

  $.logError("aborting due to error:\n", err);

  $.killAll();
  Deno.exit(code);
}

function exit(res: Result<unknown, Error | CommandResult>): never {
  const [code, err] = res.mapErr((e) => errorEssentials(e))
    .err()
    .unwrapOr([0, undefined]);

  if (err) {
    verboseMode.get() ? $.logError(err) : $.logError(err.message);
  }

  $.killAll();
  Deno.exit(code);
}

function errorEssentials(e: Error | CommandResult): [number, Error] {
  return Error.isError(e)
    ? [1, e]
    : e instanceof CommandResult
    ? [e.code, Error(e.stderr)]
    : [1, Error("unknown", { cause: e })];
}

/*
 *************************************************************************
 * logging utilities
 *************************************************************************
 */

function ifVerbose<
  Args extends unknown[],
>(arg: ((...args: Args) => void) | string): (...args: Args) => void {
  if (verboseMode.get()) {
    if (typeof arg === "string") {
      return () => $.logLight(arg);
    }
    return arg;
  }
  return (() => {}) as unknown as (...args: Args) => void;
}

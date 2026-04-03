import { None, Option, Some } from "@aedge-io/grugway";
import type { $Base, CommandBuilder, CommandResult } from "project/shell";
import { $, shellTask } from "project/shell";

export type ErrorChannel = "stderr" | "stdout" | "both" | "none";

export type TerminatorFn = (cmdRes: CommandResult) => void;

export type Cmd = {
  cmd: CommandBuilder;
  errChannel: ErrorChannel;
  terminatorFn: Option<TerminatorFn>;
};

export function Cmd(
  cmd: CommandBuilder,
  errChannel: ErrorChannel = "stderr",
  terminatorFn: Option<TerminatorFn> = Some(terminate),
): Cmd {
  return { cmd, errChannel, terminatorFn };
}

export type Step = {
  name: string;
  description: string;
  cmd: Cmd;
};

export function Step(
  name: string,
  description: string,
  cmd: Cmd,
): Step {
  return { name, description, cmd };
}

export type PipelineOptions = {
  name: string;
  steps: Step[];
  executor?: $Base;
};

export async function runPipeline(opts: PipelineOptions) {
  const { name, steps, executor = $ } = opts;

  let err: Option<CommandResult> = None;
  let terminatorFn: Option<TerminatorFn> = None;

  pipeline: for (const step of steps) {
    terminatorFn = step.cmd.terminatorFn;

    const pb = executor.progress(name);

    const stepRes = await pb.message(step.description).with(() => {
      return runStep(step.name, step.cmd, executor);
    });

    if (stepRes.isErr() && terminatorFn.isSome()) {
      err = stepRes.err();
      break pipeline;
    }
  }

  Option.apply(terminatorFn, err);
}

function runStep(
  name: string,
  cmdDef: Cmd,
  executor: $Base = $,
) {
  const { cmd, errChannel } = cmdDef;

  const reporter = errorReporter(name, errChannel, executor);

  return shellTask(cmd).inspectErr(reporter);
}

function errorReporter(
  name: string,
  errChannel: ErrorChannel,
  executor: $Base,
) {
  switch (errChannel) {
    case "none":
      return (_res: CommandResult) => {};
    case "both":
      return (res: CommandResult) => {
        executor.logError(name, res.stderr);
        executor.logError(name, res.stdout);
      };
    case "stderr":
      return (res: CommandResult) => {
        executor.logError(name, res.stderr);
      };
    case "stdout":
      return (res: CommandResult) => {
        executor.logError(name, res.stdout);
      };
    default:
      throw new SyntaxError(`value ${errChannel} is not a valid error channel`);
  }
}

function terminate(cmdRes: CommandResult) {
  Deno.exit(cmdRes.code);
}

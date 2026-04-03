import * as dax from "@david/dax";
import type { CommandBuilder, CommandResult } from "@david/dax";
import { Err, Ok, Task } from "@aedge-io/grugway";
export type {
  MultiSelectOptions,
  ProgressBar,
  ProgressOptions,
  PromptOptions,
  SelectOptions,
  ShellOption,
  ShellPipeReaderKind,
  ShellPipeWriterKind,
} from "@david/dax";
export { CommandBuilder, CommandResult, Path } from "@david/dax";

const killController = new dax.KillController();
const defaultSignals: Deno.Signal[] = ["SIGINT", "SIGTERM"] as const;

function hookFor(sig: Deno.Signal) {
  return () => {
    $.logWarn(`Received ${sig}. Exiting...`);
    $.killAll();
    Deno.exit(0);
  };
}

function enableShutdownHooks(signals: Deno.Signal[] = defaultSignals) {
  signals.forEach((sig) => Deno.addSignalListener(sig, hookFor(sig)));
}

export type $Base = typeof dax.$;

const $template = dax.build$({
  commandBuilder: (builder) => {
    return builder.signal(killController.signal)
      .registerCommand(
        "dry-run",
        async (_ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { code: 0 };
        },
      );
  },
  extras: {
    enableShutdownHooks,
    killAll: () => killController.kill(),
  },
});

export const $ = $template.build$({
  extras: {
    withLogPrefix: (
      prefix: string,
    ) => {
      return $template.build$({
        extras: {
          log: (...args: Parameters<typeof dax.$.log>): void => {
            dax.$.log(prefix, ...args);
          },
          logLight: (...args: Parameters<typeof dax.$.log>): void => {
            dax.$.logLight(prefix, ...args);
          },
          logStep: (...args: Parameters<typeof dax.$.log>): void => {
            dax.$.logStep(prefix, ...args);
          },
          logWarn: (...args: Parameters<typeof dax.$.log>): void => {
            dax.$.logWarn(prefix, ...args);
          },
          logError: (...args: Parameters<typeof dax.$.log>): void => {
            dax.$.logError(prefix, ...args);
          },
        },
      });
    },
  },
});

export function shellTask(
  cmd: CommandBuilder,
): Task<CommandResult, CommandResult> {
  return Task.of(
    cmd.noThrow().stdout("piped").stderr("piped").then(
      (cmdResult) => {
        if (cmdResult.code !== 0) return Err(cmdResult);
        return Ok(cmdResult);
      },
    ),
  );
}

export function interactiveShellTask(
  cmd: CommandBuilder,
): Task<CommandResult, CommandResult> {
  return Task.of(
    cmd.noThrow().stdin("inherit").stdout("inherit").stderr("inherit").then(
      (cmdResult) => {
        if (cmdResult.code !== 0) return Err(cmdResult);
        return Ok(cmdResult);
      },
    ),
  );
}

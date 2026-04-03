import { Err, Ok, Option, Result } from "@aedge-io/grugway";
import * as semver from "@std/semver";

export type SemVer = semver.SemVer;

export const format = semver.format;

export const increment = semver.increment;

export const equals = semver.equals;

/**
 * {@linkcode semver.parse}
 */
export const tryParse = Result.liftFallible(
  semver.parse,
  (e: unknown) => e as TypeError,
);

export function versionsMatch(
  v1: SemVer,
  v2: SemVer,
): Result<SemVer, Error> {
  return semver.equals(v1, v2) ? Ok(v1) : Err(noMatch(v1, v2));
}

export function parse(v?: string): Result<SemVer, TypeError> {
  return Option.fromCoercible(v)
    .okOr(noInput())
    .andThen(tryParse);
}

const noInput = () => TypeError("Expected version specifier, received none");

const noMatch = (expected: SemVer, provided: SemVer) =>
  TypeError(
    `Expected version ${format(expected)} - got ${format(provided)}`,
  );

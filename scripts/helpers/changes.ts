import type { Option } from "@aedge-io/grugway";
import { Result, unsafeCastTo } from "@aedge-io/grugway";
import type { Commit } from "project/git";
import { createIntegrityTag, updateIntegrityTag } from "project/integrity";
import type { Path } from "project/shell";
import type { SemVer } from "project/version";
import { format } from "project/version";

/*
 **************************************************************************
 * change file template utilities
 **************************************************************************
 */

export type ChangeFileOptions = {
  repo: URL;
  title: Option<string>;
  lastTag: Option<SemVer>;
  nextTag: SemVer;
  sha: string;
  defaultBranch: string;
  commits: Commit[];
};

const changeFileHeaders = {
  breaking: "### Breaking Changes",
  feats: "### Features",
  fixes: "### Fixes",
  others: "### Other Changes",
} as const;

type ChangeSection = keyof typeof changeFileHeaders;

export function generateChange(opts: ChangeFileOptions): string {
  const { repo, title, lastTag, nextTag, commits, sha } = opts;

  const compareSegment = lastTag.map((t) => `compare/${format(t)}..`).unwrapOr(
    "commits/",
  );
  const lTag = lastTag.map(format).toString();
  const nTag = format(nextTag);

  const { breaking, feats, fixes, others } = groupIntoSummaries(commits);

  return `## typed-clone ${nTag}${title.map((t) => ` - ${t}`)}

${changeFileHeaders.breaking}

${toMdList(breaking)}

${changeFileHeaders.feats}

${toMdList(feats)}

---

${changeFileHeaders.fixes}

${toMdList(fixes)}

${changeFileHeaders.others}

${toMdList(others)}

---

**Full Changelog**: [${lTag}..${nTag}](${repo}/${compareSegment}${nTag})
${createIntegrityTag({ version: format(nextTag), sha })}`;
}

export const updateChange = Result.liftFallible(
  internalUpdateChange,
  unsafeCastTo<Error>,
);

/**
 * @throws Error
 */
function internalUpdateChange(
  content: string,
  opts: ChangeFileOptions,
): string {
  const headers = Object.keys(changeFileHeaders) as ChangeSection[];
  const summaries = groupIntoSummaries(opts.commits);

  let updated = content;
  for (const header of headers) {
    updated = updateSection(
      updated,
      changeFileHeaders[header],
      summaries[header],
    );
  }

  const tagged = updateIntegrityTag(updated, {
    version: format(opts.nextTag),
    sha: opts.sha,
  });

  return tagged;
}

/**
 * @throws Error
 */
function updateSection(
  content: string,
  header: string,
  summaries: string[],
): string {
  const headerStart = content.indexOf(header);
  const headerEnd = headerStart + header.length;

  if (headerStart === -1) {
    throw Error(`cannot locate section for "${header}"`);
  }

  const nextSectionStart = Math.min(
    (content.indexOf("## ", headerEnd) + content.length) % content.length,
    (content.indexOf("### ", headerEnd) + content.length) % content.length,
    (content.indexOf("---", headerEnd) + content.length) % content.length,
  );

  const listStart = content.indexOf("\n- ", headerEnd) + 1;

  /* implicitly also handles eof case */
  const noListInSection = listStart === 0 || listStart >= nextSectionStart;
  if (noListInSection) {
    return content;
  }

  const listEnd = content.indexOf("\n\n", listStart);

  const before = content.slice(0, listStart);
  const after = content.slice(listEnd + 1);

  return `${before}${toMdList(summaries)}${after}`;
}

/*
 **************************************************************************
 * changelog template utilities
 **************************************************************************
 */

export type ChangelogOptions = {
  next: SemVer;
  commits: Commit[];
  change: Path;
  changelog: Path;
  sha: string;
  title: Option<string>;
};

const changelogHeaders = {
  title: "# Changelog",
  unreleased: "## Unreleased",
} as const;

export function generateChangelog(opts: ChangelogOptions): string {
  const { next, sha } = opts;

  return `${changelogHeaders.title}

${changelogHeaders.unreleased}

${changelogEntry(opts)}
${createIntegrityTag({ version: format(next), sha })}
`;
}

export const updateChangelog = Result.liftFallible(
  internalUpdateChangelog,
  unsafeCastTo<Error>,
);

function changelogEntry(opts: ChangelogOptions, manualHighlights = "") {
  const { next, title, commits, changelog, change } = opts;
  return `${releaseHeader(next, title)}

${releaseHighlights(commits, manualHighlights)}

${releaseOverview(changelog, change)}
`;
}

function releaseHeader(ver: SemVer, title: Option<string>) {
  return `## ${format(ver)}${title.map((t) => ` - ${t}`)}`;
}

function releaseOverview(changelog: Path, change: Path) {
  return `[-> Release overview](${changelog.parent()?.relative(change)})`;
}

function releaseHighlights(cm: Commit[], pre = "") {
  return `${pre}${toMdList(cm.map(toHighlight))}`;
}

/**
 * @param content - assumed to have an integrity tag
 * @throws
 */
function internalUpdateChangelog(
  content: string,
  opts: ChangelogOptions,
): string {
  const { next, sha } = opts;

  const END = content.length - 1;

  const headerStart = content.indexOf(changelogHeaders.unreleased);
  const headerEnd = headerStart + changelogHeaders.unreleased.length + 1;

  if (headerStart === -1) {
    throw Error("cannot locate 'Unreleased' header in changelog");
  }

  const nextSectionStart = Math.min(
    (content.indexOf("## ", headerEnd) + content.length) % content.length,
    (content.indexOf("### ", headerEnd) + content.length) % content.length,
    (content.indexOf("---", headerEnd) + content.length) % content.length,
  );

  const listStart = content.indexOf("\n- ", headerEnd) + 1;
  const listEnd = content.indexOf("\n\n", listStart);

  const manualHighlightsExist =
    !(listStart === 0 || listStart >= nextSectionStart);
  const nextSectionExists = nextSectionStart !== END;

  const manuallyAddedHighlights = manualHighlightsExist
    ? content.slice(listStart, listEnd + 1)
    : "";

  const toBeInserted = `\n${changelogEntry(opts, manuallyAddedHighlights)}\n`;

  const cutoff = nextSectionExists
    ? nextSectionStart
    : manualHighlightsExist
    ? (listEnd + 1)
    : headerEnd;

  const before = content.slice(0, headerEnd);
  const after = content.slice(cutoff);

  const updated = `${before}${toBeInserted}${after}`;

  const tagged = updateIntegrityTag(updated, {
    version: format(next),
    sha: sha,
  });

  return tagged;
}

/*
 **************************************************************************
 * commit summaries
 **************************************************************************
 */

type SummaryGroup = Record<ChangeSection, string[]>;

function groupIntoSummaries(commits: Commit[]): SummaryGroup {
  const summaries = commits.map(toSummaryLine);
  const breaking = [];
  const feats = [];
  const fixes = [];
  const others = [];

  for (const summary of summaries) {
    if (summary.includes("BREAKING")) {
      breaking.push(summary);
      continue;
    }

    if (summary.startsWith("feat")) {
      feats.push(summary);
      continue;
    }

    if (summary.startsWith("fix")) {
      fixes.push(summary);
      continue;
    }

    others.push(summary);
  }

  return { breaking, feats, fixes, others };
}

/*
 **************************************************************************
 * fmt and list utilities
 **************************************************************************
 */

function toSummaryLine(c: Commit): string {
  // deno-fmt-ignore
  return `${c.summary} ([${c.sha.slice(0, 7)}](${c.url}) by [@${c.author}](${c.authorUrl}))`;
}

function toMdList(list: string[]) {
  return list.map((line) => `- ${line}`).join("\n");
}

function toHighlight(c: Commit): string {
  const startOfMsg = c.summary.indexOf(":") + 1;
  const highlight = c.summary.slice(startOfMsg).trim();
  const capitalized = `${highlight[0].toUpperCase()}${highlight.slice(1)}`;

  return capitalized;
}

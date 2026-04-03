import { Option } from "@aedge-io/grugway";

const MARKER = "release-metadata:";
const MD_MARK_START = "<!--";
const MD_MARK_END = "-->";

const MD_INTEGRITY_MATCHER = /<!--\s*release-metadata:\s*(\{.*?\})\s*-->/;

type IntegrityMetadata = {
  version: string;
  sha: string;
};

export function createIntegrityTag(meta: IntegrityMetadata): string {
  return `${MD_MARK_START} ${MARKER} ${JSON.stringify(meta)} ${MD_MARK_END}`;
}

const parse = Option.liftFallible(JSON.parse);

export function extractIntegrityMetadata(
  tagged: string,
): Option<IntegrityMetadata> {
  return Option(tagged.match(MD_INTEGRITY_MATCHER))
    .andThen((match) => parse(match[1]));
}

export function removeIntegrityTag(tagged: string): string {
  return tagged.replaceAll(MD_INTEGRITY_MATCHER, "").trim();
}

export function updateIntegrityTag(
  tagged: string,
  meta: IntegrityMetadata,
): string {
  return tagged.replace(MD_INTEGRITY_MATCHER, createIntegrityTag(meta));
}

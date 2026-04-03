import { clone, type CloneOptions } from "@aedge-io/typed-clone";
import rfdc from "rfdc";

const rfdcClone = rfdc();
const rfdcCircularClone = rfdc({ circles: true });
const cloneOpts: CloneOptions = {
  depth: 32,
};
const noPreserveOpts: CloneOptions = {
  ...cloneOpts,
  preserveRefs: false,
};

/*
 ********************************************************************
 * clone implementations
 ********************************************************************
 */

export type Impl = (data: unknown) => unknown;

export const IMPLS: Record<string, Impl> = {
  "struct'dClone": (d) => structuredClone(d),
  "clone(cache)": (d) => clone(d, cloneOpts),
  "clone": (d) => clone(d, noPreserveOpts),
  "rfdc(cache)": (d) => rfdcCircularClone(d),
  "rfdc": (d) => rfdcClone(d),
};

/*
 ********************************************************************
 * simplistic size model
 ********************************************************************
 *
 * SHOULD be implementation independent: the floor that any clone must allocate
 * before engine-specific overhead.
 */

const PTR = 8;
const F64 = 8; /* no SMI */
const BOOL = 1;
const CHAR = 2; /* UTF-16 */

/**
 * count the bytes of `value`.
 *
 * Shared/circular references are counted once
 */
export function sizeOf(value: unknown): number {
  return countBytes(value, new WeakSet());
}

function countBytes(value: unknown, cache: WeakSet<object>): number {
  if (value === null || value === undefined) return 0;

  switch (typeof value) {
    case "number":
      return F64;
    case "bigint":
      return bigintDigitBytes(value);
    case "boolean":
      return BOOL;
    case "string":
      return PTR + (value.length * CHAR);
    case "symbol":
      return PTR;
    case "function":
      return PTR;
  }

  const obj = value as object;
  if (cache.has(obj)) return PTR;
  cache.add(obj);

  if (Array.isArray(obj)) {
    let bytes = 0;
    for (let i = 0; i < obj.length; i++) {
      bytes += PTR + countBytes(obj[i], cache);
    }
    return bytes;
  }

  if (obj instanceof Map) {
    let bytes = 0;
    for (const [k, v] of obj) {
      bytes += PTR + countBytes(k, cache) + PTR + countBytes(v, cache);
    }
    return bytes;
  }

  if (obj instanceof Set) {
    let bytes = 0;
    for (const v of obj) {
      bytes += PTR + countBytes(v, cache);
    }
    return bytes;
  }

  let bytes = 0;
  for (const key in obj) {
    bytes += key.length * CHAR + PTR + countBytes(
      (obj as Record<string, unknown>)[key],
      cache,
    );
  }
  return bytes;
}

/**
 * LLM generated
 *
 * Minimum bytes to store a BigInt value in 64-bit digit words.
 *
 * `0n` → 0 bytes, otherwise ⌈bitLength(|n|) / 64⌉ × 8.
 */
function bigintDigitBytes(n: bigint): number {
  if (n === 0n) return 0;
  let abs = n < 0n ? -n : n;
  let words = 0;
  while (abs > 0n) {
    abs >>= 64n;
    words++;
  }
  return words * F64;
}

/*
 ********************************************************************
 * fixtures — [label, data, contentBytes]
 ********************************************************************
 */

function fixture(
  label: string,
  data: unknown,
): [string, unknown, number] {
  return [label, data, sizeOf(data)];
}

export const FIXTURES: [string, unknown, number][] = [
  fixture("Plain record (8 keys)", makeWideRecord(8)),
  fixture("Plain record (16 keys)", makeWideRecord(16)),
  fixture("Plain record (64 keys)", makeWideRecord(64)),
  fixture("Plain record (128 keys)", makeWideRecord(128)),
  fixture("Plain record (256 keys)", makeWideRecord(256)),
  fixture("Plain record (512 keys)", makeWideRecord(512)),

  fixture("Nested records (depth=4, 16 leaves)", makeNestedRecord(4)),
  fixture("Nested records (depth=8, 256 leaves)", makeNestedRecord(8)),
  fixture("Nested records (depth=12, 4096 leaves)", makeNestedRecord(12)),
  fixture("Nested records (depth=16, 65536 leaves)", makeNestedRecord(16)),

  fixture("Array<primitive> (n=64)", makePrimitiveArray(64)),
  fixture("Array<primitive> (n=256)", makePrimitiveArray(256)),
  fixture("Array<primitive> (n=1024)", makePrimitiveArray(1024)),
  fixture("Array<primitive> (n=8192)", makePrimitiveArray(8192)),
  fixture("Array<primitive> (n=65536)", makePrimitiveArray(65_536)),

  fixture("Array<string/8> (n=256)", makeStringArray(256, 8)),
  fixture("Array<string/8> (n=1024)", makeStringArray(1024, 8)),
  fixture("Array<string/8> (n=8192)", makeStringArray(8192, 8)),
  fixture("Array<string/8> (n=65536)", makeStringArray(65_536, 8)),

  fixture("Array<string/1K> (n=256)", makeStringArray(256, 1024)),
  fixture("Array<string/1K> (n=1024)", makeStringArray(1024, 1024)),
  fixture("Array<string/1K> (n=8192)", makeStringArray(8192, 1024)),

  fixture("Array<record> (n=64)", makeRecords(64)),
  fixture("Array<record> (n=256)", makeRecords(256)),
  fixture("Array<record> (n=1024)", makeRecords(1024)),
  fixture("Array<record> (n=8192)", makeRecords(8192)),
  fixture("Array<record> (n=65536)", makeRecords(65_536)),

  fixture("Nested arrays (depth=4, 16 leaves)", makeNestedArrays(4)),
  fixture("Nested arrays (depth=8, 256 leaves)", makeNestedArrays(8)),
  fixture("Nested arrays (depth=12, 4096 leaves)", makeNestedArrays(12)),
  fixture("Nested arrays (depth=16, 65536 leaves)", makeNestedArrays(16)),

  fixture("Map<string,number> (n=64)", makePrimitiveMap(64)),
  fixture("Map<string,number> (n=256)", makePrimitiveMap(256)),
  fixture("Map<string,number> (n=1024)", makePrimitiveMap(1024)),
  fixture("Map<string,number> (n=8192)", makePrimitiveMap(8192)),

  fixture("Map<string,record> (n=64)", makeRecordMap(64)),
  fixture("Map<string,record> (n=256)", makeRecordMap(256)),
  fixture("Map<string,record> (n=1024)", makeRecordMap(1024)),
  fixture("Map<string,record> (n=8192)", makeRecordMap(8192)),

  fixture("Set<number> (n=256)", makePrimitiveSet(256)),
  fixture("Set<number> (n=1024)", makePrimitiveSet(1024)),
  fixture("Set<number> (n=8192)", makePrimitiveSet(8192)),
  fixture("Set<number> (n=65536)", makePrimitiveSet(65_536)),

  fixture("Set<record> (n=256)", makeRecordSet(256)),
  fixture("Set<record> (n=1024)", makeRecordSet(1024)),
  fixture("Set<record> (n=8192)", makeRecordSet(8192)),
  fixture("Set<record> (n=65536)", makeRecordSet(65_536)),

  fixture("Real: JSON Schema (8 props)", makeJsonSchema(8)),
  fixture("Real: JSON Schema (32 props)", makeJsonSchema(32)),
  fixture("Real: JSON Schema (128 props)", makeJsonSchema(128)),

  fixture("Real: Single API resource", makeApiResource()),

  fixture("Real: API collection (8 items)", makeApiCollection(8)),
  fixture("Real: API collection (32 items)", makeApiCollection(32)),
  fixture("Real: API collection (64 items)", makeApiCollection(64)),

  fixture("Real: Frontend state slice", makeFrontendState()),

  fixture("Real: Normalized store (64 entities)", makeNormalizedStore(64)),
  fixture("Real: Normalized store (256 entities)", makeNormalizedStore(256)),
  fixture("Real: Normalized store (512 entities)", makeNormalizedStore(512)),

  fixture("Real: Agent session (8 turns)", makeAgentSession(8)),
  fixture("Real: Agent session (32 turns)", makeAgentSession(32)),
  fixture("Real: Agent session (64 turns)", makeAgentSession(64)),

  fixture("Real: Dashboard data (1K rows)", makeDashboardData(1024)),
  fixture("Real: Dashboard data (8K rows)", makeDashboardData(8192)),
  fixture("Real: Dashboard data (64K rows)", makeDashboardData(65_536)),
];

/*
 ********************************************************************
 * builders — return [data, contentBytes]
 ********************************************************************
 */

function makeSimpleRecord(
  n: number,
) {
  return {
    id: Math.floor(Math.random() * 10_000_000),
    since: Temporal.Now.instant().epochNanoseconds,
    name: `User-${n}`,
  };
}

function makeWideRecord(n: number): Record<string, string> {
  const entries: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    entries.push([`key${i}`, `value-${i}`]);
  }
  return Object.fromEntries(entries);
}

function makeNestedRecord(depth: number): unknown {
  if (depth === 0) {
    return { leaf: true, ts: Temporal.Now.instant().epochNanoseconds };
  }
  return {
    leaf: false,
    left: makeNestedRecord(depth - 1),
    right: makeNestedRecord(depth - 1),
  };
}

function makeRecords(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => makeSimpleRecord(i));
}

function makeNestedArrays(depth: number): unknown {
  if (depth === 0) {
    return { leaf: true, ts: Temporal.Now.instant().epochNanoseconds };
  }
  return [makeNestedArrays(depth - 1), makeNestedArrays(depth - 1)];
}

function makeStringArray(n: number, len: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `${"x".repeat(len - String(i).length)}${i}`,
  );
}

function makePrimitiveArray(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function makePrimitiveMap(n: number): Map<string, number> {
  return new Map(
    Array.from({ length: n }, (_, i) => [`k${i}`, i] as [string, number]),
  );
}

function makeRecordMap(
  n: number,
): Map<string, { id: number; since: bigint; name: string }> {
  return new Map(
    Array.from(
      { length: n },
      (_, i) => [`user${i}`, makeSimpleRecord(i)] as const,
    ),
  );
}

function makePrimitiveSet(n: number): Set<number> {
  return new Set(Array.from({ length: n }, (_, i) => i));
}

function makeRecordSet(
  n: number,
): Set<{ id: number; since: bigint; name: string }> {
  return new Set(Array.from({ length: n }, (_, i) => makeSimpleRecord(i)));
}

/*
 ********************************************************************
 * real-world builders
 ********************************************************************
 * LLM GENERATED
 *
 * Derived from research on actual deep-clone usage in the wild:
 *
 *  1. JSON Schema / Config  — Fastify clones route schemas at startup
 *  2. Single API resource   — GitHub/Stripe-style single-object response
 *  3. Collection page       — paginated array of nested records
 *  4. Frontend state slice  — shallow UI/session state (high-frequency)
 *  5. Normalized entity     — flat lookup of small records (Redux-style)
 *  6. Agent Session         - Array of records with prompts and tool_calls
 *  7. Dashboard Data        - SoA, columnar data of primitives
 */

/**
 * 1. JSON Schema — Fastify's actual rfdc workload.
 *
 * Nested plain records, 3-5 levels, 5-15 keys/level, all string leaves.
 * ~20-80 total objects, no Maps/Sets/Dates.
 */
function makeJsonSchema(properties: number) {
  const props: Record<string, unknown> = {};
  for (let i = 0; i < properties; i++) {
    if (i % 5 === 0) {
      // nested object property (every 5th)
      const nested: Record<string, unknown> = {};
      for (let j = 0; j < 5; j++) {
        nested[`field_${j}`] = { type: "string", minLength: 1, maxLength: 255 };
      }
      props[`prop_${i}`] = {
        type: "object",
        properties: nested,
        required: [`field_0`, `field_1`],
      };
    } else if (i % 7 === 0) {
      // array property
      props[`prop_${i}`] = {
        type: "array",
        items: { type: "string", format: "email" },
        minItems: 0,
        maxItems: 100,
      };
    } else {
      // scalar property
      props[`prop_${i}`] = {
        type: i % 3 === 0 ? "integer" : "string",
        ...(i % 3 === 0
          ? { minimum: 0, maximum: 1_000_000 }
          : { minLength: 0, maxLength: 255 }),
      };
    }
  }
  return {
    $id: "https://example.com/schemas/resource.json",
    type: "object" as const,
    properties: props,
    required: Object.keys(props).slice(0, Math.ceil(properties / 2)),
    additionalProperties: false,
  };
}

/**
 * 2. Single API resource — wide flat record, 2-4 small nested objects.
 *
 * Modelled after GitHub /repos/:owner/:repo (84 keys, 3 nested objects)
 * and Stripe PaymentIntent (~40 keys, 3-5 nested).
 */
function makeApiResource() {
  return {
    id: 123456789867,
    node_id: "MDEw56dfVsgraedV==",
    name: "clone-lib",
    full_name: "someGitHubUser/clone-lib",
    private: false,
    description: "some descriptive text about what this thing does",
    fork: false,
    url: "https://api.github.com/repos/someGitHubUser/clone-lib",
    html_url: "https://github.com/someGitHubUser/clone-lib",
    archive_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/{archive_format}{/ref}",
    assignees_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/assignees{/user}",
    blobs_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/git/blobs{/sha}",
    branches_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/branches{/branch}",
    collaborators_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/collaborators{/collaborator}",
    comments_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/comments{/number}",
    commits_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/commits{/sha}",
    compare_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/compare/{base}...{head}",
    contents_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/contents/{+path}",
    contributors_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/contributors",
    deployments_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/deployments",
    downloads_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/downloads",
    events_url: "https://api.github.com/repos/someGitHubUser/clone-lib/events",
    forks_url: "https://api.github.com/repos/someGitHubUser/clone-lib/forks",
    git_commits_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/git/commits{/sha}",
    git_refs_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/git/refs{/sha}",
    git_tags_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/git/tags{/sha}",
    hooks_url: "https://api.github.com/repos/someGitHubUser/clone-lib/hooks",
    issue_comment_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/issues/comments{/number}",
    issue_events_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/issues/events{/number}",
    issues_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/issues{/number}",
    keys_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/keys{/key_id}",
    labels_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/labels{/name}",
    languages_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/languages",
    merges_url: "https://api.github.com/repos/someGitHubUser/clone-lib/merges",
    milestones_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/milestones{/number}",
    notifications_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/notifications{?since,all,participating}",
    pulls_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/pulls{/number}",
    releases_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/releases{/id}",
    stargazers_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/stargazers",
    statuses_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/statuses/{sha}",
    subscribers_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/subscribers",
    subscription_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/subscription",
    tags_url: "https://api.github.com/repos/someGitHubUser/clone-lib/tags",
    teams_url: "https://api.github.com/repos/someGitHubUser/clone-lib/teams",
    trees_url:
      "https://api.github.com/repos/someGitHubUser/clone-lib/git/trees{/sha}",
    created_at: "2011-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    pushed_at: "2026-01-01T00:00:00Z",
    homepage: null,
    size: 142,
    stargazers_count: 686,
    watchers_count: 686,
    language: "JavaScript",
    has_issues: true,
    has_projects: true,
    has_downloads: true,
    has_wiki: true,
    has_pages: false,
    has_discussions: false,
    forks_count: 38,
    archived: false,
    disabled: false,
    open_issues_count: 7,
    allow_forking: true,
    is_template: false,
    visibility: "public",
    default_branch: "master",
    network_count: 38,
    subscribers_count: 8,
    topics: ["clone", "deep-clone", "fast", "javascript"],
    owner: {
      login: "someGitHubUser",
      id: 210101010,
      node_id: "M=======cj==adsfsdf=",
      avatar_url: "https://avatars.githubusercontent.com/u/210101010?v=4",
      gravatar_id: "",
      url: "https://api.github.com/users/someGitHubUser",
      html_url: "https://github.com/someGitHubUser",
      followers_url: "https://api.github.com/users/someGitHubUser/followers",
      following_url:
        "https://api.github.com/users/someGitHubUser/following{/other_user}",
      gists_url: "https://api.github.com/users/someGitHubUser/gists{/gist_id}",
      starred_url:
        "https://api.github.com/users/someGitHubUser/starred{/owner}{/repo}",
      subscriptions_url:
        "https://api.github.com/users/someGitHubUser/subscriptions",
      organizations_url: "https://api.github.com/users/someGitHubUser/orgs",
      repos_url: "https://api.github.com/users/someGitHubUser/repos",
      events_url:
        "https://api.github.com/users/someGitHubUser/events{/privacy}",
      received_events_url:
        "https://api.github.com/users/someGitHubUser/received_events",
      type: "User",
      site_admin: false,
    },
    license: {
      key: "mit",
      name: "MIT License",
      spdx_id: "MIT",
      url: "https://api.github.com/licenses/mit",
      node_id: "sadf9ersdkdsfw4f4ar",
    },
  };
}

/**
 * 3. Collection page — array of N nested records.
 *
 * Modelled after GitHub /issues (32 keys/item, 5 nested sub-objects).
 * Typical page size: 20-50 items.
 */
function makeApiCollection(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: 1_000_000 + i,
    node_id: `MDExOklzc3VlMTAwMDAw${i}`,
    url: `https://api.github.com/repos/fastify/fastify/issues/${1000 + i}`,
    html_url: `https://github.com/fastify/fastify/issues/${1000 + i}`,
    number: 1000 + i,
    title: `Fix edge case in route handler for scenario ${i}`,
    state: i % 3 === 0 ? "closed" : "open",
    locked: false,
    comments: Math.floor(Math.random() * 20),
    created_at: "2024-09-15T08:30:00Z",
    updated_at: "2024-11-20T14:22:00Z",
    closed_at: i % 3 === 0 ? "2024-10-01T12:00:00Z" : null,
    author_association: "CONTRIBUTOR",
    body: `This PR addresses the edge case where ${
      "x".repeat(80)
    } happens during request handling. Steps to reproduce: ${"y".repeat(120)}`,
    timeline_url: `https://api.github.com/repos/fastify/fastify/issues/${
      1000 + i
    }/timeline`,
    state_reason: i % 3 === 0 ? "completed" : null,
    draft: false,
    user: {
      login: `contributor-${i}`,
      id: 2_000_000 + i,
      node_id: `MDQ6VXNlcjIwMDAwMDA${i}`,
      avatar_url: `https://avatars.githubusercontent.com/u/${
        2_000_000 + i
      }?v=4`,
      gravatar_id: "",
      url: `https://api.github.com/users/contributor-${i}`,
      html_url: `https://github.com/contributor-${i}`,
      followers_url: `https://api.github.com/users/contributor-${i}/followers`,
      following_url:
        `https://api.github.com/users/contributor-${i}/following{/other_user}`,
      gists_url:
        `https://api.github.com/users/contributor-${i}/gists{/gist_id}`,
      starred_url:
        `https://api.github.com/users/contributor-${i}/starred{/owner}{/repo}`,
      subscriptions_url:
        `https://api.github.com/users/contributor-${i}/subscriptions`,
      organizations_url: `https://api.github.com/users/contributor-${i}/orgs`,
      repos_url: `https://api.github.com/users/contributor-${i}/repos`,
      events_url:
        `https://api.github.com/users/contributor-${i}/events{/privacy}`,
      received_events_url:
        `https://api.github.com/users/contributor-${i}/received_events`,
      type: "User",
      site_admin: false,
    },
    labels: [
      {
        id: 3_000_000 + i,
        node_id: `MDU6TGFiZWwzMDAwMDAw${i}`,
        url: `https://api.github.com/repos/fastify/fastify/labels/bug`,
        name: i % 2 === 0 ? "bug" : "enhancement",
        color: i % 2 === 0 ? "d73a4a" : "a2eeef",
        default: i % 2 === 0,
        description: i % 2 === 0
          ? "Something isn't working"
          : "New feature or request",
      },
      {
        id: 3_100_000 + i,
        node_id: `MDU6TGFiZWwzMTAwMDAw${i}`,
        url: `https://api.github.com/repos/fastify/fastify/labels/priority`,
        name: "priority: medium",
        color: "fbca04",
        default: false,
        description: "Medium priority issue",
      },
    ],
    reactions: {
      url: `https://api.github.com/repos/fastify/fastify/issues/${
        1000 + i
      }/reactions`,
      total_count: i % 5,
      "+1": i % 5,
      "-1": 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
    pull_request: {
      url: `https://api.github.com/repos/fastify/fastify/pulls/${1000 + i}`,
      html_url: `https://github.com/fastify/fastify/pull/${1000 + i}`,
      diff_url: `https://github.com/fastify/fastify/pull/${1000 + i}.diff`,
      patch_url: `https://github.com/fastify/fastify/pull/${1000 + i}.patch`,
      merged_at: null,
    },
  }));
}

/**
 * 4. Frontend state slice — shallow record of primitives + 1-2 nested.
 *
 * Modelled after typical React/Vue component or page-level state.
 * Small, cloned on every state transition (high frequency).
 */
function makeFrontendState() {
  return {
    currentView: "PRODUCTS_VIEW",
    sidebarOpen: true,
    modalType: null as string | null,
    searchQuery: "",
    sortField: "created_at",
    sortDirection: "desc",
    page: 1,
    perPage: 25,
    totalItems: 1842,
    isLoading: false,
    lastFetchedAt: "2024-11-20T14:22:00Z",
    errorMessage: null as string | null,
    selectedIds: [101, 204, 307, 412, 518],
    filters: {
      status: "active",
      category: "electronics",
      priceMin: 10,
      priceMax: 500,
      inStock: true,
      rating: 4,
    },
    user: {
      id: 42,
      name: "Jane Doe",
      email: "jane@example.com",
      role: "admin",
      avatarUrl: "https://cdn.example.com/avatars/42.jpg",
    },
  };
}

/**
 * 5. Normalized entity store — flat lookup of small records.
 *
 * Modelled after Redux Toolkit / Apollo normalized cache.
 * Record<id, entity> where each entity is 5-10 primitive keys.
 */
function makeNormalizedStore(entities: number) {
  const users: Record<string, unknown> = {};
  const posts: Record<string, unknown> = {};
  const comments: Record<string, unknown> = {};

  const nUsers = Math.max(1, Math.floor(entities / 10));
  const nPosts = Math.max(1, Math.floor(entities / 3));
  const nComments = entities - nUsers - nPosts;

  for (let i = 0; i < nUsers; i++) {
    users[`u${i}`] = {
      id: `u${i}`,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      role: i % 5 === 0 ? "admin" : "member",
      createdAt: "2024-01-15T08:00:00Z",
      avatarUrl: `https://cdn.example.com/avatars/u${i}.jpg`,
      postCount: Math.floor(Math.random() * 50),
      karma: Math.floor(Math.random() * 10000),
    };
  }

  for (let i = 0; i < nPosts; i++) {
    posts[`p${i}`] = {
      id: `p${i}`,
      authorId: `u${i % nUsers}`,
      title: `Post title number ${i} about interesting topics`,
      slug: `post-title-number-${i}`,
      status: i % 4 === 0 ? "draft" : "published",
      commentCount: Math.floor(Math.random() * 30),
      likeCount: Math.floor(Math.random() * 200),
      createdAt: "2024-06-10T12:00:00Z",
      updatedAt: "2024-11-01T09:30:00Z",
    };
  }

  for (let i = 0; i < nComments; i++) {
    comments[`c${i}`] = {
      id: `c${i}`,
      postId: `p${i % nPosts}`,
      authorId: `u${i % nUsers}`,
      body: `This is comment ${i} with some text content here.`,
      likeCount: Math.floor(Math.random() * 50),
      createdAt: "2024-08-20T16:45:00Z",
    };
  }

  return {
    entities: { users, posts, comments },
    ids: {
      users: Object.keys(users),
      posts: Object.keys(posts),
      comments: Object.keys(comments),
    },
  };
}

/**
 * 6. LLM agent session — conversation history with tool calls.
 *
 * Modelled after OpenAI Chat Completions / Anthropic Messages format
 * as used by coding agents (Claude Code, Cursor, Aider, pi, etc.).
 *
 * Shape:  Array of message objects, each with role + content.
 *         Assistant messages carry tool_calls arrays.
 *         Tool messages carry large string results (file contents,
 *         command output).
 *
 * nTurns = number of user→assistant round-trips.
 * Each turn: 1 user msg + 1 assistant msg (with 1-3 tool calls)
 *            + 1-3 tool result msgs.
 */
function makeAgentSession(turns: number) {
  const systemPrompt = [
    "You are a clanker, an expert in clankering.",
    "You help users by reading files, executing commands, editing code, and writing new files.",
    "",
    "Available tools:",
    "- read: Read file contents (supports text and images)",
    "- bash: Execute bash commands (ls, grep, find, etc.)",
    "- edit: Make surgical edits to files (find exact text and replace)",
    "- write: Create or overwrite files",
    "",
    "Guidelines:",
    "- Use bash for file operations like ls, rg, find",
    "- Use read to examine files before editing",
    "- Use edit for precise changes (old text must match exactly)",
    "- Use write only for new files or complete rewrites",
    "- Be concise in your responses",
    "",
    `Current date: ${new Date().toISOString().slice(0, 10)}`,
    `Current working directory: /Users/dev/project`,
  ].join("\n");

  /* ---- representative tool-result payloads ---- */

  const fileContents = [
    // ~2 KB TypeScript file
    Array.from(
      { length: 60 },
      (_, i) =>
        `export function handler${i}(req: Request): Response { return new Response("ok ${i}"); }`,
    ).join("\n"),
    // ~4 KB package.json style
    JSON.stringify(
      {
        name: "@example/project",
        version: "2.1.0",
        dependencies: Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`dep-${i}`, `^${i}.0.0`]),
        ),
        devDependencies: Object.fromEntries(
          Array.from({ length: 25 }, (_, i) => [`dev-dep-${i}`, `^${i}.0.0`]),
        ),
        scripts: Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [
            `script-${i}`,
            `node run-${i}.js`,
          ]),
        ),
      },
      null,
      2,
    ),
    // ~3 KB test output
    Array.from(
      { length: 50 },
      (_, i) =>
        `  ${i % 7 === 0 ? "✗ FAIL" : "✓ PASS"} test case ${i}: ${
          "x".repeat(40)
        } (${Math.floor(Math.random() * 200)}ms)`,
    ).join("\n")
    + "\n\n50 tests, 43 passed, 7 failed\nTime: 3.142s",
    // ~1.5 KB grep output
    Array.from(
      { length: 30 },
      (_, i) =>
        `src/handlers/route${i}.ts:${
          10 + i
        }:  const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);`,
    ).join("\n"),
    // ~5 KB large source file
    Array.from(
      { length: 80 },
      (_, i) =>
        [
          `// Section ${i}`,
          `interface Model${i} {`,
          `  id: string;`,
          `  name: string;`,
          `  value: number;`,
          `  metadata: Record<string, unknown>;`,
          `}`,
          ``,
        ].join("\n"),
    ).join("\n"),
  ];

  const userPrompts = [
    "look at the project structure and tell me what this does",
    "find all the handlers that query the database",
    "the tests are failing, can you check what's wrong?",
    "fix the failing test in route handler 3",
    "now run the tests again to verify",
    "refactor the database calls to use a connection pool",
    "add error handling to all the route handlers",
    "update the package.json to add the new dependency",
    "write a migration script for the schema changes",
    "review the changes and make sure everything looks good",
    "can you add TypeScript strict mode to the config?",
    "check if there are any type errors after enabling strict",
    "fix the type errors in the handler files",
    "run the linter and fix any issues",
    "deploy this to staging and check the logs",
    "looks like there's a memory leak, investigate the connection pool",
    "add monitoring middleware that tracks request latency",
    "write integration tests for the new endpoints",
    "update the README with the new setup instructions",
    "do a final review of all changes before we merge",
  ];

  const messages: Record<string, unknown>[] = [];

  /* system message */
  messages.push({ role: "system", content: systemPrompt });

  for (let t = 0; t < turns; t++) {
    /* ---- user message ---- */
    messages.push({
      role: "user",
      content: userPrompts[t % userPrompts.length],
    });

    /* ---- assistant message with tool calls ---- */
    const nCalls = 1 + (t % 3); // 1, 2, or 3 tool calls per turn
    const toolCalls = Array.from({ length: nCalls }, (_, c) => {
      const toolIdx = (t * 3 + c) % 4;
      const tools = ["read", "bash", "edit", "write"];
      const toolName = tools[toolIdx];

      let args: Record<string, string>;
      switch (toolName) {
        case "read":
          args = { path: `src/handlers/route${t}.ts` };
          break;
        case "bash":
          args = { command: `grep -rn "TODO\\|FIXME" src/ --include="*.ts"` };
          break;
        case "edit":
          args = {
            path: `src/handlers/route${t}.ts`,
            oldText: `const result = await db.query("SELECT * FROM users");`,
            newText:
              `const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);`,
          };
          break;
        case "write":
          args = {
            path: `src/migrations/${t}_add_index.sql`,
            content:
              `CREATE INDEX CONCURRENTLY idx_users_email ON users (email);\nCREATE INDEX CONCURRENTLY idx_orders_user_id ON orders (user_id);`,
          };
          break;
        default:
          args = {};
      }

      return {
        id: `call_${t}_${c}_${
          (Math.random() * 1e12).toString(36).slice(0, 12)
        }`,
        type: "function",
        function: {
          name: toolName,
          arguments: JSON.stringify(args),
        },
      };
    });

    /* assistant thinking + tool invocations */
    messages.push({
      role: "assistant",
      content: t % 4 === 0
        ? null
        : `Let me ${
          ["check that", "look into this", "fix this", "investigate"][t % 4]
        } by examining the relevant files and running some commands.${
          t % 3 === 0
            ? " Based on what I've seen so far, the issue likely stems from the database connection handling."
            : ""
        }`,
      tool_calls: toolCalls,
    });

    /* ---- tool result messages ---- */
    for (let c = 0; c < nCalls; c++) {
      messages.push({
        role: "tool",
        tool_call_id: toolCalls[c].id,
        content: fileContents[(t * 3 + c) % fileContents.length],
      });
    }

    /* ---- assistant final response for this turn ---- */
    if (t % 2 === 0) {
      messages.push({
        role: "assistant",
        content: [
          `I've analyzed the ${
            ["code", "test output", "configuration", "logs"][t % 4]
          }. Here's what I found:\n`,
          `1. The main issue is in \`src/handlers/route${t}.ts\` where the database connection is not properly pooled.`,
          `2. ${"The connection is created per-request instead of using the shared pool, which causes the memory leak under load."}`,
          `3. I've applied the fix by replacing \`db.query()\` with \`pool.query()\` and added proper error handling.\n`,
          `The changes look correct. ${
            t < turns - 1
              ? "Let me know if you'd like me to proceed with the next step."
              : "All changes have been applied successfully."
          }`,
        ].join("\n"),
      });
    }
  }

  return messages;
}

/**
 * 7. Dashboard data (SoA) — columnar analytics query result.
 *
 * Struct-of-Arrays layout as returned by columnar engines
 * (DuckDB, ClickHouse, Polars, Arrow JS) and consumed by chart
 * libraries (D3, Plotly, Observable Plot, Vega).
 *
 * Shape:  One object with ~8 keys, each value is a large flat
 *         array of primitives or short strings.
 *
 * Structural opposite of Array<record>.
 */
function makeDashboardData(rows: number) {
  const categories = [
    "Electronics",
    "Books",
    "Clothing",
    "Home & Garden",
    "Sports",
    "Toys",
    "Automotive",
    "Grocery",
  ];
  const regions = [
    "US-West",
    "US-East",
    "EU-Central",
    "EU-North",
    "APAC",
    "LATAM",
  ];

  return {
    product_id: Array.from({ length: rows }, (_, i) => 100_000 + i),
    product_name: Array.from(
      { length: rows },
      (_, i) => `Product ${i} - ${categories[i % categories.length]}`,
    ),
    category: Array.from(
      { length: rows },
      (_, i) => categories[i % categories.length],
    ),
    sale_date: Array.from({ length: rows }, (_, i) => {
      const d = new Date(2024, 0, 1 + (i % 365));
      return d.toISOString().slice(0, 10);
    }),
    quantity: Array.from(
      { length: rows },
      (_, i) => 1 + (((i * 7) + 3) % 50),
    ),
    unit_price: Array.from(
      { length: rows },
      (_, i) => +(((i * 13) % 9990 + 10) / 100).toFixed(2),
    ),
    total_revenue: Array.from(
      { length: rows },
      (_, i) =>
        +((1 + (((i * 7) + 3) % 50)) * (((i * 13) % 9990 + 10) / 100))
          .toFixed(2),
    ),
    region: Array.from(
      { length: rows },
      (_, i) => regions[i % regions.length],
    ),
  };
}

/*
 ********************************************************************
 * memory usage comparison
 ********************************************************************
 *
 * run `deno task bench:mem`
 *
 * gc() + Deno.memoryUsage().heapUsed to measure the heap delta
 * produced by each clone call. each call is measured `SAMPLES` times
 * and the median is reported to reduce gc noise.
 */
import { FIXTURES, IMPLS } from "./clone_fixtures.ts";

const gc = (globalThis as unknown as { gc: () => void }).gc;
if (typeof gc !== "function") {
  console.error("error: gc() not available. Run with --v8-flags=--expose-gc");
  Deno.exit(1);
}

/*
 ********************************************************************
 * run
 ********************************************************************
 */

const SAMPLES = 21;
const SINK: unknown[] = [null];
const PAD_GROUP = 40;
const PAD_COL = 14;

/* headers */
const implNames = Object.keys(IMPLS);
console.log(
  "group".padEnd(PAD_GROUP)
    + "orig.size".padStart(PAD_COL)
    + implNames.map((n) => n.padStart(PAD_COL)).join(""),
);
console.log("-".repeat(PAD_GROUP + PAD_COL * (1 + implNames.length)));

/* results */
for (const [group, data, contentBytes] of FIXTURES) {
  let line = group.padEnd(PAD_GROUP);
  line += fmt(contentBytes).padStart(PAD_COL);

  for (const [, fn] of Object.entries(IMPLS)) {
    gc();
    const samples = measure(fn, data);
    const med = median(samples);
    line += fmt(med).padStart(PAD_COL);
  }

  console.log(line);
}

/*
 ********************************************************************
 * helpers
 ********************************************************************
 */

function fmt(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes} B`;
  if (Math.abs(bytes) < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function measure(fn: (d: unknown) => unknown, data: unknown): number[] {
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    SINK[0] = null;
    gc();

    const before = Deno.memoryUsage().heapUsed;
    SINK[0] = fn(data);
    const after = Deno.memoryUsage().heapUsed;

    samples.push(after - before);
  }
  SINK[0] = null;
  return samples;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

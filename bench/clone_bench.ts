import { FIXTURES, IMPLS } from "./clone_fixtures.ts";

/* prevent DCE */
const sink: unknown[] = [null];

for (const [group, data, _contentBytes] of FIXTURES) {
  for (const [impl, fn] of Object.entries(IMPLS)) {
    Deno.bench({
      name:
        `${impl} > ${group}`, /* this annoying but otherwise one can't filter on groups */
      group,
      baseline: impl === "clone",
      fn: () => {
        sink[0] = fn(data);
      },
    });
  }
}

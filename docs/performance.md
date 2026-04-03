# Performance

Benchmarking ~~in the presence of a GC~~ is really hard. Different compiler or runtime optimizations might materialize during benchmarking, but not under real-world conditions. Some datasets are too simple, others too complex or wrongly sized. Or whatever...

They are still useful though. The current implementation is performing quite well, and definitely fast enough for most application scenarios. As said somewhere else, if your use case is really performance sensitive, you've chosen the wrong language to begin with.

Make sure to run the benchmark suite yourself and verify the claims made in the following sections.

**DISCLAIMER:** most of the following highlights/summaries were written by a LLM. Only a few, clarifying edits have been made.

Raw data:

- [`deno bench`](../docs/perf_snapshot/2026_04_01_clone_bench.md)
- [`deno task bench:mem`](../docs/perf_snapshot/2026_04_01_clone_memory.md)

## Compared implementations

| Benchmark           | Description                                                                         |
| :------------------ | :---------------------------------------------------------------------------------- |
| **clone**           | `clone(value)` — default, preserves shared/circular refs via WeakMap cache          |
| **clone (nc)**      | `clone(value, { preserveShared: false })` — skips the cache                         |
| **structuredClone** | built-in, goes through the V8 serialization boundary                                |
| **rfdc**            | [rfdc](https://github.com/davidmarkclements/rfdc) — popular, really fast deep clone |

`rfdc` was chosen for a comparison because it has "really fast" in it's name and because it is used in `fastify`, which also has "fast" in it's name. Therefore it must be fast.
Seriously though, this should give a good indication of what `typed-clone` leaves on the table performance-wise for it's different stance on prototype poisoning and the custom clone protocol. (Spoiler: not tooo much)

---

## Throughput

### Plain records

| Benchmark |    clone | clone (nc) | structuredClone |     rfdc |
| --------- | -------: | ---------: | --------------: | -------: |
| 8 keys    | 261.4 ns |   210.6 ns |          3.6 µs | 189.6 ns |
| 16 keys   | 474.1 ns |   388.6 ns |          4.8 µs | 362.6 ns |
| 64 keys   |   2.3 µs |     2.2 µs |         10.4 µs |   2.2 µs |
| 256 keys  |  23.3 µs |    21.5 µs |         28.4 µs |  21.7 µs |
| 512 keys  |  71.8 µs |    75.6 µs |         55.5 µs |  75.2 µs |

For small-to-medium flat records, `rfdc` is roughly 10% faster than the comparable `clone (nc)` both roughly **4–18×** faster than `structuredClone`. Somewhere between 256 and 512 keys the V8 built-in catches up and overtakes everyone. (Caused by hidden-class transitions, this also heavily affects memory consumtption, see below)

### Nested records (Binary tree)

| Benchmark              |   clone | clone (nc) | structuredClone |     rfdc |
| ---------------------- | ------: | ---------: | --------------: | -------: |
| depth 4 · 16 leaves    |  4.6 µs |     3.2 µs |         20.5 µs |   2.7 µs |
| depth 8 · 256 leaves   | 81.6 µs |    49.1 µs |        290.4 µs |  47.8 µs |
| depth 12 · 4096 leaves |  1.3 ms |   831.0 µs |          5.3 ms | 770.1 µs |

Here `clone (nc)` is **~6×** faster than `structuredClone` and within **~10 %**
of `rfdc`. The default cached mode adds measurable overhead (the WeakMap lookup
on every object) — roughly **1.4–1.7×** slower than no-cache — so if you know
your data has no shared references, disabling the cache is worthwhile for deep
trees.

### Arrays of primitives

| Benchmark |    clone | clone (nc) | structuredClone |     rfdc |
| --------- | -------: | ---------: | --------------: | -------: |
| n = 256   | 325.6 ns |   332.4 ns |          7.9 µs |   5.5 µs |
| n = 1024  |   1.1 µs |     1.2 µs |         23.5 µs |  23.3 µs |
| n = 8192  |   9.2 µs |     9.2 µs |        159.0 µs | 179.3 µs |
| n = 65536 | 202.9 µs |   231.9 µs |          1.5 ms |   3.5 ms |

This is where `clone` pulls furthest ahead. It detects that every element is a
primitive and copies the backing array in one shot instead of visiting each
element. The result is **17–24×** faster than `structuredClone` and **15–20×**
faster than `rfdc`.

### Arrays of records

| Benchmark |    clone | clone (nc) | structuredClone |     rfdc |
| --------- | -------: | ---------: | --------------: | -------: |
| n = 64    |  10.4 µs |     6.3 µs |         45.2 µs |   5.8 µs |
| n = 256   |  37.3 µs |    25.8 µs |        179.7 µs |  23.7 µs |
| n = 1024  | 158.6 µs |   100.5 µs |        710.3 µs |  94.4 µs |
| n = 8192  |   1.4 ms |   805.5 µs |          5.7 ms | 741.2 µs |

When every element is an object, the per-element work dominates and the
primitive fast-path can't help. `clone (nc)` and `rfdc` are neck-and-neck
(within **~10 %**), both **~7×** faster than `structuredClone`. The cached
default adds ~1.5–1.7× overhead here.

### Map and Set

| Benchmark                   |    clone | clone (nc) | structuredClone |     rfdc |
| --------------------------- | -------: | ---------: | --------------: | -------: |
| Map\<string,number\> · 1024 |  46.3 µs |    49.3 µs |        229.9 µs | 226.0 µs |
| Map\<string,record\> · 1024 | 205.5 µs |   145.9 µs |        932.4 µs | 307.3 µs |
| Set\<number\> · 1024        |  34.8 µs |    35.0 µs |         92.2 µs |  56.5 µs |
| Set\<record\> · 1024        | 253.4 µs |   182.0 µs |        759.6 µs | 146.6 µs |

`clone` is consistently **2–5×** faster than `rfdc` on Maps and **4–7×** faster
than `structuredClone`. `rfdc` re-creates each container from scratch via
`Array.from` + constructor; `clone` iterates the native iterator directly.

### Real-world payloads

| Benchmark                       |    clone | clone (nc) | structuredClone |     rfdc |
| ------------------------------- | -------: | ---------: | --------------: | -------: |
| Frontend state slice            |   1.3 µs |   985.4 ns |          6.9 µs |   1.1 µs |
| JSON Schema (32 props)          |  20.9 µs |    13.1 µs |         62.4 µs |  16.2 µs |
| API collection (32 items)       |  91.7 µs |    79.9 µs |        353.0 µs | 102.7 µs |
| Agent session (32 turns)        |  47.7 µs |    34.3 µs |        252.7 µs |  44.8 µs |
| Normalized store (256 entities) | 116.5 µs |   103.0 µs |        372.0 µs | 114.5 µs |
| Dashboard data (8K rows)        | 346.5 µs |   323.8 µs |          2.5 ms |   1.6 ms |

Across realistic payloads `clone` is **3–8×** faster than `structuredClone` and
**1.1–5×** faster than `rfdc`. The gap widens with array-heavy data (dashboard
rows, agent sessions) because `clone` benefits from its primitive-array
fast-path.

---

## Memory overhead

The numbers below show heap allocated **by the clone operation itself** (i.e.
the clone's footprint, not the original). The original data sizes are calculated on a (admittedly hand-wavy), best-effort basis.

### Records

| Benchmark                 |     orig |    clone | clone (nc) | structuredClone |     rfdc |
| ------------------------- | -------: | -------: | ---------: | --------------: | -------: |
| Plain 8 keys              |    304 B |    512 B |      376 B |          2.8 KB |    376 B |
| Plain 64 keys             |   2.6 KB |   5.6 KB |     5.4 KB |          4.6 KB |   5.4 KB |
| Nested d=8 (256 leaves)   |  22.0 KB |  61.8 KB |    29.4 KB |         83.4 KB |  29.5 KB |
| Nested d=12 (4096 leaves) | 352.0 KB | 962.0 KB |   449.4 KB |         1.34 MB | 449.5 KB |

The default cached mode carries a WeakMap that roughly doubles the footprint
compared to no-cache. Without the cache, `clone` and `rfdc` allocate essentially
the same amount — both **~2–3×** less than `structuredClone`. This falls apart for large records (> 256) though, where V8 hidden-class transitions lead to near quadratic memory growth. Beware of that!

### Arrays

| Benchmark         |     orig |    clone | clone (nc) | structuredClone |     rfdc |
| ----------------- | -------: | -------: | ---------: | --------------: | -------: |
| primitive · 1024  |  16.0 KB |   8.3 KB |     8.2 KB |         10.2 KB |  37.9 KB |
| primitive · 65536 |  1.00 MB | 512.3 KB |   512.2 KB |        514.2 KB |  2.50 MB |
| string/1K · 8192  | 16.13 MB |  64.3 KB |    64.2 KB |         8.19 MB | 317.9 KB |
| record · 8192     | 765.8 KB |  1.05 MB |   513.4 KB |         1.70 MB | 767.1 KB |

Two things stand out:

1. **Primitive arrays** — `clone` allocates roughly the same as
   `structuredClone` and **~5× less** than `rfdc`. `rfdc` copies
   element-by-element into a fresh array, paying the per-slot overhead.
2. **String arrays** — `clone` is **~127× smaller** than `structuredClone` for 1
   KB strings. V8's `structuredClone` copies string bytes across the
   serialization boundary; `clone` keeps the original string references (strings
   are immutable, so sharing is safe).

### Containers (Map / Set)

| Benchmark                   |     orig |    clone | clone (nc) | structuredClone |     rfdc |
| --------------------------- | -------: | -------: | ---------: | --------------: | -------: |
| Map\<string,record\> · 1024 | 123.7 KB | 241.9 KB |   177.5 KB |        300.9 KB | 415.0 KB |
| Set\<record\> · 1024        |  93.8 KB | 161.9 KB |    97.6 KB |        252.9 KB | 143.3 KB |

`clone` uses **~40–60 %** less memory than `structuredClone` and **~25–40 %**
less than `rfdc` for Map/Set workloads.

### Real-world payloads

| Benchmark                |     orig |    clone | clone (nc) | structuredClone |     rfdc |
| ------------------------ | -------: | -------: | ---------: | --------------: | -------: |
| Agent session (32 turns) | 651.9 KB |  36.6 KB |    20.3 KB |        416.7 KB |  24.7 KB |
| Agent session (64 turns) |  1.27 MB |  70.6 KB |    38.3 KB |        853.9 KB |  49.2 KB |
| Dashboard (8K rows)      |  1.75 MB | 641.8 KB |   641.8 KB |         1.78 MB |  1.50 MB |
| Dashboard (64K rows)     | 14.08 MB |  4.00 MB |    4.00 MB |        13.91 MB | 19.99 MB |

Agent sessions contain long strings (message content) that `clone` shares by
reference, producing clones that are **~18–22×** smaller than `structuredClone`
and **~1.3×** smaller than `rfdc`. Dashboard rows are primitive-heavy, so
`clone` and `structuredClone` converge, while `rfdc` overshoots due to its
per-element array copy.

---

## When to use what

| Scenario                                           | Recommendation                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **General purpose**                                | `clone(value)` — safe default, handles shared/circular refs, fast enough for almost everything                         |
| **Hot path, no shared refs**                       | `clone(value, { preserveShared: false })` — drops the WeakMap cache for 5–50 % more speed                              |
| **Primitive-heavy arrays / large string payloads** | `clone` — biggest win over all alternatives (13–280× vs structuredClone, 5–20× vs rfdc)                                |
| **Very large flat records (500+ keys)**            | `structuredClone` overtakes property-by-property cloners; consider if type safety isn't needed                         |
| **Records with a lot of different buffer types**   | `structuredClone` can clone those in one batch, whereas `clone` calls `structuredClone` sequentially for each of those |
| **Need transferables**                             | `clone(value, { transfer: [...] })` — forwards the `transfer` list to `structuredClone` internally                     |

# typed-clone

[![codecov](https://codecov.io/github/aedge-io/typed-clone/graph/badge.svg?token=S4AQB5UAJO)](https://codecov.io/github/aedge-io/typed-clone)
![NPM Version](https://img.shields.io/npm/v/%40aedge-io%2Ftyped-clone)
![JSR Version](https://img.shields.io/jsr/v/%40aedge-io/typed-clone)

> Type-safe, performant, and extensible clone implementation.

---

### Motivation

This library was initially developed to provide a type-safe alternative to the naive `structuredClone`-based implementation in [grugway](https://github.com/aedge-io/grugway).

- **Type-safe**: Clearly encodes types that can and cannot be meaningfully cloned through the type system. Not-cloneable types get returned as `Ref<T>` explicitly.
- **Performant**: Fast enough for the 20% of data types that make up 80% of real-world usage. `structuredClone` fallback for the rest (e.g. typed arrays).
- **Extensible**: Simple, symbol-based [clone protocol](https://github.com/aedge-io/typed-clone/tree/main/docs/clone_protocol.md) for custom types.

### Use Cases

This library particularly shines when referential transparency and infallibility are desired, or when dealing with heterogeneous and complex data that usually requires hand-rolled copy/clone implementations. `typed-clone` offers a good baseline implementation in those cases.

The custom clone protocol also allows for a seamless interaction of standard data types with your custom types or domain model.

---

### Quick Start

#### Runtime Requirements

- **Bun:** ≥1.0.0
- **Deno:** ≥1.14
- **Node.js:** ≥17.0.0
- **Browsers:** Support `structuredClone`

#### Installation

**Node.js / Bun:**

```bash
(bun | (p)npm) add @aedge-io/typed-clone
```

**Deno:**

```bash
deno add jsr:@aedge-io/typed-clone
```

---

### Usage

#### Simple

```typescript
import { clone } from "@aedge-io/typed-clone";

const clonedRec = clone({ msg: "hello there!" }); // { msg: string }
const clonedFn = clone(() => "hello there again!"); // Ref<() => string>
```

#### Complex

```typescript
import { Clone, clone, Cloneable, CloneOptions } from "@aedge-io/typed-clone";

class NotCloneable {
  constructor(readonly name: string, private age: number) {}
  greet() {
    return `Hi, I am ${this.name} and ${this.age} years old.`;
  }
}

class Point { // implements Cloneable<Point>
  constructor(private x: number, private y: number) {}
  [Clone](opts?: CloneOptions) {
    return new Point(this.x, this.y);
  }
}

const randInt = () => Math.floor(Math.random() * 100);

const uintArray = new Uint8Array(new ArrayBuffer(4));
uintArray.set([0, 1, 2, 3]);

const meta = {
  createdAt: new Date(),
};

const original = {
  metadata: meta,
  handlers: new Map([["rand", randInt]]),
  primitives: ["string", 42, true, BigInt(9001), Symbol("foo")] as const,
  ref: new NotCloneable("Bob", 71),
  points: {
    unique: new Set([new Point(0, 1), new Point(1, 2)]),
    metadata: meta,
  },
  buf: uintArray,
  circularRef: {},
};
original.circularRef = original;

const cloned = clone(original, { transfer: [original.buf.buffer] });

// cloned = {
//   metadata: {
//     createdAt: Date;
//   };
//   handlers: Map<string, Ref<() => number>>;
//   primitives: readonly [string, number, boolean, bigInt, Ref<unique symbol>];
//   ref: Ref<NotCloneable>;
//   points: {
//     unique: Set<Point>; /* `Point` supports clone protocol */
//     metadata: {
//         createdAt: Date;
//     };
//   };
//   buf: Uint8Array<ArrayBuffer>;
//   circularRef: { ... };
// };

console.log("deep clone:", cloned !== original);
console.log("metadata cloned:", cloned.metadata !== original.metadata);
console.log("date cloned:", +cloned.metadata.createdAt === +meta.createdAt);
console.log("map cloned:", cloned.handlers !== original.handlers);
console.log("fn is ref:", cloned.handlers.get("rand") === randInt);
console.log("array cloned:", cloned.primitives !== original.primitives);
console.log("symbol is ref:", cloned.primitives[4] === original.primitives[4]);
console.log("class is ref:", cloned.ref === original.ref);
console.log("set cloned:", cloned.points.unique !== original.points.unique);
console.log("buf transferred:", original.buf.buffer.byteLength === 0);
console.log("circular ref preserved:", cloned.circularRef === cloned);
console.log(
  "shared refs preserved:",
  cloned.metadata === cloned.points.metadata,
);
```

---

### Performance

> **clone** = `clone(value)` (default, shared-ref cache)

> **clone (nc)** = `clone(value, { preserveRefs: false })`

| Benchmark                             |    clone |     ops/s | clone (nc) |     ops/s |
| ------------------------------------- | -------: | --------: | ---------: | --------: |
| Plain record (8 keys)                 | 257.1 ns | 3,890,000 |   203.8 ns | 4,908,000 |
| Plain record (64 keys)                |   2.3 µs |   440,400 |     2.2 µs |   463,400 |
| Plain record (256 keys)               |  23.0 µs |    43,520 |    21.7 µs |    46,020 |
| Nested records (d=4, 16 leaves)       |   4.3 µs |   232,000 |     2.8 µs |   351,900 |
| Nested records (d=8, 256 leaves)      |  77.3 µs |    12,940 |    47.6 µs |    21,030 |
| Nested records (d=12, 4096 leaves)    |   1.3 ms |       745 |   790.3 µs |     1,265 |
| Array\<primitive\> (n=256)            | 317.2 ns | 3,152,000 |   333.8 ns | 2,996,000 |
| Array\<primitive\> (n=8192)           |   9.0 µs |   111,300 |     8.9 µs |   112,900 |
| Array\<record\> (n=256)               |  39.4 µs |    25,370 |    24.5 µs |    40,830 |
| Array\<record\> (n=8192)              |   1.4 ms |       720 |   757.0 µs |     1,321 |
| Map\<string,record\> (n=256)          |  47.4 µs |    21,100 |    35.4 µs |    28,290 |
| Set\<record\> (n=256)                 |  47.1 µs |    21,230 |    35.2 µs |    28,380 |
| Real: Frontend state slice            |   1.3 µs |   758,900 |   941.4 ns | 1,062,000 |
| Real: JSON Schema (32 props)          |  19.5 µs |    51,230 |    12.7 µs |    78,500 |
| Real: API collection (32 items)       |  96.4 µs |    10,370 |    75.4 µs |    13,260 |
| Real: Agent session (32 turns)        |  50.2 µs |    19,930 |    33.7 µs |    29,690 |
| Real: Normalized store (256 entities) | 111.2 µs |     8,992 |   103.0 µs |     9,708 |
| Real: Dashboard data (8K rows)        | 349.9 µs |     2,858 |   322.3 µs |     3,103 |

By default, `typed-clone` keeps track of object references to support shared and circular references. The overhead is most pronounced for small data structures. By disabling it, clone operations can be up to ~50% faster.

For a comprehensive write-up including memory overhead and comparison to [rfdc](https://github.com/davidmarkclements/rfdc) and `structuredClone`, see [docs](https://github.com/aedge-io/typed-clone/tree/main/docs/performance.md).

**Your mileage may vary though!** Run the full benchmark suite with `deno bench`.

### Security

Unlike similar packages, `typed-clone` guards against primitive prototype poisoning. However, this protection does not extend to prototype pollution in general, since the mitigations are quite runtime-dependent.

- [Secure JSON.parse](https://github.com/fastify/secure-json-parse)
- [MDN prototype pollution](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/Prototype_pollution)

### Caveats

Given the structural nature of TypeScript's type system, certain edge-case subclasses currently don't get inferred correctly. Check out the [docs](https://github.com/aedge-io/typed-clone/tree/main/docs/type_safety.md) for a comprehensive overview.

---

### License

MIT License — see [LICENSE.md](./LICENSE.md)

### Resources

- [MDN structuredClone](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [V8 Memory Model](https://www.dashlane.com/blog/how-is-data-stored-in-v8-js-engine-memory)

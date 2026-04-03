---
name: typed-clone
description: "Type-safe, extensible deep clone that tracks what was cloned vs returned by reference at the type level. Use when cloning data, implementing the Clone protocol, or working with the Ref/Unref marker types from @aedge-io/typed-clone."
---

# typed-clone

Type-safe, infallible drop-in replacement for `structuredClone` that encodes
clone-ability in the type system.

## Installation

**Node.js / Bun:**

```bash
(bun | (p)npm) add @aedge-io/typed-clone
```

**Deno:**

```bash
deno add jsr:@aedge-io/typed-clone
```

## Quick Reference

```typescript
import {
  Clone, // Symbol key for the clone protocol
  clone, // T -> Cloned<T>
  isInherentlyCloneable, // runtime check for [Clone] support
  ref, // T -> Ref<T>   (identity, type-only cast)
  unref, // R -> Unref<R> (identity, type-only cast)
} from "@aedge-io/typed-clone";

import type {
  Cloneable, // interface: implement [Clone]() to control cloning
  Cloned, // the cloned representation of T
  CloneKey, // typeof Clone (the unique symbol type)
  CloneOptions, // extends StructuredSerializeOptions, adds depth
  Ref, // marker: value was returned by reference
  Unref, // strips all Ref markers recursively
} from "@aedge-io/typed-clone";
```

## Clone Priority (top to bottom)

| Priority | Input                                                                       | Output                     | Behavior                             |
| -------- | --------------------------------------------------------------------------- | -------------------------- | ------------------------------------ |
| 1        | `null`, `undefined`                                                         | same                       | by value                             |
| 2        | primitives (string, number, boolean, bigint)                                | same                       | by value                             |
| 3        | symbol, Function, WeakMap, WeakSet, WeakRef, Promise, Generator             | `Ref<T>`                   | by reference                         |
| 4        | object with `[Clone]()` method                                              | return type of `[Clone]()` | delegates to protocol                |
| 5        | Error (all subtypes)                                                        | `Ref<T>`                   | by reference                         |
| 6        | Array, Map, Set (exact constructors only)                                   | same container type        | element-by-element recursive clone   |
| 7        | class with methods                                                          | `Ref<T>`                   | by reference                         |
| 8        | plain record / `Object.create(null)`                                        | `{ [K]: Cloned<V> }`       | property-by-property recursive clone |
| 9        | structuredClone-able builtins (Date, RegExp, TypedArrays, ArrayBuffer, ...) | same type                  | via `structuredClone`                |
| 10       | anything else                                                               | `Ref<T>`                   | fallback by reference                |

## Implement the Clone Protocol

```typescript
import { Clone, clone } from "@aedge-io/typed-clone";
import type { Cloneable, CloneOptions } from "@aedge-io/typed-clone";

class Connection implements Cloneable<Connection> {
  constructor(private url: string, private token: string) {}

  [Clone](_opts?: CloneOptions): Connection {
    return new Connection(this.url, this.token);
  }
}

const original = new Connection("https://api.example.com", "secret");
const cloned = clone(original); // inferred as Connection
```

The `[Clone]` return type drives `Cloned<T>`. It does **not** have to return the
same type:

```typescript
class Snapshot implements Cloneable<{ data: number[]; frozen: true }> {
  constructor(private data: number[]) {}

  [Clone]() {
    return { data: [...this.data], frozen: true as const };
  }
}

const s = clone(new Snapshot([1, 2, 3]));
// s: { data: number[]; frozen: true }
```

`[Clone]` takes priority over `structuredClone`, even for builtins:

```typescript
class SpecialDate extends Date implements Cloneable<SpecialDate> {
  [Clone]() {
    return new SpecialDate(this.getTime());
  }
}
```

## Check for Clone Support at Runtime

If necessary:

```typescript
import { Clone, isInherentlyCloneable } from "@aedge-io/typed-clone";

if (isInherentlyCloneable(value)) {
  // value[Clone] is callable
  const cloned = value[Clone]();
}
```

## Ref and Unref

`Ref<T>` is a compile-time marker (zero runtime cost) indicating a value was
**not** cloned. `ref()` and `unref()` are identity functions that only change
the type.

```typescript
const original = { handler: () => 42, name: "test" };
const cloned = clone(original);
// cloned: { handler: Ref<() => number>; name: string }

cloned.handler === original.handler; // true — same reference

// Strip Ref markers when the distinction doesn't matter
const plain = unref(cloned);
// plain: { handler: () => number; name: string }
```

## Depth Control

```typescript
clone(value, { depth: 32 });
```

- Default: **16**
- Maximum: **500** (TypeScript type inference limit; higher values are clamped)
- When exhausted, remaining nested values are returned by `Ref`

## Transfer Support

Passes through to `structuredClone` for nested ArrayBuffers:

```typescript
const buf = new ArrayBuffer(8);
const obj = { nested: { buffer: buf } };
const cloned = clone(obj, { transfer: [buf] });
// buf.byteLength === 0 (detached)
```

## Shared References

Shared sub-objects within a single clone call preserve identity in the output:

```typescript
const shared = { x: 1 };
const original = { a: shared, b: shared };
const cloned = clone(original);

cloned.a === cloned.b; // true — identity preserved
cloned.a === original.a; // false — independent from source
```

## Disabling shared reference tracking

In very performance critical sections and the verified absence of circular
dependencies, the internal cache can be disabled:

```typescript
const shared = { x: 1 };
const original = { a: shared, b: shared };
const cloned = clone(original, { preserveRefs: false });

cloned.a !== cloned.b; // true — independently cloned
cloned.a === original.a; // false — independent from source
```

## Known Type Holes

These are cases where `Cloned<T>` is not able to infer the return type correctly
because of the types are indistinguishable structurally. They are documented in
the test suite.

### Container subclasses without custom methods

A subclass of Array/Map/Set that adds **no** methods is structurally
indistinguishable from the base at the type level, so `Cloned<T>` predicts a
deep clone. At runtime the subclass constructor is detected and the value is
returned by reference.

```typescript
class IdArray<T> extends Array<T> {} // no extra methods
const a = new IdArray<number>();
const c = clone(a);
// Cloned type: number[]  (predicts clone)
// Runtime:     same ref   (actually Ref)
```

**Workaround:** implement `[Clone]` if the type should be inherently cloneable,
or make suitable fields private to trigger the nominal typing machinery and get
a correct types.

### Classes with methods behind deep inheritance (>16 levels)

When the prototype chain exceeds the depth limit, `hasCustomMethods` can't reach
the level that defines methods. Data classes may be returned by reference
despite the type predicting a clone, and vice versa.

**Workaround:** implement `[Clone]` for the type, suggest to restruture the code
to flatten the (supposedly) complex inheritence chain or pass `{ depth: N }`
where N exceeds the inheritance depth.

### RecordLike classes

A class whose instance shape looks like a plain record to the type system (only
data properties visible) gets `Cloned` as a plain object type. At runtime, if
the prototype has methods, it's returned by reference instead.

```typescript
class User {
  constructor(readonly name: string) {}
  greet() {
    return `Hi, ${this.name}`;
  }
}
const c = clone(new User("Alice"));
// Cloned type: { readonly name: string; greet: Ref<() => string> }
// Runtime:     same ref (Ref)
```

**Workaround:** implement `[Clone]` if the type should be inherently cloneable,
or make suitable fields private to trigger the nominal typing machinery and get
a correct types.

## Imports

```
lib/types.ts  — pure type declarations (no runtime JS emitted)
lib/clone.ts  — all runtime: Clone symbol, clone(), ref(), unref(), isInherentlyCloneable()
lib/mod.ts    — barrel re-export; entry point of "@aedge-io/typed-clone"
```

Only use the entry point. Import types with seperate `import type` from
`@aedge-io/typed-clone` statements.

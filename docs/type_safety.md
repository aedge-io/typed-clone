# Type-safe cloning

`typed-clone` is to a very large degree the result of [wishful thinking](https://wiki.c2.com/?WishfulThinking). It manages to encode a lot of invariants into the type system. But claiming to be fully type-safe would be a blatant lie. The currently known "type holes" are documented bellow. (Please open an issue if you find others!)

The goal was to clearly communicate which types cannot be meaningfully cloned with minimal impact on performance and ergonomics. Additionally, every bug prevented through this technique is a huge win, as it allows to focus review attention on a smaller set of footguns.

## Ref and Unref

The cornerstone of the type-safety story is `Ref<T>`, a compile-time marker (zero runtime cost) indicating a value was **not** cloned. `ref()` and `unref()` are identity functions which used for type casts. They are the inverse to each other.

```typescript
import { clone, unref } from "@aedge-io/typed-clone";

const original = { handler: () => 42, name: "test" };
const cloned = clone(original);
// cloned: { handler: Ref<() => number>; name: string }

//@ts-expect-error
cloned.handler();
//^^^^^^^^^^^^^^^
//      \ this expression is not callable

// Strip Ref markers when the distinction doesn't matter
const plain = unref(cloned);
// plain: { handler: () => number; name: string }

plain.handler();
```

### Examples

Most importantly, `Ref<T>` prevents a whole class of potential bugs by being invariant to the wrapped type when it comes to assignments, equality checks and function arguments.

```typescript
import { clone, unref } from "@aedge-io/typed-clone";

class Logger {
  #prefix: string;
  constructor(public level: number, prefix: string) {
    this.#prefix = prefix;
  }
  log(msg: string) {
    console.log(`${this.#prefix}: ${msg}`);
  }
}

const originalLogger = new Logger(0, "INFO");
const opts = clone({ retries: 3, logger: originalLogger });
// opts: { retries: number; logger: Ref<Logger> }

// can't assign Ref<Logger> where Logger is expected
let logger: Logger;
// @ts-expect-error
logger = opts.logger;

// can't compare types since there is no overlap
// @ts-expect-error
originalLogger === opts.logger;

// can't pass the cloned record where the original type is expected
function run(o: { retries: number; logger: Logger }) {
  o.logger.log(`Number of retries: ${o.retries}`);
}
// @ts-expect-error
run(opts);

// explicit acknowledge via unref()
run(unref(opts));
```

## Known Type Holes

These are cases where `Cloned<T>` is not able to infer the return type correctly because of the types are indistinguishable structurally. These are also documented in the test suite.

### RecordLike classes

This is probably the most common one: A class whose instance shape looks like a plain record to the type system (all properties visible) gets `Cloned` as a plain object type. At runtime, if the prototype has methods, it's returned by reference instead. On the bright sight, this still prevents a lot of bugs, since ref'd methods are not callable.

```typescript
import { clone } from "@aedge-io/typed-clone";

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

**Workaround:** implement `[Clone]` if the type should be inherently cloneable, or **make suitable fields private** to trigger the nominal typing machinery and get a correct types.

```typescript
import { clone } from "@aedge-io/typed-clone";

class User {
  constructor(private name: string) {} //name is now private
  greet() {
    return `Hi, ${this.name}`;
  }
}

const c = clone(new User("Alice"));
// c: Ref<User>
```

### Container subclasses without custom methods

A subclass of Array/Map/Set that adds **no** methods is structurally indistinguishable from the base at the type level, so `Cloned<T>` predicts a deep clone. At runtime the subclass constructor is detected and the value is returned by reference.

```typescript
import { clone } from "@aedge-io/typed-clone";

class IdArray<T> extends Array<T> {} // no extra methods
const a = new IdArray<number>();
const c = clone(a);
// Cloned type: number[]  (predicts clone)
// Runtime:     same ref   (actually Ref)
```

**Workaround:** implement `[Clone]` if the type should be inherently cloneable, or make suitable fields private to trigger the nominal typing machinery and get a correct types.

### Classes with methods behind deep inheritance (>16 levels)

When the prototype chain exceeds the depth limit, `hasCustomMethods` can't reach the level that defines methods. Data classes may be returned by reference despite the type predicting a clone, and vice versa.

**Workaround:** implement `[Clone]` for the type, restruture the code to flatten the (supposedly) complex inheritence chain or pass `{ depth: N }` where N exceeds the inheritance depth.

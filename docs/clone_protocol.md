# The Clone Protocol

One of the early design decisions made, was to **NOT support** property based prototype cloning. It's impossible to get right since the introduction of private properties (`#property` syntax), both at run-time and compile-time. Also, this ecosystem has enough on it's plate security wise, that it just doesn't seem sensible to support a feature which most of the time comes up during discussions involving "poisoning" and "pollution". (Sorry fellow extension method afficionados. No nice things to be had here)

On the other hand, it's really convenient from a user perspective to just pack one's custom type in a record or array, `clone` the whole thing and call it a day. Especially if the type system is smart enough to infer it.

That's why `typed-clone` supports a custom, symbol based protocol. It allows users to define the semantics of what constitutes a valid clone for a given type granularly, while not having to worry about collissions with other well-known methods. Or compromising on encapsulation.

## Implementing the clone protocol

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

During type inference, the `Cloned<T>` type checks if `T` supports the protocol and infers the return type of the `[Clone](opts?: CloneOptions)` method. This means, that the implementor **does not** necessarily have to return the same type as `this`.

```typescript
import { Clone, clone } from "@aedge-io/typed-clone";

class Snapshot {
  constructor(private data: number[]) {}

  [Clone]() {
    return { data: [...this.data], frozen: true as const };
  }
}

const s = clone(new Snapshot([1, 2, 3]));
// s: { data: number[]; frozen: true }
```

The protocol takes priority over every other type specific clone strategy. Even for derivatives of built-ins.

So this will be handled by the protocol:

```typescript
import { Clone, type Cloneable } from "@aedge-io/typed-clone";

class SpecialDate extends Date implements Cloneable<SpecialDate> {
  [Clone]() {
    return new SpecialDate(this.getTime());
  }
}
```

This as well:

```typescript
import { Clone } from "@aedge-io/typed-clone";

const rec = {
  name: "Bob",
  [Clone]: () => ({ name: "Alice" }),
};
```

## Check for clone protocol support at run-time

Should it ever be necessary, you can verify at run-time that a given type implements the clone protocol:

```typescript
import { Clone, isInherentlyCloneable } from "@aedge-io/typed-clone";

const rec = {
  name: "Bob",
  [Clone]: () => ({ name: "Alice" }),
};

if (isInherentlyCloneable(rec as object)) {
  // rec[Clone] is callable
  const cloned = rec[Clone]();
}
```

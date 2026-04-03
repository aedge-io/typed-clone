import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertNotEquals,
  assertNotInstanceOf,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import type { Has, IsExact } from "@std/testing/types";
import { assertType } from "@std/testing/types";
import type {
  Cloneable,
  Cloned,
  CloneOptions,
  Ref,
} from "@aedge-io/typed-clone";
import { Clone, clone, ref, unref } from "@aedge-io/typed-clone";

Deno.test("typed-clone::types", async (t) => {
  await t.step("Ref<T> -> maps object types to readonly", () => {
    const str = "message";
    const rec = { a: 42 };
    const arr = [1, 2, 3];
    const map = new Map([["a", 42]]);
    const set = new Set(arr);

    const refStr = ref(str);
    const refRec = ref(rec);
    const refArr = ref(arr);
    const refMap = ref(map);
    const refSet = ref(set);

    assertType<Has<typeof refStr, string>>(true);
    assertType<Has<typeof refRec, Readonly<typeof rec>>>(true);
    assertType<Has<typeof refArr, Readonly<typeof arr>>>(true);
    assertType<Has<typeof refMap, Readonly<typeof map>>>(true);
    assertType<Has<typeof refSet, Readonly<typeof set>>>(true);
  });

  await t.step("Unref<T> -> removes Ref marker type", () => {
    const str = "message";
    const rec = { a: 42 };
    const arr = [1, 2, 3];
    const map = new Map([["a", 42]]);
    const set = new Set(arr);

    const unrefStr = unref(ref(str));
    const unrefRec = unref(ref(rec));
    const unrefArr = unref(ref(arr));
    const unrefMap = unref(ref(map));
    const unrefSet = unref(ref(set));

    assertType<IsExact<typeof unrefStr, string>>(true);
    assertType<IsExact<typeof unrefRec, typeof rec>>(true);
    assertType<IsExact<typeof unrefArr, typeof arr>>(true);
    assertType<IsExact<typeof unrefMap, typeof map>>(true);
    assertType<IsExact<typeof unrefSet, typeof set>>(true);
  });

  await t.step("Unref<T> -> removes Ref from nested types", () => {
    const rec = { rec: ref({ a: 42 }) };
    const refRec = ref(rec);
    const arr = [ref(1), ref(2), ref(3)];
    const refArr = ref(arr);
    const map = new Map([[ref("a"), ref(42)]]);
    const refMap = ref(map);
    const set = new Set(arr);
    const refSet = ref(set);

    const unrefRec = unref(rec);
    const unrefArr = unref(arr);
    const unrefMap = unref(map);
    const unrefSet = unref(set);
    const doubleUnrefRec = unref(refRec);
    const doubleUnrefArr = unref(refArr);
    const doubleUnrefMap = unref(refMap);
    const doubleUnrefSet = unref(refSet);

    assertType<IsExact<typeof unrefRec, { rec: { a: number } }>>(true);
    assertType<IsExact<typeof unrefArr, number[]>>(true);
    assertType<IsExact<typeof unrefMap, Map<string, number>>>(true);
    assertType<IsExact<typeof unrefSet, Set<number>>>(true);
    assertType<IsExact<typeof doubleUnrefRec, { rec: { a: number } }>>(true);
    assertType<IsExact<typeof doubleUnrefRec, { rec: { a: number } }>>(true);
    assertType<IsExact<typeof doubleUnrefArr, number[]>>(true);
    assertType<IsExact<typeof doubleUnrefMap, Map<string, number>>>(true);
    assertType<IsExact<typeof doubleUnrefSet, Set<number>>>(true);
  });

  await t.step("Un/Ref<T> -> preserve original property modifiers", () => {
    type Rec = {
      readonly a: number;
      b?: string;
      ref: Readonly<{ c: number }>;
      tuple: [string, number, boolean];
    };
    const rec: Rec = {
      a: 42,
      b: undefined,
      ref: { c: 9001 },
      tuple: ["a", 2, true] as const,
    };

    const refRec = ref(rec);
    const unrefRec = unref(refRec);

    assertType<IsExact<typeof unrefRec, Rec>>(true);
  });
});
Deno.test("typed-clone::clone", async (t) => {
  await t.step("clone(string) -> returns by value", () => {
    const str = "hello";
    const cloned = clone(str);

    assertType<IsExact<typeof cloned, string>>(true);
    assertStrictEquals(cloned, str);
  });

  await t.step("clone(number) -> returns by value", () => {
    const num = 42;
    const cloned = clone(num);

    assertType<IsExact<typeof cloned, number>>(true);
    assertStrictEquals(cloned, num);
  });

  await t.step("clone(boolean) -> returns by value", () => {
    const bool = true;
    const cloned = clone(bool);

    assertType<IsExact<typeof cloned, boolean>>(true);
    assertStrictEquals(cloned, bool);
  });

  await t.step("clone(bigint) -> returns by value", () => {
    const big = BigInt(99);
    const cloned = clone(big);

    assertType<IsExact<typeof cloned, bigint>>(true);
    assertStrictEquals(cloned, big);
  });

  await t.step("clone(symbol) -> returns Ref", () => {
    const sym = Symbol("test");
    const cloned = clone(sym);

    assertType<IsExact<typeof cloned, Ref<typeof sym>>>(true);
    assertStrictEquals(cloned, sym);
  });

  await t.step(
    "clone(Cloneable) -> delegates to [Clone] and returns correct type",
    () => {
      class MyClass {
        constructor(readonly value: number) {}
        [Clone]() {
          return new MyClass(this.value);
        }
      }

      const original = new MyClass(42);
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, MyClass>>(true);
      assert(cloned !== original);
      assert(cloned instanceof MyClass);
      assertStrictEquals(cloned.value, 42);
    },
  );

  await t.step(
    "clone(Cloneable) -> [Clone] return type is correctly inferred",
    () => {
      class MyClass implements Cloneable<MyClass[]> {
        constructor(readonly value: number) {}
        [Clone](): MyClass[] {
          return [new MyClass(this.value)];
        }
      }

      const original = new MyClass(42);
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, MyClass[]>>(true);
      assertNotStrictEquals(cloned, original as unknown);
    },
  );

  await t.step(
    "clone(Cloneable) -> [Clone] precedence over structuredClone",
    () => {
      let cloneCalled = false;

      class SpecialDate extends Date implements Cloneable<SpecialDate> {
        [Clone](): SpecialDate {
          cloneCalled = true;
          return new SpecialDate(this.getTime());
        }
      }

      const original = new SpecialDate("2026-03-17");
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, SpecialDate>>(true);
      assertStrictEquals(cloneCalled, true);
      assertInstanceOf(cloned, SpecialDate);
      assertNotStrictEquals(cloned, original);
    },
  );

  await t.step(
    "clone(Cloneable) -> [Clone] precedence over property-by-proberty clone",
    () => {
      const original = {
        a: "Bob",
        b: 42,
        [Clone]() {
          return true;
        },
      };

      const cloned = clone(original);

      assertType<IsExact<typeof cloned, boolean>>(true);
      assertStrictEquals(cloned, true);
    },
  );

  await t.step(
    "clone(Array<Cloneable>) -> delegates to [Clone] and returns correct type",
    () => {
      class MyClass implements Cloneable<MyClass> {
        constructor(readonly value: number) {}
        [Clone](): MyClass {
          return new MyClass(this.value);
        }
      }

      const original = Array(5).fill(0).map((_, i) => new MyClass(i));
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, MyClass[]>>(true);
      assertNotStrictEquals(cloned, original);
      assertNotStrictEquals(cloned[0], original[0]);
      assertInstanceOf(cloned[0], MyClass);
      assertEquals(cloned, original);
    },
  );

  await t.step("clone(Error) -> returns Ref", () => {
    const original = new Error("boom");
    const cloned = clone(original);

    assertType<IsExact<typeof cloned, Ref<Error>>>(true);
    assertStrictEquals(cloned, original);
  });

  await t.step(
    "clone(customError) -> returns Ref",
    () => {
      class AppError extends Error {
        code = 42;
      }

      const original = new AppError("fail");
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, Ref<AppError>>>(true);
      assertStrictEquals(cloned, original);
    },
  );

  await t.step(
    "clone(TypeError | RangeError | ...) -> all built-in Error subtypes are Ref",
    () => {
      const typeErr = TypeError("te");
      const rangeErr = RangeError("re");
      const syntaxErr = SyntaxError("se");
      const refErr = ReferenceError("re");
      const uriErr = URIError("ue");
      const evalErr = EvalError("ee");

      assertType<IsExact<Cloned<TypeError>, Ref<TypeError>>>(true);
      assertType<IsExact<Cloned<RangeError>, Ref<RangeError>>>(true);
      assertType<IsExact<Cloned<SyntaxError>, Ref<SyntaxError>>>(true);
      assertType<IsExact<Cloned<ReferenceError>, Ref<ReferenceError>>>(true);
      assertType<IsExact<Cloned<URIError>, Ref<URIError>>>(true);
      assertType<IsExact<Cloned<EvalError>, Ref<EvalError>>>(true);
      assertStrictEquals(clone(typeErr), typeErr);
      assertStrictEquals(clone(rangeErr), rangeErr);
      assertStrictEquals(clone(syntaxErr), syntaxErr);
      assertStrictEquals(clone(refErr), refErr);
      assertStrictEquals(clone(uriErr), uriErr);
      assertStrictEquals(clone(evalErr), evalErr);
    },
  );

  await t.step("clone(Date) -> deep clones via structuredClone", () => {
    const original = new Date("2026-03-17");
    const cloned = clone(original);

    assertType<IsExact<typeof cloned, Date>>(true);
    assert(cloned !== original);
    assert(cloned instanceof Date);
    assertStrictEquals(cloned.getTime(), original.getTime());
  });

  await t.step("clone(RegExp) -> deep clones via structuredClone", () => {
    const original = /abc/gi;
    const cloned = clone(original);

    assertType<IsExact<typeof cloned, RegExp>>(true);
    assert(cloned !== original);
    assert(cloned instanceof RegExp);
    assertStrictEquals(cloned.source, "abc");
    assertStrictEquals(cloned.flags, "gi");
  });

  await t.step("clone(Map) -> deep clones", () => {
    const original = new Map([["a", 1], ["b", 2]]);
    const cloned = clone(original);

    assertType<IsExact<typeof cloned, Map<string, number>>>(true);
    assert(cloned !== original);
    assert(cloned instanceof Map);
    assertStrictEquals(cloned.get("a"), original.get("a"));
    assertStrictEquals(cloned.get("b"), original.get("b"));
  });

  await t.step("clone(Set) -> deep clones", () => {
    const original = new Set([1, 2, 3]);
    const cloned = clone(original);

    assertType<IsExact<typeof cloned, Set<number>>>(true);
    assert(cloned !== original);
    assert(cloned instanceof Set);
    assertEquals([...cloned], [1, 2, 3]);
  });

  await t.step("clone(Uint8Array) -> deep clones via structuredClone", () => {
    const original = new Uint8Array([1, 2, 3]);
    const cloned = clone(original);

    assertType<IsExact<typeof cloned, Uint8Array<ArrayBuffer>>>(true);
    assert(cloned !== original);
    assert(cloned instanceof Uint8Array);
    assertEquals([...cloned], [1, 2, 3]);
  });

  await t.step("clone(ArrayBuffer) -> deep clones via structuredClone", () => {
    const original = new ArrayBuffer(8);
    const cloned = clone(original);

    assertType<IsExact<typeof cloned, ArrayBuffer>>(true);
    assert(cloned !== original);
    assert(cloned instanceof ArrayBuffer);
    assertStrictEquals(cloned.byteLength, 8);
  });

  await t.step("clone(prototype) -> injected prototype is ignored", () => {
    type Rec = {
      a: string;
      b: number;
    };

    const rec: Rec = {
      a: "name",
      b: 42,
    };

    const malicious = { c: "injected" };
    //@ts-ignore-line
    rec["__proto__"] = malicious;

    const cloned = clone(rec);

    assertType<IsExact<typeof cloned, Rec>>(true);
    assertNotStrictEquals(cloned, rec);
    //@ts-ignore-line
    assertStrictEquals(cloned.c, undefined);
  });

  await t.step(
    "clone(prototype) -> mitigates __proto__ poisoning via JSON.parse",
    () => {
      /**
       * Generated by a LLM (Opus 4.6)
       */

      // Install Annex B __proto__ accessor (present in Node.js, absent in Deno)
      Object.defineProperty(Object.prototype, "__proto__", {
        get(this: object) {
          return Object.getPrototypeOf(this);
        },
        set(this: object, value: unknown) {
          if (value === null || typeof value === "object") {
            Object.setPrototypeOf(this, value as object | null);
          }
        },
        enumerable: false,
        configurable: true,
      });

      try {
        // JSON.parse creates __proto__ as an own data property via
        // [[DefineOwnProperty]], bypassing the setter. The object's
        // actual prototype stays Object.prototype.
        const input = JSON.parse(
          '{"__proto__": {"admin": true}, "name": "test"}',
        );

        assert(Object.hasOwn(input, "__proto__"));
        assertStrictEquals(Object.getPrototypeOf(input), Object.prototype);

        const cloned = clone(input);

        assertStrictEquals(Object.getPrototypeOf(cloned), Object.prototype);
        assertStrictEquals(
          (cloned as Record<string, unknown>).admin,
          undefined,
        );
        assertFalse("admin" in (cloned as Record<string, unknown>));
      } finally {
        Reflect.deleteProperty(Object.prototype, "__proto__");
      }
    },
  );

  await t.step(
    "clone(Array<primitive>) -> deep clones",
    () => {
      const original = [1, 2, 3];
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, number[]>>(true);
      assert(cloned !== original);
      assertEquals(cloned, original);
    },
  );

  await t.step(
    "clone(Array<record>) -> deep clones",
    () => {
      const original = [{ a: 1 }, { a: 2 }];
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, { a: number }[]>>(true);
      assert(cloned !== original);
      assert(cloned[0] !== original[0]);
      assertEquals(cloned, original);
    },
  );

  await t.step(
    "clone(Array<Array<record>>) -> deep clones nested arrays",
    () => {
      const original = [[{ a: 1 }, { a: 2 }]];
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, { a: number }[][]>>(true);
      assert(cloned !== original);
      assert(cloned[0] !== original[0]);
      assertEquals(cloned, original);
    },
  );

  await t.step(
    "clone(Array<function>) -> clones array, refs elements",
    () => {
      const original = [() => 1, () => 2];
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, Ref<() => number>[]>>(true);
      assertNotStrictEquals(cloned, original as unknown);
      assertStrictEquals(cloned[0], original[0]);
    },
  );

  await t.step(
    "clone(Array<Error>) -> clones array, refs errors",
    () => {
      const original = [Error("one"), Error("two")];
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, Ref<Error>[]>>(true);
      assertNotStrictEquals(cloned, original);
      assertStrictEquals(cloned[0], original[0]);
    },
  );

  await t.step(
    "clone(Array<customClass>) -> clones array, refs elements",
    () => {
      class User {
        constructor(private name: string) {}
        greet() {
          return `Hi, ${this.name}`;
        }
      }

      const original = [new User("Alice"), new User("Bob")];
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, Ref<User>[]>>(true);
      assertNotStrictEquals(unref(cloned), original);
      assertStrictEquals(cloned[0], original[0]);
    },
  );

  await t.step(
    "clone(Array<customDataClass>) -> deep clones elements as plain-objects",
    () => {
      class Point {
        constructor(readonly x: number, readonly y: number) {}
      }

      const original = [new Point(1, 2), new Point(3, 4)];
      const cloned = clone(original);

      assertType<
        IsExact<
          typeof cloned,
          { readonly x: number; readonly y: number }[]
        >
      >(true);

      assertNotStrictEquals(cloned, original);
      assertNotStrictEquals(cloned[0], original[0]);
      assertStrictEquals(cloned[0].x, original[0].x);
      assertNotInstanceOf(cloned[0], Point);
    },
  );

  await t.step(
    "clone(customArray) -> refs whole subclass",
    () => {
      class CustomArray<T> extends Array<T> {
        constructor(length: number) {
          super(length);
        }
        has(item: T): boolean {
          return this.some((value) => value === item);
        }
      }

      const original = new CustomArray<string>(1);
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, Ref<CustomArray<string>>>>(true);
      assertStrictEquals(cloned, original);
      assertStrictEquals(cloned.length, original.length);
    },
  );

  await t.step(
    "clone(customSet) -> refs whole subclass",
    () => {
      class CustomSet<T> extends Set<T> {
        constructor(values?: T[]) {
          super(values);
        }

        check(item: T): boolean {
          return this.has(item);
        }
      }

      const original = new CustomSet([1, 2, 3]);
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, Ref<CustomSet<number>>>>(true);
      assertStrictEquals(cloned, original);
      assertEquals([...cloned], [...original]);
    },
  );

  await t.step(
    "clone(customMap) -> refs whole subclass",
    () => {
      class CustomMap<K, V> extends Map<K, V> {
        constructor(entries: [K, V][]) {
          super(entries);
        }
        check(key: K): boolean {
          return this.has(key);
        }
      }

      const original = new CustomMap([[1, "one"], [2, "two"]]);
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, Ref<CustomMap<number, string>>>>(true);
      assertStrictEquals(cloned, original);
    },
  );

  await t.step(
    "clone(arraySubclass) -> WARNING: type hole! Is actually Ref",
    () => {
      class CustomArray<T> extends Array<T> {
        constructor(length: number) {
          super(length);
        }
      }

      const original = new CustomArray(1);
      const cloned = clone(original);

      /* this should actually be TRUE! here for documentation purposes */
      assertType<IsExact<typeof cloned, Ref<CustomArray<string>>>>(false);
      assertThrows(() => {
        assertNotStrictEquals(unref(cloned), original);
      });
      assertStrictEquals(cloned.length, original.length);
    },
  );

  await t.step(
    "clone(setSubclass) -> WARNING: type hole! Is actually Ref",
    () => {
      class CustomSet<T> extends Set<T> {
        constructor(values?: T[]) {
          super(values);
        }
      }

      const original = new CustomSet([1, 2, 3]);
      const cloned = clone(original);

      /* this should actually be TRUE! here for documentation purposes */
      assertType<IsExact<typeof cloned, Ref<CustomSet<number>>>>(false);
      assertThrows(() => {
        assertNotStrictEquals(cloned, original);
      });
      assertEquals([...cloned], [...original]);
    },
  );

  await t.step(
    "clone(mapSubclass) -> WARNING: type hole! Is actually Ref",
    () => {
      class CustomMap<K, V> extends Map<K, V> {
        constructor(entries: [K, V][]) {
          super(entries);
        }
      }

      const original = new CustomMap([[1, "one"], [2, "two"]]);
      const cloned = clone(original);

      /* this should actually be TRUE! here for documentation purposes */
      assertType<IsExact<typeof cloned, Ref<CustomMap<number, string>>>>(false);
      assertThrows(() => {
        assertNotStrictEquals(cloned, original);
      });
      assertEquals(
        [...cloned],
        [...original],
      );
    },
  );

  await t.step(
    "clone(ReadonlyArray<primitive>) -> preserves tuples",
    () => {
      const original = [1, 2, 3] as const;
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, typeof original>>(true);
      assert(cloned !== original);
      assertEquals(cloned, original);
    },
  );

  await t.step(
    "clone(record) -> deep clones and preserves type",
    () => {
      const original = { a: 1, b: "hello" };
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, typeof original>>(true);
      assertNotStrictEquals(cloned, original);
      assertEquals(cloned, original);
    },
  );

  await t.step(
    "clone(recordWithOptional) -> deep clones and preserves optional type",
    () => {
      type WithOptional = { readonly a: number; b?: string };
      const original: WithOptional = { a: 1, b: "hello" };
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, typeof original>>(true);
      assertNotStrictEquals(cloned, original);
      assertEquals(cloned, original);
    },
  );

  await t.step(
    "clone(nestedRecord) -> deep clones recursively",
    () => {
      const original = { a: 1, b: { c: "deep" } };
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, typeof original>>(true);
      assertNotStrictEquals(cloned, original);
      assertNotStrictEquals(cloned.b, original.b);
      assertEquals(cloned, original);
    },
  );

  await t.step(
    "clone(recordWithMethod) -> deep clones with Ref'd function",
    () => {
      const original = { a: 1, fn: () => 1 };

      const cloned = clone(original);

      assertType<IsExact<typeof cloned, { a: number; fn: Ref<() => number> }>>(
        true,
      );
      assertNotStrictEquals(unref(cloned), original);
      assertEquals(unref(cloned), original);
      assertStrictEquals(cloned.fn, original.fn);
    },
  );

  await t.step(
    "clone(recordWithSymbolKey) -> deep clones without symbol key",
    () => {
      const tag = Symbol("tag");
      const original = { a: 1, [tag]: "tag" };
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, { a: number }>>(true);
      assertNotStrictEquals(cloned, original);
      assertNotEquals(cloned, original);
      assertEquals(cloned.a, original.a);
      assertFalse((cloned as any)[tag]);
    },
  );

  await t.step(
    "clone(recordWithSymbolValue) -> deep clones with Ref'd symbol value",
    () => {
      const tag = Symbol("tag");
      const original = { a: 1, tag };
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, { a: number; tag: Ref<symbol> }>>(true);
      assertNotStrictEquals(cloned, original);
      assertEquals(cloned, original);
      assertStrictEquals(cloned.tag, original.tag);
    },
  );

  await t.step(
    "clone(RecordLikeClass) -> WARNING: type hole! clone is actually Ref",
    () => {
      class User {
        constructor(readonly name: string) {}
        greet() {
          return `Hi, ${this.name}`;
        }
      }

      const original = new User("Alice");
      const cloned = clone(original);

      /* this should actually be TRUE! here for documentation purposes */
      assertType<IsExact<typeof cloned, Ref<User>>>(false);
      /* actual inferred type */
      assertType<
        IsExact<
          typeof cloned,
          { readonly name: string; greet: Ref<() => string> }
        >
      >(true);
      assertThrows(() => {
        assertNotStrictEquals(unref(cloned), original);
      });
      assertStrictEquals(cloned.name, original.name);
    },
  );

  await t.step(
    "clone(RecordLikeDataClass) -> deep clones, type reflects plain record",
    () => {
      class Point {
        constructor(readonly x: number, readonly y: number) {}
      }

      const original = new Point(1, 2);
      const cloned = clone(original);

      assertType<
        IsExact<typeof cloned, { readonly x: number; readonly y: number }>
      >(true);
      assertNotStrictEquals(cloned, original);
    },
  );

  await t.step(
    "clone(recordWithCustomClass) -> deep clones with Ref'd class",
    () => {
      class User {
        constructor(private name: string) {}
        greet() {
          return `Hi, ${this.name}`;
        }
      }
      const meta = {
        comments: 42,
        since: Date.now(),
      };
      const user = new User("Alice");
      const original = { meta, user };

      const cloned = clone(original);

      assertType<
        IsExact<typeof cloned, { meta: typeof meta; user: Ref<User> }>
      >(true);
      assertNotStrictEquals(unref(cloned), original);
      assertNotStrictEquals(cloned.meta, original.meta);
      assertStrictEquals(cloned.user, original.user);
    },
  );

  await t.step("clone(Function) -> returns Ref", () => {
    const fn = () => 42;
    const cloned = clone(fn);

    assertType<IsExact<typeof cloned, Ref<() => void>>>(true);
    assertStrictEquals(cloned, fn);
  });

  await t.step("clone(WeakMap) -> returns Ref", () => {
    const original = new WeakMap<WeakKey, object>();
    const cloned = clone(original);

    assertType<
      IsExact<
        typeof cloned,
        Ref<WeakMap<WeakKey, object>>
      >
    >(true);
    assertStrictEquals(cloned, original);
  });

  await t.step("clone(WeakSet) -> returns Ref", () => {
    const original = new WeakSet<WeakKey>();
    const cloned = clone(original);

    assertType<IsExact<typeof cloned, Ref<WeakSet<WeakKey>>>>(true);
    assertStrictEquals(cloned, original);
  });

  await t.step("clone(Promise) -> returns Ref", () => {
    const original = Promise.resolve(42);
    const cloned = clone(original);

    assertType<
      IsExact<typeof cloned, Ref<Promise<number>>>
    >(true);
    assertStrictEquals(cloned, original);
  });

  await t.step(
    "clone(classWithGetter) -> returns Ref",
    () => {
      class Config {
        #host = "localhost";
        #port = 8080;
        get host() {
          return this.#host;
        }
        get port() {
          return this.#port;
        }
      }

      const original = new Config();
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, Ref<Config>>>(true);
      assertStrictEquals(cloned, original);
      assertStrictEquals(cloned.host, "localhost");
      assertStrictEquals(cloned.port, 8080);
    },
  );

  await t.step(
    "clone(classWithSetter) -> returns Ref",
    () => {
      class WriteOnly {
        #log: string[] = [];
        set entry(v: string) {
          this.#log.push(v);
        }
        get log() {
          return this.#log;
        }
      }

      const original = new WriteOnly();
      original.entry = "first";
      const cloned = clone(original);

      assertType<IsExact<typeof cloned, Ref<WriteOnly>>>(true);
      assertStrictEquals(cloned, original);
      assertEquals(cloned.log, ["first"]);
    },
  );

  await t.step(
    "clone(dataClassHoldingNonCloneable) -> WARNING: type hole! Is actually Ref",
    () => {
      class Holder {
        constructor(readonly callback: () => number) {}
      }

      const original = new Holder(() => 42);
      const cloned = clone(original);

      /* this should actually be TRUE! here for documentation purposes */
      assertType<IsExact<typeof cloned, Ref<Holder>>>(false);
      /* actual inferred type — structuredClone fallback fails at runtime */
      assertType<
        IsExact<typeof cloned, { readonly callback: Ref<() => number> }>
      >(true);
      assertThrows(() => {
        assertNotStrictEquals(unref(cloned), original);
      });
    },
  );

  await t.step(
    "clone(objectWithSharedReference) -> shared sub-objects are independently cloned",
    () => {
      const shared = { x: 1 };
      const original = { a: shared, b: shared };

      const cloned = clone(original);

      assertType<IsExact<typeof cloned, typeof original>>(true);
      assertNotStrictEquals(cloned, original);
      assertNotStrictEquals(cloned.a, original.a);
      assertNotStrictEquals(cloned.b, original.b);

      assertEquals(cloned.a, { x: 1 });
      assertEquals(cloned.b, { x: 1 });

      cloned.a.x = 999;
      cloned.b.x = 888;
      assertStrictEquals(shared.x, 1);
      assertStrictEquals(cloned.a, cloned.b);
    },
  );

  await t.step(
    "clone(objectWithSharedReference, { preserveShared: false }) -> shared sub-objects are cloned independently",
    () => {
      const shared = { x: 1 };
      const original = { a: shared, b: shared };

      const cloned = clone(original, { preserveRefs: false });

      assertType<IsExact<typeof cloned, typeof original>>(true);
      assertNotStrictEquals(cloned, original);
      assertNotStrictEquals(cloned.a, original.a);
      assertNotStrictEquals(cloned.b, original.b);

      assertEquals(cloned.a, { x: 1 });
      assertEquals(cloned.b, { x: 1 });

      /* without shared-reference caching, each occurrence is cloned independently */
      cloned.a.x = 999;
      assertStrictEquals(shared.x, 1);
      assertNotStrictEquals(cloned.a, cloned.b);
    },
  );

  await t.step(
    "clone(arrayWithSharedReferences) -> shared sub-objects in arrays are independently cloned",
    () => {
      const shared = { value: "original" };
      const original = [shared, shared, shared];

      const cloned = clone(original);

      assertNotStrictEquals(cloned, original);

      for (let i = 0; i < original.length; i++) {
        assertNotStrictEquals(cloned[i], original[i]);
        assertEquals(cloned[i], { value: "original" });
      }

      (cloned[0] as Record<string, unknown>).value = "mutated";
      assertStrictEquals(shared.value, "original");
      assert(cloned.every((item) => item.value === "mutated"));
    },
  );

  await t.step(
    "clone(nestedSharedRefs) -> deeply nested shared references are independently cloned",
    () => {
      const shared = { data: [1, 2, 3] };
      const original = {
        level1: {
          left: shared,
          right: shared,
        },
      };

      const cloned = clone(original);

      assertNotStrictEquals(cloned.level1.left, original.level1.left);
      assertNotStrictEquals(cloned.level1.right, original.level1.right);
      assertEquals(cloned.level1.left, { data: [1, 2, 3] });
      assertEquals(cloned.level1.right, { data: [1, 2, 3] });

      cloned.level1.left.data = [];
      assertEquals(cloned.level1.right.data, []);
      assertEquals(shared.data, [1, 2, 3]);
    },
  );

  await t.step(
    "clone(deepDataClass) -> WARNING: type hole! deep inheritance chain beyond depth limit degrades",
    () => {
      class L0 {
        value = { a: 42 };
      }
      class L1 extends L0 {}
      class L2 extends L1 {}
      class L3 extends L2 {}
      class L4 extends L3 {}
      class L5 extends L4 {}
      class L6 extends L5 {}
      class L7 extends L6 {}
      class L8 extends L7 {}
      class L9 extends L8 {}
      class L10 extends L9 {}
      class L11 extends L10 {}
      class L12 extends L11 {}
      class L13 extends L12 {}
      class L14 extends L13 {}
      class L15 extends L14 {}
      class L16 extends L15 {}

      const original = new L16();
      /* with the default limit the return type suggests that the data class was cloned */
      const cloned = clone(original);
      const cloned2 = clone(original, { depth: 17 });

      assertType<IsExact<typeof cloned, typeof cloned2>>(true);
      /* verifies the hole :( */
      assertThrows(() => {
        assertNotStrictEquals(cloned, original);
      });
      assertNotStrictEquals(cloned2, original);
    },
  );

  await t.step(
    "clone(deepCustomClass) -> deep inheritance chain beyond depth limit degrades gracefully",
    () => {
      class L0 {
        #value = { a: 42 };
        greet() {
          return "hi";
        }
      }
      class L1 extends L0 {}
      class L2 extends L1 {}
      class L3 extends L2 {}
      class L4 extends L3 {}
      class L5 extends L4 {}
      class L6 extends L5 {}
      class L7 extends L6 {}
      class L8 extends L7 {}
      class L9 extends L8 {}
      class L10 extends L9 {}
      class L11 extends L10 {}
      class L12 extends L11 {}
      class L13 extends L12 {}
      class L14 extends L13 {}
      class L15 extends L14 {}
      class L16 extends L15 {}

      const original = new L16();
      /* with the default limit, L0 can't be reached. therefore conservatively returned via Ref */
      const cloned = clone(original);
      const cloned2 = clone(original, { depth: 17 });

      assertType<IsExact<typeof cloned, Ref<L16>>>(true);
      assertType<IsExact<typeof cloned, typeof cloned2>>(true);
      assertStrictEquals(cloned, original);
      assertStrictEquals(cloned2, original);
      assertStrictEquals(cloned, cloned2);
    },
  );

  await t.step(
    "clone() -> depth limits fallback path for containers with non-cloneable values",
    () => {
      let nested: unknown[] = [() => 42];
      for (let i = 0; i < 5; i++) {
        nested = [nested];
      }

      const cloned = clone(nested, { depth: 3 });

      assertNotStrictEquals(cloned, nested);
      assertNotStrictEquals((cloned as any)[0][0], (nested as any)[0][0]);

      /* at this depth it is ref'd */
      assertStrictEquals((cloned as any)[0][0][0], (nested as any)[0][0][0]);
      assertEquals(cloned, nested);
    },
  );

  await t.step(
    "clone() -> depth is clamped to 500 on the fallback path",
    () => {
      let nested: unknown[] = [() => 42];
      for (let i = 0; i < 500; i++) {
        nested = [nested];
      }

      const cloned = clone(nested, { depth: 999 });

      let currentOriginal: any = nested;
      let currentClone: any = cloned;
      for (let i = 0; i < 500; i++) {
        assertNotStrictEquals(currentClone, currentOriginal);
        currentOriginal = currentOriginal[0];
        currentClone = currentClone[0];
      }

      /* at this depth it is ref'd */
      assertStrictEquals(currentClone, currentOriginal);
    },
  );

  await t.step(
    "clone(nestedObject, { transfer }) -> ArrayBuffer nested in plain objects is transferred",
    () => {
      const buf = new ArrayBuffer(4);
      new Uint8Array(buf).set([1, 2, 3, 4]);

      const original = { outer: { inner: { buffer: buf } } };
      const cloned = clone(original, { transfer: [buf] });
      const clonedBuf = cloned.outer.inner.buffer;

      assertNotStrictEquals(cloned, original);
      assertNotStrictEquals(cloned.outer, original.outer);
      assertNotStrictEquals(cloned.outer.inner, original.outer.inner);

      assert(clonedBuf instanceof ArrayBuffer);
      assertStrictEquals(clonedBuf.byteLength, 4);
      assertEquals([...new Uint8Array(clonedBuf)], [1, 2, 3, 4]);
      assertStrictEquals(buf.byteLength, 0);
    },
  );

  await t.step(
    "clone(array, { transfer }) -> ArrayBuffer nested in arrays is transferred",
    () => {
      const buf = new ArrayBuffer(4);
      new Uint8Array(buf).set([1, 2, 3, 4]);

      const original = [1, "hello", [buf]];
      const cloned = clone(original, { transfer: [buf] });
      const clonedBuf = (cloned[2] as ArrayBuffer[])[0];

      assertNotStrictEquals(cloned, original);
      assert(clonedBuf instanceof ArrayBuffer);
      assertStrictEquals(clonedBuf.byteLength, 4);
      assertEquals([...new Uint8Array(clonedBuf)], [1, 2, 3, 4]);
      assertStrictEquals(buf.byteLength, 0);
    },
  );

  await t.step(
    "clone(map, { transfer }) -> ArrayBuffer in Map values is transferred",
    () => {
      const buf = new ArrayBuffer(4);
      new Uint8Array(buf).set([1, 2, 3, 4]);

      const original = new Map<string, unknown>([
        ["name", "test"],
        ["buffer", buf],
      ]);
      const cloned = clone(original, { transfer: [buf] });
      const clonedBuf = cloned.get("buffer") as unknown as ArrayBuffer;

      assertNotStrictEquals(cloned, original);
      assert(clonedBuf instanceof ArrayBuffer);
      assertStrictEquals(clonedBuf.byteLength, 4);
      assertEquals([...new Uint8Array(clonedBuf)], [1, 2, 3, 4]);
      assertStrictEquals(buf.byteLength, 0);
    },
  );

  await t.step(
    "clone(complexHierarchy) -> deep clones what's possible and refs the rest",
    () => {
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

      assertNotStrictEquals(unref(cloned), original);
      assertStrictEquals(cloned, cloned.circularRef);
      assertStrictEquals(uintArray.buffer.byteLength, 0);
      assertStrictEquals(cloned.ref, original.ref);
    },
  );
});

/*
 ********************************************************************
 * clone
 ********************************************************************
 */

const DEFAULT_DEPTH = 16;
const MAX_DEPTH = 500;

const PROTO_KEY = "__proto__";

export interface CloneOptions extends StructuredSerializeOptions {
  /**
   * Maximum recursion depth for the element-by-element clone
   * path (containers/objects containing non trivially cloneable elememts).
   *
   * @default 16
   * max: 500 (Typescript's type inference limit)
   *
   * When the limit is reached, remaining values are returned by
   * reference (Ref) instead of being cloned further.
   */
  depth?: number;
  /**
   * Wheter or not shared and circular refrences should be preserved.
   *
   * @default true
   *
   * In practice, this adds overhead for the caching of individual
   * refrences, after they have been initially cloned.
   * On the other hand, it reduces the actual amount of work.
   * In the presence of a high number of shared references.
   */
  preserveRefs?: boolean;
}

/**
 * Use this to clone `T` -> `Cloned<T>`
 *
 * Any value returned via `Ref<T>` indicates that the value was not cloned,
 * but returned by reference.
 *
 * This implementation handles shared and circular references by default.
 * You can opt out of this behaviour by setting `{ preserveRefs: false }`
 * in the options.
 *
 * The default recursion depth is 16. The maximum configurable depth is 500.
 * Everything past this limit gets returned by reference.
 *
 * @linkcode {CloneOptions}
 *
 * High level flow:
 *  1. Primitives / null / undefined  — returned by value.
 *  2. Functions / symbols            — returned by reference (Ref)
 *  3. `Cloneable` (has `[Clone]`)    — delegates to the protocol
 *  4. Plain records                  — property-by-property
 *  5. Containers (Array, Map, Set)   — element-by-element
 *  6. Errors                         — returned by reference (Ref)
 *  7. Custom classes with methods    — returned by reference (Ref)
 *  8. Builtins & data classes        — `structuredClone`
 */
export function clone<T>(
  value: T,
  opts?: CloneOptions,
): Cloned<T> {
  const maxDepth = Math.min(opts?.depth ?? DEFAULT_DEPTH, MAX_DEPTH);
  const cache = opts?.preserveRefs === false ? undefined : new WeakMap();

  return cloneIter(value, maxDepth, opts, cache);
}

function cloneIter<T>(
  value: T,
  limit: number,
  opts?: CloneOptions,
  cache?: WeakMap<object, unknown>,
): Cloned<T> {
  if (value == null || typeof value !== "object") return value as Cloned<T>;

  /* in case of shared references, this points to the clone */
  const cached = cache?.get(value);
  if (cached != null) return cached as Cloned<T>;

  /* Leave this right here, otherwise the types won't make sense! */
  if (isInherentlyCloneable(value)) {
    const cloned = value[Clone](opts);
    cache?.set(value, cloned);

    return cloned as Cloned<T>;
  }

  if (limit <= 0) return value as Cloned<T>;

  const proto = Object.getPrototypeOf(value);
  const ctor = proto?.constructor;

  if (proto === Object.prototype || proto === null) {
    const cloned: Record<PropertyKey, unknown> = {};

    cache?.set(value, cloned);

    for (const key in value) {
      if (key === PROTO_KEY) continue; /* potential prototype poisoning */
      const v = value[key];
      cloned[key] = (v == null || typeof v !== "object")
        ? v
        : cloneIter(v, limit - 1, opts, cache);
    }

    return cloned as Cloned<T>;
  }

  if (Array.isArray(value)) {
    if (ctor !== Array) return value as Cloned<T>;

    const len = value.length;
    const cloned = new Array(len);
    cache?.set(value, cloned);

    for (let i = 0; i < len; i++) {
      const v = value[i];
      cloned[i] = (v == null || typeof v !== "object")
        ? v
        : cloneIter(v, limit - 1, opts, cache);
    }

    return cloned as Cloned<T>;
  }

  if (value instanceof Map) {
    if (ctor !== Map) return value as Cloned<T>;

    const cloned = new Map();
    cache?.set(value, cloned);

    for (const [k, v] of value) {
      cloned.set(
        cloneIter(k, limit - 1, opts, cache),
        cloneIter(v, limit - 1, opts, cache),
      );
    }

    return cloned as Cloned<T>;
  }

  if (value instanceof Set) {
    if (ctor !== Set) return value as Cloned<T>;

    const cloned = new Set();
    cache?.set(value, cloned);

    for (const v of value) {
      cloned.add(cloneIter(v, limit - 1, opts, cache));
    }

    return cloned as Cloned<T>;
  }

  if (value instanceof Error) return value as Cloned<T>;

  if (proto !== Object.prototype) {
    if (ctor === Date) {
      const cloned = new Date(value as unknown as Date);
      cache?.set(value, cloned);

      return cloned as Cloned<T>;
    }
    if (
      !isStructuredCloneableCtor(ctor) && hasCustomMethods(proto, limit)
    ) {
      cache?.set(value, value);

      return value as Cloned<T>;
    }
  }

  try {
    const result = structuredClone(value, opts);
    cache?.set(value, result);

    return result as Cloned<T>;
  } catch {
    cache?.set(value, value);

    /* Ref fallback for values we can't clone (e.g. WeakMap) */
    return value as Cloned<T>;
  }
}

/*
 ********************************************************************
 * clone protocol
 ********************************************************************
 */

/**
 * Use this to implement the typed-clone protocol for custom types.
 *
 * @example
 * ```typescript
 * import { assert } from "@std/assert";
 * import { Clone, clone } from "@aedge-io/typed-clone";
 *
 * class MyFancyClass {
 *   constructor(
 *   readonly name: string,
 *   private score: number,
 *   private isFancy: boolean,
 *   ) {}
 *
 *   [Clone]() {
 *     return new MyFancyClass(
 *       this.name,
 *       this.score,
 *       this.isFancy,
 *     );
 *   }
 * }
 *
 * const fancy = new MyFancyClass("totally", 9001, true);
 * const cloned = clone(fancy) // infers `MyFancyClass`;
 *
 * assert(fancy !== cloned);
 * assert(fancy.name === cloned.name);
 * ```
 */
export const Clone = Symbol("@aedge-io/typed-clone");

export interface Cloneable<T = unknown> {
  [Clone](options?: CloneOptions): T;
}

export type InherentlyCloned<T> = T extends Cloneable<infer C> ? C : never;

/**
 * Use this to check at run-time if a given value supports the typed-clone
 * protocol.
 */
export function isInherentlyCloneable<T extends object>(
  value: T,
): value is T & Cloneable {
  //deno-lint-ignore no-explicit-any
  return typeof (value as any)[Clone] === "function";
}

/*
 ********************************************************************
 * types
 ********************************************************************
 */

declare const RefMarker: unique symbol;

/**
 * Marks a given type `T` as `Ref<T>`
 */
export type Ref<T extends unknown> = { readonly [K in keyof T]: T[K] } & {
  readonly [RefMarker]: true;
};

/**
 * Use this to cast a value of type `T` to `Ref<T>`
 *
 * Plain identity function. Often optimized away at run-time.
 */
export function ref<T>(value: T): Ref<T> {
  return value as Ref<T>;
}

/**
 * Removes all Ref markers from a given type
 */
export type Unref<R> = R extends Ref<infer T> ? Unref<T>
  : R extends Record<PropertyKey, unknown>
    ? { [K in keyof R as Unref<K>]: Unref<R[K]> }
  : R extends ReadonlyArray<infer T>
    ? number extends R["length"] ? R extends Array<T> ? Array<Unref<T>>
      : ReadonlyArray<Unref<T>>
    : { [K in keyof R]: Unref<R[K]> }
  : R extends ReadonlyMap<infer K, infer V>
    ? R extends Map<K, V> ? Map<Unref<K>, Unref<V>>
    : ReadonlyMap<Unref<K>, Unref<V>>
  : R extends ReadonlySet<infer V> ? R extends Set<V> ? Set<Unref<V>>
    : ReadonlySet<Unref<V>>
  : R;

/**
 * Use this to remove all `Ref` markers from a given type `R`
 *
 * Mostly useful when dealing with union types, where a subset was cast
 * to `Ref` and the distinction is not relevant.
 *
 * Plain identity function. Often optimized away at run-time.
 */
export function unref<R>(value: R): Unref<R> {
  return value as Unref<R>;
}

type Primitive =
  | string
  | number
  | boolean
  | bigint
  | symbol;

type StructuredCloneableBuiltin =
  | Date
  | RegExp
  | ArrayBuffer
  | SharedArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array
  | Blob
  | File;
/* | Error : Excluded. Currently impossible to get this right with custom errors */
/* | Array | Set | Map : Excluded as they are handled seperately */

type NotCloneable =
  | symbol
  //deno-lint-ignore ban-types
  | Function
  | WeakMap<WeakKey, unknown>
  | WeakSet<WeakKey>
  | WeakRef<WeakKey>
  | Promise<unknown>
  | Generator
  | AsyncGenerator;

type MappedRecord<T> = { [K in keyof T]: T[K] };

type RecordLike<T> = T extends MappedRecord<T>
  ? MappedRecord<T> extends T ? T : never
  : never;

/**
 * The cloned representation of `T`
 *
 * Values which can't be cloned, get returned as `Ref<T>`
 * This is a pure marker type, without run-time overhead
 */
export type Cloned<T> = T extends Exclude<Primitive, symbol> ? T
  : T extends Cloneable<unknown> ? InherentlyCloned<T>
  : T extends Error ? Ref<T>
  : T extends ReadonlyArray<infer V>
    ? (number extends T["length"]
      ? (Array<V> extends T ? { [K in keyof T]: Cloned<T[K]> } : Ref<T>)
      : { [K in keyof T]: Cloned<T[K]> }) /* tuples: always clone */
  : T extends Map<infer K, infer V>
    ? (Map<K, V> extends T ? Map<Cloned<K>, Cloned<V>> : Ref<T>)
  : T extends Set<infer V> ? (Set<V> extends T ? Set<Cloned<V>> : Ref<T>)
  : T extends StructuredCloneableBuiltin ? T
  : T extends NotCloneable ? Ref<T>
  : T extends RecordLike<T>
    ? { [K in keyof T as K extends symbol ? never : K]: Cloned<T[K]> }
  : Ref<T>;

/*
 ********************************************************************
 * helpers
 ********************************************************************
 */

/**
 * natively supported by `structuredClone`
 */
const STRUCTURED_CLONEABLE_CTORS: ReadonlySet<unknown> = new Set(
  [
    RegExp,
    ArrayBuffer,
    DataView,
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    typeof SharedArrayBuffer !== "undefined" ? SharedArrayBuffer : null,
    typeof Blob !== "undefined" ? Blob : null,
    typeof File !== "undefined" ? File : null,
  ].filter(Boolean),
);

function isStructuredCloneableCtor(ctor: unknown): boolean {
  return STRUCTURED_CLONEABLE_CTORS.has(ctor);
}

function hasCustomMethods(proto: object | null, limit: number): boolean {
  let current = proto;
  let remaining = limit;

  while (current !== null && current !== Object.prototype && remaining > 0) {
    const names = Object.getOwnPropertyNames(current);
    for (let i = 0; i < names.length; i++) {
      if (names[i] === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(current, names[i])!;
      if (
        typeof desc.value === "function"
        || desc.get !== undefined
        || desc.set !== undefined
      ) {
        return true;
      }
    }
    current = Object.getPrototypeOf(current);
    remaining -= 1;
  }

  /* in case the limit is exhausted, presence of methods is assumed */
  return current !== null && current !== Object.prototype;
}

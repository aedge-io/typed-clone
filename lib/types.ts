/*
 ********************************************************************
 * clone protocol and helpers
 ********************************************************************
 */

declare const Clone: unique symbol;

/**
 * The type identity of the clone protocol symbol.
 *
 * The runtime symbol is defined and exported from `./clone.ts`.
 */
export type CloneKey = typeof Clone;

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
   * Given a high number of shared refrences.
   */
  preserveRefs?: boolean;
}

export interface Cloneable<T = unknown> {
  [Clone](options?: CloneOptions): T;
}

export type InherentlyCloned<T> = T extends Cloneable<infer C> ? C : never;

/*
 ********************************************************************
 * clone types
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

type Primitive =
  | string
  | number
  | boolean
  | bigint
  | symbol;

export type StructuredCloneableBuiltin =
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

export type NotCloneable =
  | symbol
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

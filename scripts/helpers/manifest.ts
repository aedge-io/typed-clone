import { panic, Task } from "@aedge-io/grugway";
import { parse, type RootNode } from "@david/jsonc-morph";
import type { Path } from "project/shell";
import type { SemVer } from "project/version";
import { format, tryParse } from "project/version";

/**
 * Single-use in-memory representation of deno.jsonc manifest file
 * shamefully panics if any invariants are violated
 */

export class Manifest {
  #path: Path;
  #root: ReturnType<typeof parse>;

  private constructor(path: Path, root?: RootNode) {
    this.#path = path;
    this.#root = root ?? parse(path.readTextSync());
  }

  static async loadFrom(path: Path): Promise<Manifest> {
    const jsonc = await path.readText();
    return new Manifest(path, parse(jsonc));
  }

  public get name(): string {
    return this.#root.asObjectOrThrow().getOrThrow("name").valueOrThrow()
      .asStringOrThrow();
  }

  public get description(): string {
    return this.#root.asObjectOrThrow().getOrThrow("description").valueOrThrow()
      .asStringOrThrow();
  }

  public get version(): SemVer {
    const versionStr = this.#root.asObjectOrThrow().getOrThrow("version")
      .valueOrThrow()
      .asStringOrThrow();

    return tryParse(versionStr).unwrapOrElse(panic);
  }

  /**
   * Creates a new instance by roundtripping ser/de
   */
  public withBumpedVersion(v: SemVer): Manifest {
    const newRoot = parse(this.#root.toString());
    newRoot.asObjectOrThrow().getOrThrow("version").setValue(format(v));
    return new Manifest(this.#path, newRoot);
  }

  /**
   * After this operation `Manifest` is not useable anymore
   */
  public flush() {
    return Task.fromPromise(
      this.#path.writeText(this.#root.toString()).then(() => {}),
      (e) => Error(`failed to flush deno.jsonc manifest`, { cause: e }),
    );
  }
}

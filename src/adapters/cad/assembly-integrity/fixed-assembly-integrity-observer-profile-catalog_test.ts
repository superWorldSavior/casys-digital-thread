import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  ASSEMBLY_INTEGRITY_OBSERVER_PROFILE,
  FixedAssemblyIntegrityObserverProfileCatalog,
} from "./fixed-assembly-integrity-observer-profile-catalog.ts";

Deno.test("the fixed assembly-integrity observer profile requires mcp-build123d 0.7.1", async () => {
  const catalog = new FixedAssemblyIntegrityObserverProfileCatalog({
    imageDigest: { algorithm: "sha256", digest: "a".repeat(64) },
  });

  const profile = await catalog.resolve(ASSEMBLY_INTEGRITY_OBSERVER_PROFILE);

  assertEquals(profile.producer.package, {
    id: "mcp-build123d",
    version: "0.7.1",
  });
});

import { assertEquals } from "@std/assert";
import {
  compareEngineeringCaseIssues,
  compareEngineeringCases,
  type EngineeringCase,
  type EngineeringCaseFamily,
  projectCurrentEngineeringCases,
  verificationCaseKey,
} from "./evidence.ts";

const CAMERA_ID = "id01-camera-bracket-bench";
const RADIAL_ID = "id01-radial-arm-bench";
const CAMERA_TARGET = "e9f1d48b-666d-48ff-af6c-abf74646b68e";
const RADIAL_TARGET = "444df600-019b-45d5-ac36-617ff0a0f791";
/** Swedish/German collation can reverse these; UTF-16 code units keep `z` first. */
const Z_ID = "z-bench";
const A_UMLAUT_ID = "ä-bench";

Deno.test(
  "engineering case current selects Camera r3 and a distinct RadialArm r2",
  () => {
    const cameraR1 = mechanicalCase(
      CAMERA_ID,
      1,
      "a",
      "camera-r1",
      CAMERA_TARGET,
    );
    const cameraR3 = mechanicalCase(
      CAMERA_ID,
      3,
      "c",
      "camera-r3",
      CAMERA_TARGET,
    );
    const radial = mechanicalCase(RADIAL_ID, 2, "d", "radial", RADIAL_TARGET);
    const projected = projectCurrentEngineeringCases([
      cameraR3,
      radial,
      cameraR1,
    ]);

    assertEquals(projected.current, [{
      family: "mechanical-proof",
      id: CAMERA_ID,
      currentCaseKey: cameraR3.key,
      revision: 3,
    }, {
      family: "mechanical-proof",
      id: RADIAL_ID,
      currentCaseKey: radial.key,
      revision: 2,
    }]);
    assertEquals(projected.issues, []);
  },
);

Deno.test(
  "engineering case current order is code-unit order, not locale collation",
  () => {
    const umlaut = mechanicalCase(A_UMLAUT_ID, 1, "a", "umlaut");
    const zed = mechanicalCase(Z_ID, 1, "b", "zed");
    assertEquals(Z_ID < A_UMLAUT_ID, true);
    assertEquals(
      projectCurrentEngineeringCases([umlaut, zed]).current.map((item) => item.id),
      [Z_ID, A_UMLAUT_ID],
    );
    assertEquals(
      [umlaut, zed].toSorted(compareEngineeringCases).map((item) => item.id),
      [Z_ID, A_UMLAUT_ID],
    );
  },
);

Deno.test(
  "engineering case current fail-closed omits a conflicting Camera group and keeps RadialArm",
  () => {
    const cameraA = mechanicalCase(
      CAMERA_ID,
      1,
      "a",
      "camera-a",
      CAMERA_TARGET,
    );
    const cameraB = mechanicalCase(
      CAMERA_ID,
      1,
      "b",
      "camera-b",
      CAMERA_TARGET,
    );
    const radial = mechanicalCase(RADIAL_ID, 2, "d", "radial", RADIAL_TARGET);
    const projected = projectCurrentEngineeringCases([
      cameraB,
      radial,
      cameraA,
    ]);

    assertEquals(projected.current, [{
      family: "mechanical-proof",
      id: RADIAL_ID,
      currentCaseKey: radial.key,
      revision: 2,
    }]);
    assertEquals(
      projected.issues,
      [
        currentIssue(cameraA.authorityArtifactIds[0]!),
        currentIssue(cameraB.authorityArtifactIds[0]!),
      ].toSorted(compareEngineeringCaseIssues),
    );
  },
);

Deno.test(
  "engineering case current fail-closed omits Camera current when r1 is duplicated",
  () => {
    const cameraR1a = mechanicalCase(
      CAMERA_ID,
      1,
      "a",
      "camera-r1a",
      CAMERA_TARGET,
    );
    const cameraR1b = mechanicalCase(
      CAMERA_ID,
      1,
      "b",
      "camera-r1b",
      CAMERA_TARGET,
    );
    const cameraR3 = mechanicalCase(
      CAMERA_ID,
      3,
      "c",
      "camera-r3",
      CAMERA_TARGET,
    );
    const projected = projectCurrentEngineeringCases([
      cameraR3,
      cameraR1a,
      cameraR1b,
    ]);

    assertEquals(projected.current, []);
    assertEquals(projected.issues.length, 3);
    assertEquals(
      projected.issues.map((item) => item.reason),
      [
        "case-current-divergent",
        "case-current-divergent",
        "case-current-divergent",
      ],
    );
  },
);

Deno.test(
  "engineering case current fail-closed omits incompatible mechanical targets as a group",
  () => {
    const camera = mechanicalCase(CAMERA_ID, 1, "a", "camera", CAMERA_TARGET);
    const otherTarget = mechanicalCase(
      CAMERA_ID,
      3,
      "c",
      "other",
      RADIAL_TARGET,
    );
    const projected = projectCurrentEngineeringCases([otherTarget, camera]);

    assertEquals(projected.current, []);
    assertEquals(
      projected.issues.map((item) => item.reason),
      ["case-current-divergent", "case-current-divergent"],
    );
  },
);

Deno.test(
  "engineering case current supports all six families in code-unit order",
  () => {
    const cases = [
      familyCase("sensitivity-study", "study-a", 1, "1"),
      familyCase("mechanical-proof", "proof-a", 2, "2"),
      familyCase("printability-check", "print-a", 1, "3"),
      familyCase("dfm-check", "dfm-a", 4, "4"),
      familyCase("print-estimate", "estimate-a", 3, "5"),
      familyCase("pre-sizing-worksheet", "sheet-a", 1, "6"),
    ];
    const projected = projectCurrentEngineeringCases(cases);
    assertEquals(
      projected.current.map((item) => item.family),
      [
        "dfm-check",
        "mechanical-proof",
        "pre-sizing-worksheet",
        "print-estimate",
        "printability-check",
        "sensitivity-study",
      ],
    );
    assertEquals(
      projected.current.map((item) => item.revision),
      [4, 2, 1, 3, 1, 1],
    );
    assertEquals(projected.issues, []);
  },
);

function mechanicalCase(
  id: string,
  revision: number,
  digestDigit: string,
  authoritySuffix: string,
  target?: string,
): EngineeringCase {
  const caseDigest = digestDigit.repeat(64);
  return {
    key: verificationCaseKey("mechanical-proof", caseDigest),
    family: "mechanical-proof",
    caseSchemaVersion: "mechanical-proof-case/1.0",
    id,
    revision,
    scope: `${id} r${revision}`,
    caseDigest,
    authorityArtifactIds: [`fea-proof-${authoritySuffix}`],
    ...(target === undefined ? {} : { target: { modelElementId: target } }),
  };
}

function familyCase(
  family: EngineeringCaseFamily,
  id: string,
  revision: number,
  digestDigit: string,
): EngineeringCase {
  const caseDigest = digestDigit.repeat(64);
  const key = verificationCaseKey(family, caseDigest);
  const common = {
    key,
    id,
    revision,
    scope: `${id} r${revision}`,
    caseDigest,
    authorityArtifactIds: [`${family}-${digestDigit}`],
  };
  switch (family) {
    case "mechanical-proof":
      return {
        ...common,
        family,
        caseSchemaVersion: "mechanical-proof-case/1.0",
      };
    case "sensitivity-study":
      return {
        ...common,
        family,
        caseSchemaVersion: "sensitivity-study-case/3.0",
      };
    case "printability-check":
      return {
        ...common,
        family,
        caseSchemaVersion: "printability-check-case/1.0",
      };
    case "print-estimate":
      return {
        ...common,
        family,
        caseSchemaVersion: "print-estimate-case/1.0",
      };
    case "dfm-check":
      return {
        ...common,
        family,
        caseSchemaVersion: "dfm-check-case/1.0",
      };
    case "pre-sizing-worksheet":
      return {
        ...common,
        family,
        caseSchemaVersion: "pre-sizing-worksheet/1.0",
        title: `${id} r${revision}`,
        recording: { status: "recorded", authorKind: "agent" },
        quantities: [],
        sources: [],
      };
  }
}

function currentIssue(authorityArtifactId: string) {
  return {
    family: "mechanical-proof" as const,
    authorityArtifactId,
    status: "error" as const,
    reason: "case-current-divergent" as const,
  };
}

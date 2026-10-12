import test from "node:test";
import assert from "node:assert/strict";
import { verificationPassed } from "../scripts/verification-gates.mjs";
const passed = () => ({ candidateFingerprint: "a", candidateFinalFingerprint: "a",
  evaluatorFingerprint: "b", evaluatorFinalFingerprint: "b", simulatorFingerprint: "c", simulatorFinalFingerprint: "c",
  cases: [{ exitCode: 0 }, { exitCode: 0, tests: { tests: 4, fail: 0, cancelled: 0, skipped: 0, todo: 0 } },
    { exitCode: 0 }, { exitCode: 0, tests: { tests: 6, fail: 0, cancelled: 0, skipped: 0, todo: 0 } }] });
test("verification rejects source edits in any of the three tested layers", () => {
  assert.equal(verificationPassed(passed()), true);
  for (const kind of ["candidate", "evaluator", "simulator"]) {
    assert.equal(verificationPassed({ ...passed(), [kind + "FinalFingerprint"]: "changed" }), false);
    assert.equal(verificationPassed({ ...passed(), [kind + "FinalFingerprint"]: undefined }), false);
  }
});
test("verification requires executed passing suites without omitted checks", () => {
  for (const flag of ["fail", "cancelled", "skipped", "todo"]) {
    const report = passed(); report.cases[1].tests[flag] = 1;
    assert.equal(verificationPassed(report), false);
  }
  const report = passed(); report.cases[1].tests.tests = 0;
  assert.equal(verificationPassed(report), false);
  assert.equal(verificationPassed({ ...passed(), cases: [] }), false);
});

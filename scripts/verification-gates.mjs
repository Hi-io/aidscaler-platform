export function verificationPassed(report) {
  return ["candidate", "evaluator", "simulator"].every(kind =>
    typeof report[kind + "Fingerprint"] === "string" &&
    typeof report[kind + "FinalFingerprint"] === "string" &&
    report[kind + "Fingerprint"] === report[kind + "FinalFingerprint"],
  ) && report.cases.length >= 4 && report.cases.every(c =>
    c.exitCode === 0 && (!c.tests || c.tests.tests > 0 &&
      c.tests.fail === 0 && c.tests.cancelled === 0 && c.tests.skipped === 0 && c.tests.todo === 0),
  );
}

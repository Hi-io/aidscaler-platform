import { check } from "./errors.mjs";
// A basic disclosure guard, not a complete personal-data detector. A person
// must still review captions, locations, faces and context before publishing.
export function publicText(...values) {
  check(
    values.every(
      (v) =>
        typeof v === "string" &&
        !/\bsk-or-|api[\s_-]?key|\bpassword\b|\baccess[\s_-]?token\b|\bprivate[\s_-]?key\b/i.test(
          v,
        ),
    ),
    "PUBLIC_DATA",
    "Remove credentials or restricted details before publication.",
  );
}

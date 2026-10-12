/** A valid JSON preview, with explicit omissions. Full records remain in the
 * audit store and source system; this does not claim every record was read. */
export function boundedContext(
  value,
  { arrayLimit = 40, keyLimit = 60, stringLimit = 6000, depth = 0 } = {},
) {
  if (typeof value === "string")
    return value.length > stringLimit
      ? value.slice(0, stringLimit) + " [truncated; open original source]"
      : value;
  if (value == null || typeof value !== "object") return value;
  if (depth >= 8)
    return {
      omitted: true,
      reason: "Nested record preview limit; read the scoped source.",
    };
  const next = { arrayLimit, keyLimit, stringLimit, depth: depth + 1 };
  if (Array.isArray(value))
    return value.slice(0, arrayLimit).map((x) => boundedContext(x, next));
  const keys = Object.keys(value),
    result = {};
  for (const key of keys.slice(0, keyLimit)) {
    result[key] = boundedContext(value[key], next);
    if (Array.isArray(value[key]) && value[key].length > arrayLimit)
      result[key + "TotalAvailable"] = value[key].length;
  }
  if (keys.length > keyLimit) result.omittedFields = keys.length - keyLimit;
  return result;
}

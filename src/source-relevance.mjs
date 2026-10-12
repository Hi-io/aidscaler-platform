/** A narrow cost-saving reconciliation, never a truth filter. Public statements
 * are not authority: an independently received physical receipt must already
 * exist. Any additional wording, ambiguity or changed location stays available
 * for semantic/manual review. No private simulator labels are consulted. */
export function receivedProgressReference(source, operations = []) {
  if (
    !source ||
    source.deleted ||
    source.state === "erased" ||
    !source.location ||
    !Number.isFinite(source.publishedAt)
  )
    return null;
  const match = String(source.text ?? "")
    .trim()
    .match(
      /^The receiving team confirms (\d+(?:\.\d+)?) (L|litres?|liters?|portions?|units?|persons?|places?) of (water|food|blankets|medicine|energy|sanitation|staff|shelter)\.$/i,
    );
  if (!match) return null;
  const quantity = Number(match[1]),
    type = match[3].toLowerCase(),
    canonical = {
      water: ["l", "litre", "litres", "liter", "liters"],
      food: ["portion", "portions"],
      staff: ["person", "persons"],
      shelter: ["place", "places"],
    },
    unit = match[2].toLowerCase();
  if (!(canonical[type] ?? ["unit", "units"]).includes(unit) || quantity <= 0)
    return null;
  const matches = operations.filter(
    (o) =>
      o.confirmedBySource === true &&
      ["received", "completed"].includes(o.state) &&
      o.resourceType === type &&
      (o.building ?? o.sourceSnapshot?.building) === source.location &&
      o.received === quantity &&
      Number.isFinite(o.times?.received) &&
      o.times.received <= source.publishedAt &&
      Number.isFinite(o.observedAt ?? o.sourceObservedAt) &&
      (o.observedAt ?? o.sourceObservedAt) >= o.times.received,
  );
  const distinct = new Map(
    matches.map((o) => [
      JSON.stringify([o.owner ?? o.org, o.sourceId ?? o.id]),
      o,
    ]),
  );
  if (distinct.size !== 1) return null;
  const operation = [...distinct.values()][0];
  return {
    operationId: operation.id,
    owner: operation.owner ?? operation.org,
    sourceOperationId: operation.sourceId ?? operation.id,
    sourceVersion: source.sourceVersion ?? source.version ?? 1,
    quantity,
    resourceType: type,
    physicalReceiptAt: operation.times.received,
    disposition: "public_progress_already_has_received_physical_receipt",
    note: "Public text is retained as unverified. This correlation changes no demand, authority or physical outcome.",
  };
}

/** Only a very narrow pure support/admin message can avoid automatic reading.
 * A media attachment or any operational wording keeps it in the review queue.
 * The public record remains visible and unverified, never evidence of no need. */
export function routinePublicCommentary(source) {
  if (
    !source ||
    source.deleted ||
    source.state === "erased" ||
    source.attachments?.length
  )
    return null;
  const text = String(source.text ?? "").trim();
  if (
    /\b(?:need|needs|needed|request|shortfall|help|emergency|trapped|collapsed|injured|dead|fire|flood|blocked|missing|without|water|food|blankets?|medicine|power|electricity|shelter|evacuated|supplies|transport|hungry|freezing)\b/i.test(
      text,
    )
  )
    return null;
  if (
    !/^(?:Thinking of|Sending (?:love|strength|encouragement) to) (?:the )?(?:families|people|community) (?:at|in) [\w .'-]{1,80}\.\s*(?:Please keep sharing original updates, not private contact details\.)?$/i.test(
      text,
    )
  )
    return null;
  return {
    sourceVersion: source.sourceVersion ?? source.version ?? 1,
    disposition: "routine_public_commentary_unverified",
    note: "Pure support/admin wording is retained for manual review. It is not a fact, a discarded need or evidence of safety.",
  };
}

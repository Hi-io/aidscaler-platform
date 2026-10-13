import { scopedReceivedEntities } from "./received-entities.mjs";

// A deliberately capable, cheap reference. It does not require canonical
// template IDs, nor reject contradictory rumors as false. All grounded road
// mentions can be checked by the same finite source channel as the model.
export async function conventionalSourceOpportunities(store, org, sources) {
  const result = [];
  for (const source of sources) {
    const directory = await scopedReceivedEntities(store, org, [source]);
    for (const entity of directory.entities) {
      const text = String(source.text ?? "");
      const current =
        /\b(today|tonight|right now|currently|latest|this morning|still|again)\b/i.test(
          text,
        );
      const archive =
        /\b(yesterday|last year|old (video|photo|clip)|archive|previous disaster)\b/i.test(
          text,
        );
      result.push({
        text: text.slice(0, 600),
        kind: entity.kind === "road" ? "restriction" : "capacity",
        sourceIds: [source.id],
        location: entity.kind === "building" ? entity.id : null,
        resourceType:
          entity.kind === "road" || entity.kind === "vehicle"
            ? "transport"
            : null,
        quantity: null,
        timeStatus: current ? "current" : archive ? "historical" : "unknown",
        entity: { kind: entity.kind, id: entity.id },
      });
    }
  }
  return result;
}

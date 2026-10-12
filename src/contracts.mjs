import { z } from "zod";
export const ACTIONS = [
  "dispatch",
  "reroute",
  "repair",
  "activate",
  "evacuate",
  "purchase",
  "commitment",
  "transfer",
  "cancel",
  "publish",
  "coverage",
  "record_outcome",
];
export const QUERIES = [
  "inventory",
  "vehicles",
  "roads",
  "map",
  "facility",
  "documents",
  "policy",
  "sources",
  "capabilities",
  "personnel",
  "team",
  "integrations",
  "received",
  "population",
  "forecasts",
  "finance",
  "memory",
];
export const fieldReport = z
  .object({
    clientId: z.string().min(3).max(180),
    text: z.string().min(1).max(6000),
    kind: z
      .enum(["need", "receipt", "road", "facility", "correction", "voice"])
      .default("need"),
    location: z.string().max(200).optional(),
    references: z.array(z.string()).max(20).default([]),
    observedAt: z.number().int().nonnegative(),
    quantity: z.number().nonnegative().optional(),
    unit: z.string().max(30).optional(),
  })
  .strict();
const ID = z.string().min(1).max(180),
  POS = z.number().int().positive();
const parameterSchemas = {
  dispatch: z
    .object({
      vehicle: ID,
      resource: ID,
      quantity: POS,
      need: ID.optional(),
      building: ID.optional(),
      destination: ID.optional(),
      commitment: ID.optional(),
      transfer: ID.optional(),
    })
    .strict(),
  activate: z.object({ building: ID, permit: z.boolean() }).strict(),
  reroute: z.object({ vehicle: ID, destination: ID }).strict(),
  repair: z.object({ edge: ID, engineering: z.boolean().optional() }).strict(),
  evacuate: z.object({ from: ID, to: ID, vehicle: ID, quantity: POS }).strict(),
  purchase: z
    .object({
      type: ID,
      quantity: POS,
      supplier: ID.optional(),
      price: z.number().nonnegative(),
      leadMs: z.number().int().nonnegative(),
      node: ID.optional(),
    })
    .strict(),
  commitment: z
    .object({
      action: z.enum([
        "offer",
        "reserve",
        "confirm",
        "withdraw",
        "release",
        "reject",
      ]),
      resource: ID.optional(),
      quantity: POS.optional(),
      id: ID.optional(),
      requester: ID.optional(),
      ttlMs: POS.optional(),
      conditions: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .strict(),
  transfer: z
    .object({
      action: z.enum(["offer", "accept", "reject", "return"]).optional(),
      resource: ID.optional(),
      quantity: POS.optional(),
      to: ID.optional(),
      id: ID.optional(),
      vehicle: ID.optional(),
      loan: z.boolean().optional(),
      returnBy: POS.optional(),
    })
    .strict(),
  cancel: z.object({ id: ID }).strict(),
  publish: z
    .object({
      text: z.string(),
      stage: z.string().optional(),
      operation: ID.optional(),
    })
    .strict(),
  coverage: z.object({}).strict(),
  record_outcome: z
    .object({
      summary: z.string(),
      references: z.array(ID).min(1),
      conditions: z.array(z.record(z.string(), z.unknown())),
    })
    .strict(),
};
export const actionSchema = z.discriminatedUnion(
  "type",
  Object.entries(parameterSchemas).map(([type, params]) =>
    z
      .object({
        type: z.literal(type),
        params,
        owner: ID,
        dependsOn: z.array(z.number().int().nonnegative()).default([]),
      })
      .strict(),
  ),
);
export const proposalSchema = z
  .object({
    title: z.string().min(3).max(150),
    summary: z.string().min(1).max(1200),
    benefit: z.string().min(1).max(400),
    references: z.array(z.string()).min(1).max(60),
    conditions: z
      .array(
        z.object({
          type: z.enum([
            "evidence",
            "inspection",
            "resource",
            "owner",
            "time",
            "commitment",
            "approval",
            "compatibility",
          ]),
          id: z.string(),
          description: z.string().max(400),
          satisfied: z.boolean().default(false),
          version: z.number().int().nonnegative().optional(),
          expiresAt: z.number().int().optional(),
        }),
      )
      .max(30)
      .default([]),
    alternatives: z
      .array(
        z.object({ title: z.string().max(120), reason: z.string().max(400) }),
      )
      .max(4)
      .default([]),
    actions: z.array(actionSchema).min(1).max(30),
    priority: z.enum(["urgent", "high", "normal"]).default("high"),
    rationale: z.string().max(1000),
  })
  .strict();
export const claimSchema = z
  .object({
    text: z.string().min(1).max(4000),
    references: z.array(z.string()).max(50),
    state: z
      .enum([
        "observed",
        "inferred",
        "pending",
        "contradicted",
        "confirmed",
        "expired",
        "withdrawn",
      ])
      .default("pending"),
    location: z.string().optional(),
    validUntil: z.number().int().optional(),
    contradicts: z.array(z.string()).default([]),
    sourceRelations: z
      .array(
        z.object({
          id: z.string(),
          relation: z.enum(["supports", "refutes", "context", "duplicate"]),
        }),
      )
      .default([]),
  })
  .strict();
export function parse(schema, data) {
  return schema.parse(data);
}

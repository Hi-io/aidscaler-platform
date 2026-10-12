import { check } from "./errors.mjs";
import { hash } from "./store.mjs";

/** A delegation authorizes one exact, received proposal. It is not a new role. */
export async function reviewAuthority(store, actor, proposal) {
  if (["commander", "dispatcher"].includes(actor.role)) return null;
  check(
    actor.role !== "agent" && actor.role !== "admin",
    "ROLE",
    "A human operational role or scoped delegation is required.",
    403,
  );
  const rows = (
    await store.query(
      "SELECT id FROM entities WHERE org=$1 AND kind='delegation' AND data->>'to'=$2 AND data->>'proposal'=$3 AND data->>'state'='active'",
      [actor.org, actor.id, proposal.id],
    )
  ).rows;
  for (const row of rows) {
    const grant = await store.get(actor.org, "delegation", row.id);
    if (
      grant.expiresAt > Date.now() &&
      grant.proposalVersion === proposal.version &&
      grant.planHash === hash(proposal.actions)
    )
      return grant;
  }
  check(
    false,
    "REVIEW_SCOPE",
    "No current delegation covers this exact proposal version. Ask its coordinator to renew the scope.",
    403,
  );
}

export async function authorizationCurrent(store, org, authorization) {
  if (!authorization || authorization.expiresAt <= Date.now()) return false;
  const owner = (
    await store.query("SELECT active FROM users WHERE org=$1 AND id=$2", [
      org,
      authorization.by,
    ])
  ).rows[0];
  if (owner && !owner.active) return false;
  if (!authorization.delegation) return true;
  const grant = await store.get(
    org,
    "delegation",
    authorization.delegation,
    false,
  );
  return (
    !!grant &&
    grant.state === "active" &&
    grant.version === authorization.delegationVersion &&
    grant.to === authorization.by &&
    grant.expiresAt > Date.now() &&
    grant.planHash === authorization.planHash
  );
}

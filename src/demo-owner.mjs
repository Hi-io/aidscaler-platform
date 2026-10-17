// Explicit, limited operational owners for the AUTOMATED base teams. This is
// not model inference and never grants authority over a visitor organization.
export function baseDemoRequestAllowed(app, proposal) {
  return app.demoVisitor === false && !!proposal.originPartner && proposal.actions?.length === 1 &&
    proposal.actions.every(action => action.type === 'dispatch' && action.owner === app.config.org &&
      Number.isSafeInteger(action.params?.quantity) && action.params.quantity > 0);
}

export async function reviewDemoBaseRequests(app, isVisitor) {
  if (app.demoVisitor !== false) return [];
  const proposals = (await app.store.list(app.config.org, 'proposal', 100)).filter(p =>
    p.originPartner && ['awaiting_review', 'requires_review', 'needs_clarification'].includes(p.state) && isVisitor(p.originPartner));
  if (!proposals.length) return [];
  await app.ingestion.sync({ sources: false });
  const account = (await app.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'", [app.config.org])).rows[0];
  const actor = { ...account, name: `${app.config.orgName} · automated demo owner` }, results = [];
  for (const pending of proposals) {
    const proposal = await app.store.get(app.config.org, 'proposal', pending.id);
    if (!['awaiting_review', 'requires_review', 'needs_clarification'].includes(proposal.state)) continue;
    let reason = 'The automated demo owner accepts only one owned water delivery of up to 100 L or food delivery of up to 40 portions per request.';
    let allowed = baseDemoRequestAllowed(app, proposal);
    if (allowed) {
      const action = proposal.actions[0], resource = await app.store.get(app.config.org, 'resource', action.params.resource, false);
      allowed = resource?.owner === app.config.org &&
        ((resource.type === 'water' && action.params.quantity <= 100) || (resource.type === 'food' && action.params.quantity <= 40));
    }
    if (allowed) {
      try {
        const accepted = await app.domain.review(actor, proposal.id, { version: proposal.version, decision: 'approve', note: 'Automated base-team owner review: bounded demonstration contribution; current stock, vehicle, route and source authority were checked by the platform.' }, `demo-owner-approve-${proposal.id}-${proposal.version}`);
        results.push({ id: proposal.id, state: accepted.state }); continue;
      } catch (error) {
        if (error.code === 'VERSION_CONFLICT') continue;
        reason = 'The automated owner could not safely commit this base-team resource (' + String(error.code ?? 'CHECK_REQUIRED').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80) + '). Review the remaining option or propose a contribution from your own team.';
      }
    }
    const current = await app.store.get(app.config.org, 'proposal', proposal.id);
    const rejected = await app.domain.review(actor, current.id, { version: current.version, decision: 'reject', note: reason }, `demo-owner-reject-${current.id}-${current.version}`);
    await app.network.response(rejected, 'rejected', { rejectedBy: actor.id, reason });
    results.push({ id: rejected.id, state: 'rejected', reason });
  }
  return results;
}

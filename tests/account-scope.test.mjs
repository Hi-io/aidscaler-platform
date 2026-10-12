import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Auth } from "../src/auth.mjs";
test("administrators cannot revoke another organization's session by supplying its user identifier", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  await s.organization("org1");
  const a = new Auth(s),
    outsider = await a.create(null, {
      org: "org1",
      role: "field",
      name: "External",
      email: "outside@example.local",
      password: "local-test-password",
    });
  const session = await a.login(outsider.email, "local-test-password");
  await assert.rejects(
    () => a.revoke({ id: "admin0", org: "org0", role: "admin" }, outsider.id),
    /not in/,
  );
  assert.equal((await a.session(session.token)).org, "org1");
  assert.equal(
    await a.revoke({ id: "admin1", org: "org1", role: "admin" }, outsider.id),
    true,
  );
  assert.equal(await a.session(session.token), null);
});

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { hash, uid } from "./store.mjs";
import { check, role } from "./errors.mjs";
export const ROLES = [
  "admin",
  "commander",
  "dispatcher",
  "analyst",
  "field",
  "publisher",
  "finance",
  "auditor",
];
const passwordHash = (p) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(p, salt, 32).toString("hex")}`;
};
const passwordMatches = (p, h) => {
  const [salt, digest] = h.split(":");
  const actual = scryptSync(p, salt, 32),
    expected = Buffer.from(digest, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
};
export class Auth {
  constructor(store) {
    this.store = store;
    this.failures = new Map();
  }
  async create(actor, { org, email, name, role: requestedRole, password }) {
    if (actor) {
      role(actor, ["admin"]);
      check(
        actor.org === org,
        "FORBIDDEN",
        "Create accounts only in your own organization.",
        403,
      );
    }
    check(ROLES.includes(requestedRole), "ROLE", "Choose a valid role.");
    check(
      typeof password === "string" && password.length >= 12,
      "PASSWORD",
      "Use a password with at least 12 characters.",
    );
    check(
      typeof email === "string" && email.includes("@") && email.length < 160,
      "EMAIL",
      "A valid email is required.",
    );
    const id = uid("user");
    await this.store.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO users(id,org,email,name,role,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          org,
          email.toLowerCase(),
          name,
          requestedRole,
          passwordHash(password),
          Date.now(),
        ],
      );
      if (actor)
        await tx.audit(org, actor.id, "account.created", id, {
          role: requestedRole,
        });
    });
    return { id, org, email, name, role: requestedRole };
  }
  async login(email, password, address = "local") {
    const bucket = this.failures.get(address) ?? {
      count: 0,
      since: Date.now(),
    };
    if (Date.now() - bucket.since > 60000) {
      bucket.count = 0;
      bucket.since = Date.now();
    }
    check(
      bucket.count < 10,
      "LOGIN_RATE",
      "Please wait before trying again.",
      429,
    );
    const u = (
      await this.store.query("SELECT * FROM users WHERE email=$1", [
        String(email).toLowerCase(),
      ])
    ).rows[0];
    if (!u?.active || !passwordMatches(String(password), u.password_hash)) {
      bucket.count++;
      this.failures.set(address, bucket);
      check(false, "LOGIN", "Email or password is incorrect.", 401);
    }
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(20).toString("hex");
    await this.store.query(
      "INSERT INTO sessions(hash,user_id,expires_at,csrf) VALUES($1,$2,$3,$4)",
      [hash(token), u.id, Date.now() + 8 * 3600000, csrf],
    );
    return {
      token,
      csrf,
      user: {
        id: u.id,
        org: u.org,
        email: u.email,
        name: u.name,
        role: u.role,
      },
    };
  }
  async session(token) {
    if (!token) return null;
    const u = (
      await this.store.query(
        'SELECT u.id,u.org,u.email,u.name,u.role,s.csrf,s.expires_at AS "expiresAt" FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>$2 AND u.active=true',
        [hash(token), Date.now()],
      )
    ).rows[0];
    return u ?? null;
  }
  async logout(token) {
    await this.store.query("DELETE FROM sessions WHERE hash=$1", [hash(token)]);
  }
  async revoke(actor, id) {
    role(actor, ["admin"]);
    await this.store.transaction(async (tx) => {
      const target = (
        await tx.query(
          "SELECT id FROM users WHERE id=$1 AND org=$2 FOR UPDATE",
          [id, actor.org],
        )
      ).rows[0];
      check(
        target,
        "USER_SCOPE",
        "This account is not in your organization.",
        404,
      );
      check(
        id !== actor.id,
        "SELF_REVOKE",
        "Ask another administrator to revoke your account.",
        409,
      );
      await tx.query("UPDATE users SET active=false WHERE id=$1 AND org=$2", [
        id,
        actor.org,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await tx.audit(actor.org, actor.id, "user.revoked", id, {});
    });
    return true;
  }
}

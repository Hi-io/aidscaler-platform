export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function check(condition, code, message, status = 400) {
  if (!condition) throw new AppError(code, message, status);
}
export function role(actor, roles) {
  check(
    actor && roles.includes(actor.role),
    "FORBIDDEN",
    "Your role cannot perform this action.",
    403,
  );
}
export function owner(actor, org) {
  check(
    actor?.org === org,
    "FORBIDDEN",
    "This record belongs to another organization.",
    403,
  );
}

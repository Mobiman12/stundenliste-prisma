export function isAuthorized(request: Request): boolean {
  const expected = process.env.INTEGRATION_API_KEY?.trim();
  if (!expected) {
    return true;
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return false;
  }

  const provided = authorization.slice(7).trim();
  return provided === expected;
}

export function ensureAuthorized(request: Request) {
  if (!isAuthorized(request)) {
    throw new UnauthorizedError();
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
  }
}

// Failures the sync layer distinguishes, because each needs a different
// response: retry later, ask the visitor to sign in, or give up on a change.

// The request never reached the server (no connection, DNS, CORS, ...).
export class OfflineError extends Error {
  constructor(message = "offline") {
    super(message);
    this.name = "OfflineError";
  }
}

// The session has ended and can't be refreshed; the visitor must sign in.
export class SignedOutError extends Error {
  constructor(message = "signed out") {
    super(message);
    this.name = "SignedOutError";
  }
}

export class HttpError extends Error {
  constructor(status, message = `HTTP ${status}`) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }

  // 4xx other than auth: resending the same request won't help.
  get permanent() {
    return this.status >= 400 && this.status < 500;
  }
}

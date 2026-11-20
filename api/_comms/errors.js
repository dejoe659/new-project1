// Every provider failure is one of these, so the retry engine (Phase 5) can tell
// "try again later" (network, rate limit, 5xx) from "never going to work" (bad number, rejected).
class ProviderError extends Error {
  constructor(message, { retryable = false, status = null, code = null } = {}) {
    super(String(message).slice(0, 300));
    this.name = "ProviderError"; this.retryable = retryable; this.status = status; this.code = code;
  }
}
module.exports = { ProviderError };

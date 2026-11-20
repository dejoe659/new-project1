// The exact bytes the provider sent. Signatures are computed over these, so we must not re-serialise JSON.
async function readRaw(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody);
  if (!req.readableEnded && typeof req[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  }
  // The runtime already consumed the stream. Only an untouched Buffer/string body is trustworthy.
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  return null;
}
module.exports = { readRaw };

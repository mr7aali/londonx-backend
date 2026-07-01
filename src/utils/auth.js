const crypto = require("node:crypto");

const TOKEN_ALGORITHM = "sha256";
const TOKEN_EXPIRY_SECONDS = Number(process.env.AUTH_TOKEN_EXPIRES_IN_SECONDS) || 60 * 60 * 24 * 7;
const FALLBACK_TOKEN_SECRET = "local-dev-auth-secret";

function getTokenSecret() {
  return process.env.AUTH_TOKEN_SECRET || FALLBACK_TOKEN_SECRET;
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signTokenPart(value, secret) {
  return crypto.createHmac(TOKEN_ALGORITHM, secret).update(value).digest("base64url");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");

  return { salt, passwordHash };
}

function verifyPassword(password, salt, expectedHash) {
  const passwordHash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  const receivedHashBuffer = Buffer.from(passwordHash, "hex");
  const expectedHashBuffer = Buffer.from(expectedHash, "hex");

  if (receivedHashBuffer.length !== expectedHashBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedHashBuffer, expectedHashBuffer);
}

function generatePasswordResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function generatePasswordResetCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashPasswordResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function createAuthToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    ...payload,
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };

  const encodedHeader = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = encodeBase64Url(JSON.stringify(tokenPayload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = signTokenPart(unsignedToken, getTokenSecret());

  return `${unsignedToken}.${signature}`;
}

function verifyAuthToken(token) {
  const [encodedHeader, encodedPayload, signature] = token.split(".");

  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("Invalid token");
  }

  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = signTokenPart(unsignedToken, getTokenSecret());

  if (
    Buffer.byteLength(signature) !== Buffer.byteLength(expectedSignature) ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload));

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  return payload;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generatePasswordResetToken,
  generatePasswordResetCode,
  hashPasswordResetToken,
  createAuthToken,
  verifyAuthToken,
};

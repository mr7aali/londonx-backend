const express = require("express");
const path = require("node:path");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const courseRoutes = require("./routes/courseRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const teamRoutes = require("./routes/teamRoutes");
const stripeRoutes = require("./routes/stripeRoutes");
const supportRoutes = require("./routes/supportRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const contactRoutes = require("./routes/contactRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const errorHandler = require("./middleware/errorHandler");

function normalizeOrigin(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function parseOriginList(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((origin) => normalizeOrigin(origin))
      .filter(Boolean)
  )];
}

const allowedOrigins = parseOriginList(
  process.env.CORS_ALLOWED_ORIGINS ||
    "http://localhost:3000,http://localhost:3003,http://localhost:5173,http://127.0.0.1:3003,https://london-essex-dashboard-ia9s.vercel.app,https://london-essex-br36.vercel.app"
);

const allowedOriginPatterns = [
  /^https:\/\/london-essex-dashboard(?:-[a-z0-9-]+)?\.vercel\.app$/i,
  /^https:\/\/london-essex(?:-[a-z0-9-]+)?\.vercel\.app$/i,
];

function isOriginAllowed(origin) {
  const normalizedOrigin = normalizeOrigin(origin);

  if (!normalizedOrigin) {
    return true;
  }

  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  return allowedOriginPatterns.some((pattern) => pattern.test(normalizedOrigin));
}

function sanitizeForLog(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return `[image data url ${value.length} chars]`;
    }

    return value.length > 500 ? `${value.slice(0, 500)}...[${value.length} chars]` : value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (depth >= 3) {
    return Array.isArray(value) ? `[Array ${value.length}]` : "[Object]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForLog(item, depth + 1));
  }

  const redactedKeys = new Set([
    "authorization",
    "cookie",
    "password",
    "pass",
    "token",
    "accessToken",
    "refreshToken",
    "adminToken",
    "userToken",
    "signatureData",
  ]);

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      redactedKeys.has(key) ? "[redacted]" : sanitizeForLog(entryValue, depth + 1),
    ])
  );
}

function summarizeFilesForLog(files) {
  if (!files) {
    return undefined;
  }

  if (Array.isArray(files)) {
    return files.map((file) => ({
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    }));
  }

  return Object.fromEntries(
    Object.entries(files).map(([field, fieldFiles]) => [
      field,
      Array.isArray(fieldFiles)
        ? fieldFiles.map((file) => ({
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
          }))
        : sanitizeForLog(fieldFiles),
    ])
  );
}

function logRequestDetails(req, res, startTime) {
  const durationMs = Date.now() - startTime;
  const payload = {
    method: req.method,
    url: req.originalUrl,
    statusCode: res.statusCode,
    durationMs,
    origin: req.headers.origin || null,
    ip: req.ip,
    query: sanitizeForLog(req.query),
    params: sanitizeForLog(req.params),
    body: sanitizeForLog(req.body),
    uploadedFile: sanitizeForLog(req.uploadedDocument || req.uploadedSignatureFile),
    files: summarizeFilesForLog(req.files),
  };

  console.log("[api]", JSON.stringify(payload));
}

const app = express();
const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin || "unknown"}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Accept",
    "Authorization",
    "Content-Type",
    "Origin",
    "X-Requested-With",
    "ngrok-skip-browser-warning",
  ],
  exposedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
  optionsSuccessStatus: 204,
};

app.use((req, res, next) => {
  req.requestStartTime = Date.now();
  console.log(`[api:start] ${req.method} ${req.originalUrl} origin=${req.headers.origin || "n/a"}`);

  return next();
});

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use("/api/stripe", stripeRoutes);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.use((req, res, next) => {
  res.on("finish", () => {
    logRequestDetails(req, res, req.requestStartTime || Date.now());
  });

  return next();
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "API is running",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/notifications", notificationRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use(errorHandler);

module.exports = app;

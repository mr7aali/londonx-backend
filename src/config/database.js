const mongoose = require("mongoose");
const dns = require("node:dns");

let hasConnected = false;

function configureDnsServers() {
  const rawValue = process.env.MONGODB_DNS_SERVERS;

  if (!rawValue) {
    return;
  }

  const servers = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (servers.length > 0) {
    dns.setServers(servers);
    console.log(`MongoDB DNS servers: ${dns.getServers().join(", ")}`);
  }
}

function buildConnectionOptions() {
  const options = {};

  if (process.env.MONGODB_DB) {
    options.dbName = process.env.MONGODB_DB;
  }

  const timeoutMs = Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    options.serverSelectionTimeoutMS = timeoutMs;
    options.connectTimeoutMS = timeoutMs;
  }

  return options;
}

async function connectDatabase() {
  if (hasConnected) {
    return mongoose.connection;
  }

  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is not set");
  }

  configureDnsServers();

  await mongoose.connect(mongoUri, buildConnectionOptions());

  hasConnected = true;
  console.log("Connected to MongoDB using MONGODB_URI");

  return mongoose.connection;
}

module.exports = connectDatabase;

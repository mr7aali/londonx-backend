const { v2: cloudinary } = require("cloudinary");

let configured = false;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isCloudinaryConfigured() {
  return Boolean(
    normalizeString(process.env.CLOUDINARY_CLOUD_NAME) &&
      normalizeString(process.env.CLOUDINARY_API_KEY) &&
      normalizeString(process.env.CLOUDINARY_API_SECRET)
  );
}

function ensureCloudinaryConfigured() {
  if (configured) {
    return;
  }

  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured on the server");
  }

  cloudinary.config({
    cloud_name: normalizeString(process.env.CLOUDINARY_CLOUD_NAME),
    api_key: normalizeString(process.env.CLOUDINARY_API_KEY),
    api_secret: normalizeString(process.env.CLOUDINARY_API_SECRET),
    secure: true,
  });

  configured = true;
}

function uploadBufferToCloudinary(buffer, options = {}) {
  ensureCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });

    stream.end(buffer);
  });
}

module.exports = {
  isCloudinaryConfigured,
  uploadBufferToCloudinary,
};

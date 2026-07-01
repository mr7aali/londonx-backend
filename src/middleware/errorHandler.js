function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error && error.name === "MulterError") {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? error.message && error.message !== "File too large"
          ? error.message
          : "Image size must be 5MB or smaller"
        : error.message || "Image upload failed";

    return res.status(400).json({
      success: false,
      message,
    });
  }

  if (error && error.message === "Only JPG, PNG, and WEBP image uploads are allowed") {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  if (
    error &&
    (error.message === "Invalid image data URL" ||
      error.message === "Image size must be 5MB or smaller")
  ) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  if (error && error.message === "Document size must be 10MB or smaller") {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  if (error && error.message === "Only PDF, JPG, PNG, and WEBP uploads are allowed") {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  if (error && error.message === "Cloudinary is not configured on the server") {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }

  if (error && error.code === 11000) {
    const duplicateField = Object.keys(error.keyPattern || {})[0] || "field";

    return res.status(409).json({
      success: false,
      message: `A record with this ${duplicateField} already exists`,
    });
  }

  if (error && error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: Object.values(error.errors)
        .map((item) => item.message)
        .join(", "),
    });
  }

  console.error(error);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}

module.exports = errorHandler;

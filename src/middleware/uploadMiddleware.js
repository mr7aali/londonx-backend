const multer = require("multer");

const { uploadBufferToCloudinary, isCloudinaryConfigured } = require("../utils/cloudinary");

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);
const maxImageUploadSize = 5 * 1024 * 1024;
const maxImageFieldSize = 8 * 1024 * 1024;
const inlineCourseImageFields = ["thumbnailUrl", "file", "image", "courseImage", "thumbnail"];
const imageExtensionsByMimeType = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const allowedBookingMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
]);
const bookingDocumentUploadFields = [
  "file",
  "document",
  "upload",
  "certificate",
  "supportingDocument",
];

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxImageUploadSize,
    fieldSize: maxImageFieldSize,
  },
  fileFilter(req, file, callback) {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Only JPG, PNG, and WEBP image uploads are allowed"));
      return;
    }

    callback(null, true);
  },
});

const bookingDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter(req, file, callback) {
    if (!allowedBookingMimeTypes.has(file.mimetype)) {
      callback(new Error("Only PDF, JPG, PNG, and WEBP uploads are allowed"));
      return;
    }

    callback(null, true);
  },
});

async function uploadFileToCloudinary(file, folder, resourceType = "image") {
  const result = await uploadBufferToCloudinary(file.buffer, {
    folder,
    resource_type: resourceType,
    use_filename: true,
    unique_filename: true,
    overwrite: false,
  });

  return {
    fileName: file.originalname,
    fileUrl: result.secure_url,
    mimeType: file.mimetype,
  };
}

function getStringFieldValue(body, fieldName) {
  const value = body?.[fieldName];

  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0].trim() : "";
  }

  return typeof value === "string" ? value.trim() : "";
}

function parseInlineImageDataUrl(value, originalNamePrefix = "image") {
  if (!value.startsWith("data:")) {
    return null;
  }

  const match = value.match(/^data:([^;,]+);base64,(.+)$/s);

  if (!match) {
    throw new Error("Invalid image data URL");
  }

  const mimeType = match[1].toLowerCase();

  if (!allowedMimeTypes.has(mimeType)) {
    throw new Error("Only JPG, PNG, and WEBP image uploads are allowed");
  }

  const base64Value = match[2].replace(/\s/g, "");

  if (!base64Value || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Value)) {
    throw new Error("Invalid image data URL");
  }

  const buffer = Buffer.from(base64Value, "base64");

  if (!buffer.length) {
    throw new Error("Invalid image data URL");
  }

  if (buffer.length > maxImageUploadSize) {
    throw new Error("Image size must be 5MB or smaller");
  }

  return {
    buffer,
    mimetype: mimeType,
    originalname: `${originalNamePrefix}.${imageExtensionsByMimeType[mimeType] || "jpg"}`,
  };
}

async function uploadInlineCourseImage(req) {
  if (req.uploadedImageUrl) {
    return;
  }

  for (const fieldName of inlineCourseImageFields) {
    const fieldValue = getStringFieldValue(req.body, fieldName);
    const inlineImage = fieldValue ? parseInlineImageDataUrl(fieldValue, "course-image") : null;

    if (!inlineImage) {
      continue;
    }

    const uploadResult = await uploadFileToCloudinary(
      inlineImage,
      "londonessexelec/courses",
      "image"
    );

    req.uploadedImageUrl = uploadResult.fileUrl;
    req.body.thumbnailUrl = uploadResult.fileUrl;
    return;
  }
}

// In uploadCourseImage, add this check:
function uploadCourseImage(req, res, next) {
  imageUpload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "file", maxCount: 1 },
    { name: "courseImage", maxCount: 1 },
  ])(req, res, (error) => {
    if (error) {
      // Log the actual multer error
      console.error("[uploadCourseImage] multer error:", error.message, error.code);
      return next(error);
    }

    (async () => {
      try {
        if (!req.files) req.files = {};

        const uploadedFile =
          req.files?.thumbnail?.[0] ||
          req.files?.image?.[0] ||
          req.files?.file?.[0] ||
          req.files?.courseImage?.[0];

        if (uploadedFile) {
          if (!isCloudinaryConfigured()) {
            console.warn("[uploadCourseImage] Cloudinary not configured — skipping file upload.");
          } else {
            console.log("[uploadCourseImage] uploading file:", uploadedFile.originalname, uploadedFile.size);
            const uploadResult = await uploadFileToCloudinary(
              uploadedFile,
              "londonessexelec/courses",
              "image"
            );
            req.uploadedImageUrl = uploadResult.fileUrl;
            req.body.thumbnailUrl = uploadResult.fileUrl;
          }
        }

        if (isCloudinaryConfigured()) {
          await uploadInlineCourseImage(req);
        }
        return next();
      } catch (uploadError) {
        console.error("[uploadCourseImage] cloudinary/inline error:", uploadError.message);
        return next(uploadError);
      }
    })();
  });
}

function uploadBookingDocument(req, res, next) {
  bookingDocumentUpload.fields(
    bookingDocumentUploadFields.map((name) => ({ name, maxCount: 1 }))
  )(req, res, (error) => {
    if (error) {
      if (error.name === "MulterError" && error.code === "LIMIT_FILE_SIZE") {
        error.message = "Document size must be 10MB or smaller";
      }
      return next(error);
    }

    (async () => {
      try {
        const uploadedFile = bookingDocumentUploadFields
          .map((fieldName) => req.files?.[fieldName]?.[0])
          .find(Boolean);

        if (uploadedFile) {
          req.uploadedDocument = await uploadFileToCloudinary(
            uploadedFile,
            "londonessexelec/bookings/documents",
            "auto"
          );
        }

        return next();
      } catch (uploadError) {
        return next(uploadError);
      }
    })();
  });
}

function uploadBookingSignatureImage(req, res, next) {
  imageUpload.fields([
    { name: "file", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "signature", maxCount: 1 },
    { name: "candidateSignature", maxCount: 1 },
  ])(req, res, (error) => {
    if (error) {
      return next(error);
    }

    (async () => {
      try {
        // Ensure req.files is initialized as an object
        if (!req.files) {
          req.files = {};
        }

        const uploadedFile =
          req.files?.file?.[0] ||
          req.files?.image?.[0] ||
          req.files?.signature?.[0] ||
          req.files?.candidateSignature?.[0];

        if (uploadedFile) {
          req.uploadedSignatureFile = await uploadFileToCloudinary(
            uploadedFile,
            "londonessexelec/bookings/signatures",
            "image"
          );
        } else {
          const inlineSignature = parseInlineImageDataUrl(
            getStringFieldValue(req.body, "signatureData") ||
              getStringFieldValue(req.body, "signatureImageUrl"),
            "signature-image"
          );

          if (inlineSignature) {
            req.uploadedSignatureFile = await uploadFileToCloudinary(
              inlineSignature,
              "londonessexelec/bookings/signatures",
              "image"
            );
            req.body.signatureData = req.uploadedSignatureFile.fileUrl;
            req.body.fileUrl = req.uploadedSignatureFile.fileUrl;
            req.body.fileName = req.body.fileName || req.uploadedSignatureFile.fileName;
          }
        }

        return next();
      } catch (uploadError) {
        return next(uploadError);
      }
    })();
  });
}

function uploadTeamImage(req, res, next) {
  imageUpload.fields([
    { name: "file", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ])(req, res, (error) => {
    if (error) {
      return next(error);
    }

    (async () => {
      try {
        // Ensure req.files is initialized as an object
        if (!req.files) {
          req.files = {};
        }

        const uploadedFile = req.files?.file?.[0] || req.files?.image?.[0] || req.files?.photo?.[0];

        if (uploadedFile) {
          const uploadResult = await uploadFileToCloudinary(
            uploadedFile,
            "londonessexelec/team",
            "image"
          );
          req.uploadedImageUrl = uploadResult.fileUrl;
        }

        return next();
      } catch (uploadError) {
        return next(uploadError);
      }
    })();
  });
}

function uploadUserProfileImage(req, res, next) {
  imageUpload.fields([
    { name: "file", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "photo", maxCount: 1 },
    { name: "avatar", maxCount: 1 },
  ])(req, res, (error) => {
    if (error) {
      return next(error);
    }

    (async () => {
      try {
        // Ensure req.files is initialized as an object
        if (!req.files) {
          req.files = {};
        }

        const uploadedFile =
          req.files?.file?.[0] ||
          req.files?.image?.[0] ||
          req.files?.photo?.[0] ||
          req.files?.avatar?.[0];

        if (uploadedFile) {
          const uploadResult = await uploadFileToCloudinary(
            uploadedFile,
            "londonessexelec/users/profile",
            "image"
          );
          req.uploadedImageUrl = uploadResult.fileUrl;
        }

        return next();
      } catch (uploadError) {
        return next(uploadError);
      }
    })();
  });
}

module.exports = {
  uploadCourseImage,
  uploadBookingDocument,
  uploadBookingSignatureImage,
  uploadTeamImage,
  uploadUserProfileImage,
};

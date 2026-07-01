const User = require("../models/User");
const { verifyAuthToken } = require("../utils/auth");

function extractBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== "string") {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token.trim();
}

async function requireAuth(req, res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authorization token is required",
      });
    }

    const payload = verifyAuthToken(token);
    const user = await User.findById(payload.sub).select(
      "name email role phoneNumber ntiNumber profileImageUrl notificationSettings createdAt updatedAt"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    req.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phoneNumber: user.phoneNumber,
      ntiNumber: user.ntiNumber,
      profileImageUrl: user.profileImageUrl,
      notificationSettings: user.notificationSettings || {},
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return next();
    }

    const payload = verifyAuthToken(token);
    const user = await User.findById(payload.sub).select(
      "name email role phoneNumber ntiNumber profileImageUrl notificationSettings createdAt updatedAt"
    );

    if (!user) {
      return next();
    }

    req.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phoneNumber: user.phoneNumber,
      ntiNumber: user.ntiNumber,
      profileImageUrl: user.profileImageUrl,
      notificationSettings: user.notificationSettings || {},
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return next();
  } catch (error) {
    return next();
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this resource",
      });
    }

    return next();
  };
}

module.exports = {
  optionalAuth,
  requireAuth,
  requireRole,
};

const User = require("../models/User");
const {
  hashPassword,
  verifyPassword,
  generatePasswordResetCode,
  hashPasswordResetToken,
  createAuthToken,
} = require("../utils/auth");
const { sendPasswordResetEmail } = require("../utils/mailer");

const PASSWORD_RESET_EXPIRY_MINUTES = Number(process.env.PASSWORD_RESET_EXPIRY_MINUTES) || 30;

function normalizeName(name) {
  return typeof name === "string" ? name.trim() : "";
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function normalizePassword(password) {
  return typeof password === "string" ? password : "";
}

function normalizeToken(token) {
  return typeof token === "string" ? token.trim() : "";
}

function normalizeResetCode(code) {
  return typeof code === "string" ? code.trim() : "";
}

function normalizeRole(role) {
  return typeof role === "string" ? role.trim().toLowerCase() : "user";
}

function validateName(name) {
  if (!name) {
    return "Name is required";
  }

  if (name.length < 2 || name.length > 80) {
    return "Name must be between 2 and 80 characters";
  }

  return null;
}

function validateEmail(email) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || !emailPattern.test(email)) {
    return "A valid email is required";
  }

  return null;
}

function validatePassword(password) {
  if (!password) {
    return "Password is required";
  }

  if (password.length < 8) {
    return "Password must be at least 8 characters long";
  }

  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter";
  }

  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter";
  }

  if (!/[0-9]/.test(password)) {
    return "Password must include at least one number";
  }

  return null;
}

function validateSignupPayload(payload) {
  const name = normalizeName(payload.name);
  const email = normalizeEmail(payload.email);
  const password = normalizePassword(payload.password);
  const role = normalizeRole(payload.role);

  const nameError = validateName(name);
  if (nameError) {
    return { error: nameError };
  }

  const emailError = validateEmail(email);
  if (emailError) {
    return { error: emailError };
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return { error: passwordError };
  }

  if (!["user", "admin"].includes(role)) {
    return { error: "Role must be either user or admin" };
  }

  return {
    value: {
      name,
      email,
      password,
      role,
      adminSetupSecret:
        typeof payload.adminSetupSecret === "string" ? payload.adminSetupSecret.trim() : "",
    },
  };
}

function validateLoginPayload(payload) {
  const email = normalizeEmail(payload.email);
  const password = normalizePassword(payload.password);

  const emailError = validateEmail(email);
  if (emailError) {
    return { error: emailError };
  }

  if (!password) {
    return { error: "Password is required" };
  }

  return {
    value: {
      email,
      password,
    },
  };
}

function validateForgotPasswordPayload(payload) {
  const email = normalizeEmail(payload.email);

  const emailError = validateEmail(email);
  if (emailError) {
    return { error: emailError };
  }

  return {
    value: {
      email,
    },
  };
}

function validateResetPasswordPayload(payload) {
  const token = normalizeToken(payload.token);
  const code = normalizeResetCode(payload.code);
  const password = normalizePassword(payload.password);

  if (!token && !/^\d{6}$/.test(code)) {
    return { error: "A valid reset token or 6-digit code is required" };
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return { error: passwordError };
  }

  return {
    value: {
      token: token || code,
      password,
    },
  };
}

function ensureAdminSignupAllowed(role, adminSetupSecret) {
  if (role !== "admin") {
    return null;
  }

  const configuredSecret = process.env.ADMIN_SETUP_SECRET;

  if (!configuredSecret) {
    return {
      status: 503,
      message: "Admin signup is not configured",
    };
  }

  if (adminSetupSecret !== configuredSecret) {
    return {
      status: 403,
      message: "Invalid admin setup secret",
    };
  }

  return null;
}

function getPasswordResetExpiryDate() {
  return new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);
}

function buildMaskedEmail(email) {
  const [localPart = "", domainPart = ""] = String(email || "").split("@");

  if (!localPart || !domainPart) {
    return "";
  }

  const visibleLocal = localPart.length <= 2 ? localPart[0] || "*" : localPart.slice(0, 2);
  const hiddenLocal = "*".repeat(Math.max(localPart.length - visibleLocal.length, 2));
  const domainSections = domainPart.split(".");
  const domainName = domainSections.shift() || "";
  const domainSuffix = domainSections.join(".");
  const visibleDomain = domainName ? domainName[0] : "*";
  const hiddenDomain = "*".repeat(Math.max(domainName.length - visibleDomain.length, 3));

  return `${visibleLocal}${hiddenLocal}@${visibleDomain}${hiddenDomain}${domainSuffix ? `.${domainSuffix}` : ""}`;
}

function buildPasswordResetUrl(token) {
  const configuredBaseUrl =
    typeof process.env.PASSWORD_RESET_URL_BASE === "string"
      ? process.env.PASSWORD_RESET_URL_BASE.trim()
      : "";

  const baseUrl = configuredBaseUrl || "http://localhost:3000/reset-password";
  const separator = baseUrl.includes("?") ? "&" : "?";

  return `${baseUrl}${separator}code=${encodeURIComponent(token)}`;
}

function buildForgotPasswordResponse(email, code) {
  const response = {
    email,
    maskedEmail: buildMaskedEmail(email),
    expiresInMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
  };

  if (code && process.env.NODE_ENV !== "production") {
    response.devReset = {
      code,
      url: buildPasswordResetUrl(code),
    };
  }

  return response;
}

function buildAuthResponse(user) {
  const token = createAuthToken({
    sub: String(user._id),
    email: user.email,
    role: user.role,
    name: user.name,
  });

  return {
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phoneNumber: user.phoneNumber || "",
      ntiNumber: user.ntiNumber || "",
      profileImageUrl: user.profileImageUrl || "",
      notificationSettings: user.notificationSettings || {},
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  };
}

async function signup(req, res, next) {
  try {
    const validation = validateSignupPayload(req.body || {});

    if (validation.error) {
      return res.status(400).json({
        success: false,
        message: validation.error,
      });
    }

    const { name, email, password, role, adminSetupSecret } = validation.value;

    const adminSignupError = ensureAdminSignupAllowed(role, adminSetupSecret);
    if (adminSignupError) {
      return res.status(adminSignupError.status).json({
        success: false,
        message: adminSignupError.message,
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const { salt, passwordHash } = hashPassword(password);

    const user = await User.create({
      name,
      email,
      role,
      passwordHash,
      passwordSalt: salt,
    });

    return res.status(201).json({
      success: true,
      message: `${role === "admin" ? "Admin" : "User"} account created successfully`,
      data: buildAuthResponse(user),
    });
  } catch (error) {
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const validation = validateLoginPayload(req.body || {});

    if (validation.error) {
      return res.status(400).json({
        success: false,
        message: validation.error,
      });
    }

    const { email, password } = validation.value;

    const user = await User.findOne({ email }).select("+passwordHash +passwordSalt");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const passwordMatches = verifyPassword(password, user.passwordSalt, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: buildAuthResponse(user),
    });
  } catch (error) {
    return next(error);
  }
}

async function issuePasswordResetCode(email) {
  const user = await User.findOne({ email }).select("+passwordResetTokenHash +passwordResetTokenExpiresAt");

  if (!user) {
    return {
      code: null,
      user: null,
    };
  }

  const code = generatePasswordResetCode();

  user.passwordResetTokenHash = hashPasswordResetToken(code);
  user.passwordResetTokenExpiresAt = getPasswordResetExpiryDate();
  await user.save();

  return {
    code,
    user,
  };
}

async function deliverPasswordResetCode(user, email, code) {
  if (!user || !code) {
    return null;
  }

  return sendPasswordResetEmail({
    to: email,
    name: user.name,
    code,
    expiresInMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
    resetUrl: buildPasswordResetUrl(code),
  });
}

async function forgotPassword(req, res, next) {
  try {
    const validation = validateForgotPasswordPayload(req.body || {});

    if (validation.error) {
      return res.status(400).json({
        success: false,
        message: validation.error,
      });
    }

    const { email } = validation.value;
    const { code, user } = await issuePasswordResetCode(email);

    if (user) {
      try {
        await deliverPasswordResetCode(user, email, code);
      } catch (error) {
        console.error("Failed to send password reset email:", error);

        return res.status(503).json({
          success: false,
          message: "Password reset email could not be sent right now",
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "If an account with this email exists, a password reset code has been sent",
      data: buildForgotPasswordResponse(email, code),
    });
  } catch (error) {
    return next(error);
  }
}

async function resendPasswordReset(req, res, next) {
  try {
    const validation = validateForgotPasswordPayload(req.body || {});

    if (validation.error) {
      return res.status(400).json({
        success: false,
        message: validation.error,
      });
    }

    const { email } = validation.value;
    const { code, user } = await issuePasswordResetCode(email);

    if (user) {
      try {
        await deliverPasswordResetCode(user, email, code);
      } catch (error) {
        console.error("Failed to resend password reset email:", error);

        return res.status(503).json({
          success: false,
          message: "Password reset email could not be sent right now",
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "If an account with this email exists, a new password reset code has been sent",
      data: buildForgotPasswordResponse(email, code),
    });
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const validation = validateResetPasswordPayload(req.body || {});

    if (validation.error) {
      return res.status(400).json({
        success: false,
        message: validation.error,
      });
    }

    const { token, password } = validation.value;
    const tokenHash = hashPasswordResetToken(token);

    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetTokenExpiresAt: { $gt: new Date() },
    }).select("+passwordHash +passwordSalt +passwordResetTokenHash +passwordResetTokenExpiresAt");

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Reset token is invalid or has expired",
      });
    }

    const { salt, passwordHash } = hashPassword(password);

    user.passwordSalt = salt;
    user.passwordHash = passwordHash;
    user.passwordResetTokenHash = null;
    user.passwordResetTokenExpiresAt = null;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch (error) {
    return next(error);
  }
}

async function getMe(req, res, next) {
  try {
    return res.status(200).json({
      success: true,
      message: "Authenticated user fetched successfully",
      data: {
        user: req.user,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  signup,
  login,
  forgotPassword,
  resendPasswordReset,
  resetPassword,
  getMe,
};

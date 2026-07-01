const nodemailer = require("nodemailer");

let transporter = null;
const smtpTimeoutMs = Number(process.env.SMTP_TIMEOUT_MS) || 15000;
const UK_TIME_ZONE = "Europe/London";

function normalizeEnvValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getMailerConfig() {
  const host = normalizeEnvValue(process.env.SMTP_HOST);
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = normalizeEnvValue(process.env.SMTP_USER);
  const pass = normalizeEnvValue(process.env.SMTP_PASS);
  const fromEmail = normalizeEnvValue(process.env.SMTP_FROM_EMAIL) || user;
  const fromName = normalizeEnvValue(process.env.SMTP_FROM_NAME) || "London & Essex Electrical Training";

  return {
    host,
    port,
    user,
    pass,
    fromEmail,
    fromName,
  };
}

function ensureMailerConfig() {
  const config = getMailerConfig();

  if (!config.host || !config.port || !config.user || !config.pass || !config.fromEmail) {
    throw new Error("SMTP is not configured");
  }

  return config;
}

function isMailerReady() {
  const config = getMailerConfig();
  return Boolean(config.host && config.port && config.user && config.pass && config.fromEmail);
}

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  const config = ensureMailerConfig();

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    connectionTimeout: smtpTimeoutMs,
    greetingTimeout: smtpTimeoutMs,
    socketTimeout: smtpTimeoutMs,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  return transporter;
}

function buildFromHeader(fromName, fromEmail) {
  return fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendPasswordResetEmail({ to, name, code, expiresInMinutes, resetUrl }) {
  const config = ensureMailerConfig();
  const mailTransport = getTransporter();
  const greeting = name ? `Hi ${name},` : "Hello,";

  const subject = "Your password reset code";
  const text = [
    greeting,
    "",
    "We received a request to reset your password.",
    `Your 6-digit password reset code is: ${code}`,
    `This code expires in ${expiresInMinutes} minutes.`,
    "",
    `You can also reset your password here: ${resetUrl}`,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <p>${greeting}</p>
      <p>We received a request to reset your password.</p>
      <p>
        Your 6-digit password reset code is:
        <strong style="font-size: 22px; letter-spacing: 4px;">${code}</strong>
      </p>
      <p>This code expires in ${expiresInMinutes} minutes.</p>
      <p>
        You can also reset your password here:
        <a href="${resetUrl}">${resetUrl}</a>
      </p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `;

  return mailTransport.sendMail({
    from: buildFromHeader(config.fromName, config.fromEmail),
    to,
    subject,
    text,
    html,
  });
}

async function sendCandidateReminderEmail({
  to,
  candidateName,
  courseTitle,
  progressLabel,
  dashboardUrl,
}) {
  const config = ensureMailerConfig();
  const mailTransport = getTransporter();
  const greetingName = candidateName || "Candidate";
  const course = courseTitle || "your course";
  const progress = progressLabel || "0.0%";
  const subject = `Reminder to complete your ${course} registration`;

  const text = [
    `Dear ${greetingName},`,
    "",
    `This is a friendly reminder to complete your registration for ${course}. Your current progress is ${progress}. Please log in to continue.`,
    dashboardUrl ? "" : "",
    dashboardUrl ? `Continue here: ${dashboardUrl}` : "",
    "",
    "Best regards,",
    "Admin Team",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <p>Dear ${escapeHtml(greetingName)},</p>
      <p>
        This is a friendly reminder to complete your registration for
        <strong>${escapeHtml(course)}</strong>. Your current progress is
        <strong>${escapeHtml(progress)}</strong>. Please log in to continue.
      </p>
      ${
        dashboardUrl
          ? `<p><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:12px 18px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:8px;">Continue registration</a></p>`
          : ""
      }
      <p>Best regards,<br />Admin Team</p>
    </div>
  `;

  return mailTransport.sendMail({
    from: buildFromHeader(config.fromName, config.fromEmail),
    to,
    subject,
    text,
    html,
  });
}

async function sendBookingApprovalEmail({
  to,
  candidateName,
  courseTitle,
  bookingNumber,
  paymentUrl,
  paymentApiUrl,
  amountLabel,
  isPaid = false,
}) {
  const config = ensureMailerConfig();
  const mailTransport = getTransporter();
  const greetingName = candidateName || "Candidate";
  const course = courseTitle || "your course";
  const subject = isPaid
    ? `Your ${course} booking has been approved`
    : `Your ${course} paperwork has been approved`;
  const paymentLine = isPaid
    ? "Your payment has already been recorded, so no further payment action is needed."
    : `You can now proceed to payment${amountLabel ? ` for ${amountLabel}` : ""}.`;
  const actionLabel = isPaid ? "View booking" : "Proceed to payment";
  const actionUrl = paymentUrl || paymentApiUrl || "";

  const text = [
    `Dear ${greetingName},`,
    "",
    `Your paperwork for ${course} has been approved by the admin team.`,
    paymentLine,
    bookingNumber ? `Booking number: ${bookingNumber}` : "",
    actionUrl ? "" : "",
    actionUrl ? `${actionLabel}: ${actionUrl}` : "",
    "",
    "Best regards,",
    "Admin Team",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <p>Dear ${escapeHtml(greetingName)},</p>
      <p>
        Your paperwork for <strong>${escapeHtml(course)}</strong> has been approved by the admin team.
      </p>
      <p>${escapeHtml(paymentLine)}</p>
      ${bookingNumber ? `<p><strong>Booking number:</strong> ${escapeHtml(bookingNumber)}</p>` : ""}
      ${
        actionUrl
          ? `<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 18px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(actionLabel)}</a></p>`
          : ""
      }
      <p>Best regards,<br />Admin Team</p>
    </div>
  `;

  return mailTransport.sendMail({
    from: buildFromHeader(config.fromName, config.fromEmail),
    to,
    subject,
    text,
    html,
  });
}

async function sendTrainingProviderSignatureRequestEmail({
  to,
  providerName,
  candidateName,
  courseTitle,
  subject,
  message,
  signatureLink,
  signatureApiUrl,
  expiresAt,
}) {
  const config = ensureMailerConfig();
  const mailTransport = getTransporter();
  const greeting = providerName ? `Hello ${providerName},` : "Hello,";
  const expiryLine = expiresAt
    ? `This signature link will expire on ${new Date(expiresAt).toLocaleString("en-GB", {
        timeZone: UK_TIME_ZONE,
      })}.`
    : "";

  const text = [
    greeting,
    "",
    message || "A training provider signature has been requested.",
    "",
    candidateName ? `Candidate: ${candidateName}` : "",
    courseTitle ? `Course: ${courseTitle}` : "",
    "",
    `Open the signature link: ${signatureLink}`,
    signatureApiUrl ? `API fallback: ${signatureApiUrl}` : "",
    expiryLine,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <p>${greeting}</p>
      <p>${message || "A training provider signature has been requested."}</p>
      ${candidateName ? `<p><strong>Candidate:</strong> ${candidateName}</p>` : ""}
      ${courseTitle ? `<p><strong>Course:</strong> ${courseTitle}</p>` : ""}
      <p>
        <a href="${signatureLink}" style="display:inline-block;padding:12px 18px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:8px;">
          Open Signature Link
        </a>
      </p>
      ${signatureApiUrl ? `<p>If the button does not work, use this link: <a href="${signatureApiUrl}">${signatureApiUrl}</a></p>` : ""}
      ${expiryLine ? `<p>${expiryLine}</p>` : ""}
    </div>
  `;

  return mailTransport.sendMail({
    from: buildFromHeader(config.fromName, config.fromEmail),
    to,
    subject: subject || "Please add your training provider signature",
    text,
    html,
  });
}

async function sendContactFormNotificationEmail({
  name,
  email,
  phoneNumber,
  message,
  howDidYouFindUs,
}) {
  const config = ensureMailerConfig();
  const mailTransport = getTransporter();
  const contactInbox = normalizeEnvValue(process.env.CONTACT_NOTIFICATION_EMAIL) || config.fromEmail;
  const sourceLabel = howDidYouFindUs
    ? {
        google: "Google",
        social_media: "Social Media",
        friend_or_colleague: "Friend or Colleague",
        returning_customer: "Returning Customer",
        advertisement: "Advertisement",
        other: "Other",
      }[howDidYouFindUs] || howDidYouFindUs
    : "Not provided";

  const subject = `New contact enquiry from ${name || "website visitor"}`;
  const text = [
    "A new contact form enquiry has been submitted.",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phoneNumber}`,
    `How did you find us?: ${sourceLabel}`,
    "",
    "Message:",
    message,
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <p>A new contact form enquiry has been submitted.</p>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phoneNumber}</p>
      <p><strong>How did you find us?:</strong> ${sourceLabel}</p>
      <p><strong>Message:</strong></p>
      <p style="white-space: pre-wrap;">${message}</p>
    </div>
  `;

  return mailTransport.sendMail({
    from: buildFromHeader(config.fromName, config.fromEmail),
    to: contactInbox,
    replyTo: email || undefined,
    subject,
    text,
    html,
  });
}

module.exports = {
  isMailerReady,
  sendPasswordResetEmail,
  sendCandidateReminderEmail,
  sendBookingApprovalEmail,
  sendTrainingProviderSignatureRequestEmail,
  sendContactFormNotificationEmail,
};

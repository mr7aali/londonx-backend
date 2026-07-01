const mongoose = require("mongoose");

const ContactMessage = require("../models/ContactMessage");
const { sendContactFormNotificationEmail, isMailerReady } = require("../utils/mailer");

const CONTACT_SOURCE_OPTIONS = [
  "google",
  "social_media",
  "friend_or_colleague",
  "returning_customer",
  "advertisement",
  "other",
];

const CONTACT_STATUSES = ["new", "read", "resolved"];
const UK_TIME_ZONE = "Europe/London";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function formatDisplayDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhoneNumber(phoneNumber) {
  return /^[0-9+\-\s()]{7,30}$/.test(phoneNumber);
}

function getContactSourceLabel(value) {
  return {
    google: "Google",
    social_media: "Social Media",
    friend_or_colleague: "Friend or Colleague",
    returning_customer: "Returning Customer",
    advertisement: "Advertisement",
    other: "Other",
  }[value] || value;
}

function getContactStatusLabel(value) {
  return {
    new: "New",
    read: "Read",
    resolved: "Resolved",
  }[value] || value;
}

function buildContactScreen() {
  return {
    title: "Get in Touch",
    subtitle:
      "Have a question or need assistance? Reach out to us via email, phone, or the contact form below. We're eager to assist you.",
    badge: "Nice hearing from you!",
    form: {
      submitAction: {
        label: "Send",
        method: "POST",
        apiUrl: "/api/contact",
      },
      fields: [
        { id: "name", label: "Name", type: "text", required: true, placeholder: "Name" },
        { id: "email", label: "Email", type: "email", required: true, placeholder: "Email" },
        {
          id: "phoneNumber",
          label: "Phone Number",
          type: "tel",
          required: true,
          placeholder: "Phone number",
        },
        {
          id: "message",
          label: "Label",
          type: "textarea",
          required: true,
          placeholder: "Tell us how we can help",
        },
        {
          id: "howDidYouFindUs",
          label: "How did you find us?",
          type: "select",
          required: false,
          placeholder: "How did you find us?",
          options: CONTACT_SOURCE_OPTIONS.map((option) => ({
            value: option,
            label: getContactSourceLabel(option),
          })),
        },
      ],
    },
    contactMethods: [
      {
        id: "phone",
        label: "Phone",
        value: process.env.CONTACT_PHONE || "03 5432 1234",
      },
      {
        id: "fax",
        label: "Fax",
        value: process.env.CONTACT_FAX || "03 5432 1234",
      },
      {
        id: "email",
        label: "Email",
        value: process.env.CONTACT_EMAIL || "info@smartcl.com.au",
      },
    ],
  };
}

function mapContactMessage(message) {
  return {
    id: String(message._id),
    name: message.name,
    email: message.email,
    phoneNumber: message.phoneNumber,
    message: message.message,
    howDidYouFindUs: {
      value: message.howDidYouFindUs || "",
      label: getContactSourceLabel(message.howDidYouFindUs || ""),
    },
    status: {
      value: message.status,
      label: getContactStatusLabel(message.status),
    },
    createdAt: message.createdAt,
    createdAtLabel: formatDisplayDateTime(message.createdAt),
    updatedAt: message.updatedAt,
    updatedAtLabel: formatDisplayDateTime(message.updatedAt),
    respondedAt: message.respondedAt || null,
    respondedAtLabel: formatDisplayDateTime(message.respondedAt),
  };
}

function buildAdminContactScreen(messages) {
  return {
    title: "Contact Messages",
    subtitle: "Review incoming public contact form submissions.",
    filters: {
      statuses: CONTACT_STATUSES.map((status) => ({
        value: status,
        label: getContactStatusLabel(status),
      })),
    },
    actions: {
      list: {
        label: "Refresh",
        method: "GET",
        apiUrl: "/api/admin/contact/messages",
      },
    },
    sections: {
      messages: {
        title: "Messages",
        items: messages.map((message) => ({
          ...mapContactMessage(message),
          actions: {
            view: {
              label: "View Message",
              apiUrl: `/api/admin/contact/messages/${message._id}`,
            },
            markRead: {
              label: "Mark Read",
              method: "PATCH",
              apiUrl: `/api/admin/contact/messages/${message._id}`,
              enabled: message.status === "new",
              body: { status: "read" },
            },
            markResolved: {
              label: "Mark Resolved",
              method: "PATCH",
              apiUrl: `/api/admin/contact/messages/${message._id}`,
              enabled: message.status !== "resolved",
              body: { status: "resolved" },
            },
          },
        })),
      },
    },
  };
}

function parseAdminFilters(query) {
  const status = normalizeString(query.status).toLowerCase();

  return {
    status: CONTACT_STATUSES.includes(status) ? status : "",
  };
}

function buildAdminFilterQuery(filters) {
  const query = {};

  if (filters.status) {
    query.status = filters.status;
  }

  return query;
}

function validateContactPayload(body) {
  const name = normalizeString(body.name);
  const email = normalizeEmail(body.email);
  const phoneNumber = normalizeString(body.phoneNumber);
  const message = normalizeString(body.message);
  const howDidYouFindUs = normalizeString(body.howDidYouFindUs).toLowerCase().replace(/\s+/g, "_");

  if (name.length < 2) {
    return { error: "Name must be at least 2 characters long", status: 400 };
  }

  if (!validateEmail(email)) {
    return { error: "A valid email is required", status: 400 };
  }

  if (!validatePhoneNumber(phoneNumber)) {
    return { error: "Phone number must be between 7 and 30 valid characters", status: 400 };
  }

  if (message.length < 5) {
    return { error: "Message must be at least 5 characters long", status: 400 };
  }

  if (howDidYouFindUs && !CONTACT_SOURCE_OPTIONS.includes(howDidYouFindUs)) {
    return {
      error: "howDidYouFindUs must be google, social_media, friend_or_colleague, returning_customer, advertisement, or other",
      status: 400,
    };
  }

  return {
    value: {
      name,
      email,
      phoneNumber,
      message,
      howDidYouFindUs,
    },
  };
}

async function getContactScreen(req, res, next) {
  try {
    return res.status(200).json({
      success: true,
      message: "Contact screen fetched successfully",
      data: {
        screen: buildContactScreen(),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function submitContactMessage(req, res, next) {
  try {
    const validation = validateContactPayload(req.body || {});
    if (validation.error) {
      return res.status(validation.status).json({
        success: false,
        message: validation.error,
      });
    }

    const contactMessage = await ContactMessage.create({
      ...validation.value,
      status: "new",
    });

    let emailNotification = {
      attempted: false,
      delivered: false,
    };

    if (isMailerReady()) {
      emailNotification.attempted = true;

      try {
        await sendContactFormNotificationEmail({
          name: contactMessage.name,
          email: contactMessage.email,
          phoneNumber: contactMessage.phoneNumber,
          message: contactMessage.message,
          howDidYouFindUs: contactMessage.howDidYouFindUs,
        });
        emailNotification.delivered = true;
      } catch (mailError) {
        console.error("Failed to send contact form notification email:", mailError);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Contact message sent successfully",
      data: {
        submission: mapContactMessage(contactMessage),
        emailNotification,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listAdminContactMessages(req, res, next) {
  try {
    const filters = parseAdminFilters(req.query);
    const messages = await ContactMessage.find(buildAdminFilterQuery(filters)).sort({
      createdAt: -1,
      updatedAt: -1,
    });

    return res.status(200).json({
      success: true,
      message: "Admin contact messages fetched successfully",
      data: {
        screen: buildAdminContactScreen(messages),
        messages: messages.map(mapContactMessage),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getAdminContactMessageById(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid contact message id",
      });
    }

    const message = await ContactMessage.findById(req.params.id);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Contact message not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Admin contact message fetched successfully",
      data: {
        message: mapContactMessage(message),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateAdminContactMessage(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid contact message id",
      });
    }

    const status = normalizeString(req.body.status).toLowerCase();
    if (!CONTACT_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be new, read, or resolved",
      });
    }

    const message = await ContactMessage.findById(req.params.id);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Contact message not found",
      });
    }

    message.status = status;
    message.respondedAt = status === "resolved" ? message.respondedAt || new Date() : null;
    await message.save();

    return res.status(200).json({
      success: true,
      message: "Contact message updated successfully",
      data: {
        message: mapContactMessage(message),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getContactScreen,
  submitContactMessage,
  listAdminContactMessages,
  getAdminContactMessageById,
  updateAdminContactMessage,
};

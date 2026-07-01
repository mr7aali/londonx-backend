const mongoose = require("mongoose");

const SupportTicket = require("../models/SupportTicket");

const SUPPORT_PRIORITIES = ["low", "medium", "high"];
const SUPPORT_STATUSES = ["new", "in_progress", "resolved"];
const SUPPORT_CATEGORIES = [
  "bookings",
  "payment",
  "documents",
  "checklist",
  "signature",
  "technical",
  "general",
];
const UK_TIME_ZONE = "Europe/London";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLowerString(value) {
  return normalizeString(value).toLowerCase();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function getPriorityLabel(priority) {
  return {
    low: "Low",
    medium: "Medium",
    high: "High",
  }[priority] || "Medium";
}

function getStatusLabel(status) {
  return {
    new: "New",
    in_progress: "In Progress",
    resolved: "Resolved",
  }[status] || "New";
}

function getCategoryLabel(category) {
  const normalized = normalizeLowerString(category);

  return {
    bookings: "Bookings",
    payment: "Payment",
    documents: "Documents",
    checklist: "Checklist",
    signature: "Signature",
    technical: "Technical",
    general: "General",
  }[normalized] || category;
}

function buildSupportCategoryOptions() {
  return SUPPORT_CATEGORIES.map((category) => ({
    value: category,
    label: getCategoryLabel(category),
  }));
}

function buildSupportPriorityOptions() {
  return SUPPORT_PRIORITIES.map((priority) => ({
    value: priority,
    label: getPriorityLabel(priority),
  }));
}

function buildSupportStatusOptions() {
  return SUPPORT_STATUSES.map((status) => ({
    value: status,
    label: getStatusLabel(status),
  }));
}

function buildTicketQueryForUser(userId, ticketId) {
  return {
    _id: ticketId,
    user: userId,
  };
}

async function generateTicketNumber() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextSequence = (await SupportTicket.countDocuments()) + 1 + attempt;
    const ticketNumber = `T-${String(nextSequence).padStart(3, "0")}`;
    const existingTicket = await SupportTicket.exists({ ticketNumber });

    if (!existingTicket) {
      return ticketNumber;
    }
  }

  return `T-${Date.now()}`;
}

function mapSupportReply(reply) {
  return {
    id: String(reply._id),
    authorType: reply.authorType,
    authorName: reply.authorName,
    message: reply.message,
    createdAt: reply.createdAt,
    createdAtLabel: formatDisplayDateTime(reply.createdAt),
  };
}

function mapSupportTicketCard(ticket, includeReplies = false) {
  const replies = Array.isArray(ticket.replies) ? ticket.replies : [];
  const firstMessage = replies[0] || null;
  const latestMessage = replies[replies.length - 1] || null;

  return {
    id: String(ticket._id),
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    category: {
      value: ticket.category,
      label: getCategoryLabel(ticket.category),
    },
    priority: {
      value: ticket.priority,
      label: getPriorityLabel(ticket.priority),
    },
    status: {
      value: ticket.status,
      label: getStatusLabel(ticket.status),
    },
    previewMessage: firstMessage ? firstMessage.message : "",
    latestReplyPreview: latestMessage ? latestMessage.message : "",
    replyCount: replies.length,
    createdAt: ticket.createdAt,
    createdAtLabel: formatDisplayDateTime(ticket.createdAt),
    updatedAt: ticket.updatedAt,
    updatedAtLabel: formatDisplayDateTime(ticket.updatedAt),
    lastReplyAt: ticket.lastReplyAt || ticket.updatedAt,
    lastReplyAtLabel: formatDisplayDateTime(ticket.lastReplyAt || ticket.updatedAt),
    resolvedAt: ticket.resolvedAt || null,
    resolvedAtLabel: formatDisplayDateTime(ticket.resolvedAt),
    actions: {
      view: {
        label: "View Ticket",
        apiUrl: `/api/support/tickets/${ticket._id}`,
      },
      reply: {
        label: "Reply",
        method: "POST",
        apiUrl: `/api/support/tickets/${ticket._id}/replies`,
        enabled: ticket.status !== "resolved",
      },
    },
    replies: includeReplies ? replies.map(mapSupportReply) : undefined,
  };
}

function buildSupportComposer(ticketId) {
  return {
    placeholder: "Type your reply...",
    submitAction: {
      label: "Send Reply",
      method: "POST",
      apiUrl: `/api/support/tickets/${ticketId}/replies`,
    },
  };
}

function buildSupportTicketDetail(ticket, actor = "user") {
  const ticketCard = mapSupportTicketCard(ticket, true);

  return {
    ...ticketCard,
    composer: buildSupportComposer(ticket._id),
    adminActions:
      actor === "admin"
        ? {
            statusOptions: buildSupportStatusOptions(),
            updateStatus: {
              label: "Update Status",
              method: "PATCH",
              apiUrl: `/api/admin/support/tickets/${ticket._id}`,
            },
            reply: {
              label: "Send Reply",
              method: "POST",
              apiUrl: `/api/admin/support/tickets/${ticket._id}/replies`,
            },
          }
        : undefined,
  };
}

function buildSupportScreen(tickets) {
  return {
    title: "Support",
    subtitle: "Need help? Submit a ticket and we'll get back to you.",
    filters: {
      categories: buildSupportCategoryOptions(),
      priorities: buildSupportPriorityOptions(),
      statuses: buildSupportStatusOptions(),
    },
    actions: {
      newTicket: {
        label: "New Ticket",
        method: "POST",
        apiUrl: "/api/support/tickets",
      },
    },
    form: {
      title: "Submit a New Ticket",
      fields: [
        { id: "subject", label: "Subject", type: "text", required: true },
        {
          id: "category",
          label: "Category",
          type: "select",
          required: true,
          options: buildSupportCategoryOptions(),
        },
        {
          id: "priority",
          label: "Priority",
          type: "select",
          required: true,
          options: buildSupportPriorityOptions(),
        },
        { id: "message", label: "Message", type: "textarea", required: true },
      ],
    },
    sections: {
      myTickets: {
        title: "My Tickets",
        tickets: tickets.map((ticket) => mapSupportTicketCard(ticket)),
      },
    },
  };
}

function buildAdminSupportScreen(tickets) {
  return {
    title: "Support",
    subtitle: "Review candidate support tickets and reply from one place.",
    breadcrumb: [
      { label: "Dashboard", href: "/admin/dashboard" },
      { label: "Support", href: "/admin/support" },
    ],
    search: {
      placeholder: "Search...",
      queryParam: "search",
    },
    filters: {
      title: "Filter",
      categories: buildSupportCategoryOptions(),
      priorities: buildSupportPriorityOptions(),
      statuses: buildSupportStatusOptions(),
    },
    sections: {
      tickets: {
        title: "Candidates",
        items: tickets.map((ticket) => ({
          ...mapSupportTicketCard(ticket, true),
          requester: {
            id: String(ticket.user?._id || ""),
            name: ticket.user?.name || "",
            email: ticket.user?.email || "",
          },
          actions: {
            view: {
              label: "View Ticket",
              apiUrl: `/api/admin/support/tickets/${ticket._id}`,
            },
            reply: {
              label: "Send Reply",
              method: "POST",
              apiUrl: `/api/admin/support/tickets/${ticket._id}/replies`,
              enabled: ticket.status !== "resolved",
            },
            markResolved: {
              label: "Mark Resolved",
              method: "PATCH",
              apiUrl: `/api/admin/support/tickets/${ticket._id}`,
              enabled: ticket.status !== "resolved",
              body: {
                status: "resolved",
              },
            },
            reopen: {
              label: "Reopen",
              method: "PATCH",
              apiUrl: `/api/admin/support/tickets/${ticket._id}`,
              enabled: ticket.status === "resolved",
              body: {
                status: "in_progress",
              },
            },
          },
          composer: {
            placeholder: "Type your reply...",
            submitAction: {
              label: "Send Reply",
              method: "POST",
              apiUrl: `/api/admin/support/tickets/${ticket._id}/replies`,
            },
          },
        })),
      },
    },
  };
}

function parseTicketFilters(query) {
  const status = normalizeLowerString(query.status);
  const priority = normalizeLowerString(query.priority);
  const category = normalizeLowerString(query.category);
  const search = normalizeString(query.search);

  return {
    status: SUPPORT_STATUSES.includes(status) ? status : "",
    priority: SUPPORT_PRIORITIES.includes(priority) ? priority : "",
    category: SUPPORT_CATEGORIES.includes(category) ? category : "",
    search,
  };
}

function buildTicketFilterQuery(filters, userId = null) {
  const query = {};

  if (userId) {
    query.user = userId;
  }

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.priority) {
    query.priority = filters.priority;
  }

  if (filters.category) {
    query.category = filters.category;
  }

  if (filters.search) {
    const regex = new RegExp(escapeRegex(filters.search), "i");
    query.$or = [{ subject: regex }, { ticketNumber: regex }, { "replies.message": regex }];
  }

  return query;
}

async function findSupportTicketForUser(ticketId, userId) {
  if (!mongoose.isValidObjectId(ticketId)) {
    return { error: "Invalid support ticket id", status: 400 };
  }

  const ticket = await SupportTicket.findOne(buildTicketQueryForUser(userId, ticketId))
    .populate("user", "name email")
    .populate("replies.author", "name email role");

  if (!ticket) {
    return { error: "Support ticket not found", status: 404 };
  }

  return { value: ticket };
}

async function findSupportTicketForAdmin(ticketId) {
  if (!mongoose.isValidObjectId(ticketId)) {
    return { error: "Invalid support ticket id", status: 400 };
  }

  const ticket = await SupportTicket.findById(ticketId)
    .populate("user", "name email")
    .populate("replies.author", "name email role");

  if (!ticket) {
    return { error: "Support ticket not found", status: 404 };
  }

  return { value: ticket };
}

function validateSupportTicketPayload(body) {
  const subject = normalizeString(body.subject);
  const category = normalizeLowerString(body.category);
  const priority = normalizeLowerString(body.priority || "medium");
  const message = normalizeString(body.message);

  if (subject.length < 3) {
    return { error: "Subject must be at least 3 characters long", status: 400 };
  }

  if (!SUPPORT_CATEGORIES.includes(category)) {
    return { error: "category must be one of bookings, payment, documents, checklist, signature, technical, or general", status: 400 };
  }

  if (!SUPPORT_PRIORITIES.includes(priority)) {
    return { error: "priority must be low, medium, or high", status: 400 };
  }

  if (message.length < 10) {
    return { error: "Message must be at least 10 characters long", status: 400 };
  }

  return {
    value: {
      subject,
      category,
      priority,
      message,
    },
  };
}

function validateReplyMessage(body) {
  const message = normalizeString(body.message);

  if (message.length < 1) {
    return { error: "Reply message is required", status: 400 };
  }

  if (message.length > 5000) {
    return { error: "Reply message must not exceed 5000 characters", status: 400 };
  }

  return { value: message };
}

async function getSupportScreen(req, res, next) {
  try {
    const filters = parseTicketFilters(req.query);
    const tickets = await SupportTicket.find(buildTicketFilterQuery(filters, req.user.id))
      .sort({ lastReplyAt: -1, updatedAt: -1, createdAt: -1 })
      .populate("user", "name email")
      .limit(100);

    return res.status(200).json({
      success: true,
      message: "Support screen fetched successfully",
      data: {
        screen: buildSupportScreen(tickets),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listMySupportTickets(req, res, next) {
  try {
    const filters = parseTicketFilters(req.query);
    const tickets = await SupportTicket.find(buildTicketFilterQuery(filters, req.user.id))
      .sort({ lastReplyAt: -1, updatedAt: -1, createdAt: -1 })
      .populate("user", "name email")
      .limit(100);

    return res.status(200).json({
      success: true,
      message: "Support tickets fetched successfully",
      data: {
        tickets: tickets.map((ticket) => mapSupportTicketCard(ticket)),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function createSupportTicket(req, res, next) {
  try {
    const payloadResult = validateSupportTicketPayload(req.body);
    if (payloadResult.error) {
      return res.status(payloadResult.status).json({
        success: false,
        message: payloadResult.error,
      });
    }

    const ticket = await SupportTicket.create({
      ticketNumber: await generateTicketNumber(),
      user: req.user.id,
      subject: payloadResult.value.subject,
      category: payloadResult.value.category,
      priority: payloadResult.value.priority,
      status: "new",
      lastReplyAt: new Date(),
      replies: [
        {
          authorType: "user",
          author: req.user.id,
          authorName: req.user.name,
          message: payloadResult.value.message,
          createdAt: new Date(),
        },
      ],
    });

    const populatedTicket = await SupportTicket.findById(ticket._id)
      .populate("user", "name email")
      .populate("replies.author", "name email role");

    return res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      data: {
        ticket: buildSupportTicketDetail(populatedTicket),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMySupportTicketById(req, res, next) {
  try {
    const ticketResult = await findSupportTicketForUser(req.params.id, req.user.id);
    if (ticketResult.error) {
      return res.status(ticketResult.status).json({
        success: false,
        message: ticketResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Support ticket fetched successfully",
      data: {
        ticket: buildSupportTicketDetail(ticketResult.value),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function replyToMySupportTicket(req, res, next) {
  try {
    const ticketResult = await findSupportTicketForUser(req.params.id, req.user.id);
    if (ticketResult.error) {
      return res.status(ticketResult.status).json({
        success: false,
        message: ticketResult.error,
      });
    }

    const messageResult = validateReplyMessage(req.body);
    if (messageResult.error) {
      return res.status(messageResult.status).json({
        success: false,
        message: messageResult.error,
      });
    }

    const ticket = ticketResult.value;
    ticket.replies.push({
      authorType: "user",
      author: req.user.id,
      authorName: req.user.name,
      message: messageResult.value,
      createdAt: new Date(),
    });
    ticket.lastReplyAt = new Date();

    if (ticket.status === "resolved") {
      ticket.status = "in_progress";
      ticket.resolvedAt = null;
    }

    await ticket.save();
    await ticket.populate("replies.author", "name email role");

    return res.status(200).json({
      success: true,
      message: "Reply sent successfully",
      data: {
        ticket: buildSupportTicketDetail(ticket),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listAdminSupportTickets(req, res, next) {
  try {
    const filters = parseTicketFilters(req.query);
    const tickets = await SupportTicket.find(buildTicketFilterQuery(filters))
      .sort({ lastReplyAt: -1, updatedAt: -1, createdAt: -1 })
      .populate("user", "name email")
      .limit(100);

    return res.status(200).json({
      success: true,
      message: "Admin support tickets fetched successfully",
      data: {
        filters: {
          categories: buildSupportCategoryOptions(),
          priorities: buildSupportPriorityOptions(),
          statuses: buildSupportStatusOptions(),
        },
        tickets: tickets.map((ticket) => ({
          ...mapSupportTicketCard(ticket),
          requester: {
            id: String(ticket.user?._id || ""),
            name: ticket.user?.name || "",
            email: ticket.user?.email || "",
          },
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getAdminSupportScreen(req, res, next) {
  try {
    const filters = parseTicketFilters(req.query);
    const tickets = await SupportTicket.find(buildTicketFilterQuery(filters))
      .sort({ lastReplyAt: -1, updatedAt: -1, createdAt: -1 })
      .populate("user", "name email")
      .populate("replies.author", "name email role")
      .limit(100);

    return res.status(200).json({
      success: true,
      message: "Admin support screen fetched successfully",
      data: {
        screen: buildAdminSupportScreen(tickets),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getAdminSupportTicketById(req, res, next) {
  try {
    const ticketResult = await findSupportTicketForAdmin(req.params.id);
    if (ticketResult.error) {
      return res.status(ticketResult.status).json({
        success: false,
        message: ticketResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Admin support ticket fetched successfully",
      data: {
        ticket: {
          ...buildSupportTicketDetail(ticketResult.value, "admin"),
          requester: {
            id: String(ticketResult.value.user?._id || ""),
            name: ticketResult.value.user?.name || "",
            email: ticketResult.value.user?.email || "",
          },
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function replyToAdminSupportTicket(req, res, next) {
  try {
    const ticketResult = await findSupportTicketForAdmin(req.params.id);
    if (ticketResult.error) {
      return res.status(ticketResult.status).json({
        success: false,
        message: ticketResult.error,
      });
    }

    const messageResult = validateReplyMessage(req.body);
    if (messageResult.error) {
      return res.status(messageResult.status).json({
        success: false,
        message: messageResult.error,
      });
    }

    const ticket = ticketResult.value;
    ticket.replies.push({
      authorType: "admin",
      author: req.user.id,
      authorName: req.user.name,
      message: messageResult.value,
      createdAt: new Date(),
    });
    ticket.lastReplyAt = new Date();

    if (ticket.status === "new") {
      ticket.status = "in_progress";
    }

    await ticket.save();
    await ticket.populate("replies.author", "name email role");

    return res.status(200).json({
      success: true,
      message: "Admin reply sent successfully",
      data: {
        ticket: buildSupportTicketDetail(ticket, "admin"),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateAdminSupportTicket(req, res, next) {
  try {
    const ticketResult = await findSupportTicketForAdmin(req.params.id);
    if (ticketResult.error) {
      return res.status(ticketResult.status).json({
        success: false,
        message: ticketResult.error,
      });
    }

    const nextStatus = normalizeLowerString(req.body.status);
    if (!SUPPORT_STATUSES.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: "status must be new, in_progress, or resolved",
      });
    }

    const ticket = ticketResult.value;
    ticket.status = nextStatus;
    ticket.resolvedAt = nextStatus === "resolved" ? ticket.resolvedAt || new Date() : null;

    await ticket.save();

    return res.status(200).json({
      success: true,
      message: "Support ticket updated successfully",
      data: {
        ticket: buildSupportTicketDetail(ticket, "admin"),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getSupportScreen,
  listMySupportTickets,
  createSupportTicket,
  getMySupportTicketById,
  replyToMySupportTicket,
  getAdminSupportScreen,
  listAdminSupportTickets,
  getAdminSupportTicketById,
  replyToAdminSupportTicket,
  updateAdminSupportTicket,
};

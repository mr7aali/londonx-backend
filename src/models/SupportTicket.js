const mongoose = require("mongoose");

const supportReplySchema = new mongoose.Schema(
  {
    authorType: {
      type: String,
      enum: ["user", "admin", "system"],
      required: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    authorName: {
      type: String,
      trim: true,
      maxlength: 120,
      required: true,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 5000,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
  }
);

const supportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      trim: true,
      unique: true,
      required: true,
      maxlength: 30,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subject: {
      type: String,
      trim: true,
      required: true,
      minlength: 3,
      maxlength: 160,
    },
    category: {
      type: String,
      trim: true,
      required: true,
      maxlength: 80,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      required: true,
      default: "medium",
    },
    status: {
      type: String,
      enum: ["new", "in_progress", "resolved"],
      required: true,
      default: "new",
      index: true,
    },
    replies: {
      type: [supportReplySchema],
      default: [],
    },
    lastReplyAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("SupportTicket", supportTicketSchema);

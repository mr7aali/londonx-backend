const mongoose = require("mongoose");

const TeamMember = require("../models/TeamMember");

const TEAM_SECTION = {
  badge: "Our Team",
  title: "Meet Our Team",
  subtitle:
    "A dedicated team of professionals committed to improving the electrical training experience.",
};

const DEFAULT_TEAM_MEMBERS = [
  {
    id: "sophia-garcia-cofounder",
    name: "Sophia Garcia",
    role: "CEO & Co-Founder",
    imageUrl: "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=900&q=80",
    order: 1,
  },
  {
    id: "chloe-ramirez-senior-web-developer",
    name: "Chloe Ramirez",
    role: "Senior Web Developer",
    imageUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=900&q=80",
    order: 2,
  },
  {
    id: "ethan-parker-senior-web-developer",
    name: "Ethan Parker",
    role: "Senior Web Developer",
    imageUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&q=80",
    order: 3,
  },
  {
    id: "mia-kim-cofounder",
    name: "Mia Kim",
    role: "CEO & Co-Founder",
    imageUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=80",
    order: 4,
  },
  {
    id: "lila-thompson-senior-web-developer",
    name: "Lila Thompson",
    role: "Senior Web Developer",
    imageUrl: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=900&q=80",
    order: 5,
  },
  {
    id: "ava-bennett-creative-director",
    name: "Ava Bennett",
    role: "Creative Director",
    imageUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=900&q=80",
    order: 6,
  },
];

function mapTeamMember(member) {
  return {
    id: member._id || member.id,
    name: member.name,
    role: member.role,
    imageUrl: member.imageUrl,
    bio: member.bio || "",
    isPublished: typeof member.isPublished === "boolean" ? member.isPublished : true,
    order: Number.isFinite(member.order) ? member.order : 0,
    alt: `${member.name} - ${member.role}`,
  };
}

function mapTeamCard(member) {
  return {
    ...mapTeamMember(member),
    overlay: {
      align: "bottom-left",
      theme: "light-gradient",
    },
  };
}

function mapAdminTeamMember(member) {
  return {
    id: member._id,
    name: member.name,
    role: member.role,
    imageUrl: member.imageUrl,
    bio: member.bio || "",
    isPublished: member.isPublished,
    order: member.order,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value, fallbackValue = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }

    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return fallbackValue;
}

function normalizeNumber(value, fallbackValue = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return fallbackValue;
}

function parsePagination(query) {
  const page = Math.max(1, Math.floor(normalizeNumber(query.page, 1)));
  const limit = Math.min(100, Math.max(1, Math.floor(normalizeNumber(query.limit, 10))));

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTeamMemberPayload(payload, options = {}) {
  const { partial = false } = options;
  const teamMemberData = {};

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "name")) {
    const name = normalizeString(payload.name);

    if (!name) {
      return { error: "Name is required" };
    }

    if (name.length < 2 || name.length > 120) {
      return { error: "Name must be between 2 and 120 characters" };
    }

    teamMemberData.name = name;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "role")) {
    const role = normalizeString(payload.role);

    if (!role) {
      return { error: "Role is required" };
    }

    if (role.length < 2 || role.length > 120) {
      return { error: "Role must be between 2 and 120 characters" };
    }

    teamMemberData.role = role;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "imageUrl")) {
    const imageUrl = normalizeString(payload.imageUrl);

    if (imageUrl.length > 500) {
      return { error: "Image URL must be 500 characters or fewer" };
    }

    teamMemberData.imageUrl = imageUrl;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "bio")) {
    const bio = normalizeString(payload.bio);

    if (bio.length > 1000) {
      return { error: "Bio must be 1000 characters or fewer" };
    }

    teamMemberData.bio = bio;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "isPublished")) {
    teamMemberData.isPublished = normalizeBoolean(payload.isPublished, true);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "order")) {
    const order = normalizeNumber(payload.order, 0);

    if (!Number.isInteger(order) || order < 0) {
      return { error: "Order must be a non-negative integer" };
    }

    teamMemberData.order = order;
  }

  return { value: teamMemberData };
}

async function fetchPublishedTeamMembers() {
  const teamMembers = await TeamMember.find({ isPublished: true }).sort({ order: 1, createdAt: 1 });

  if (teamMembers.length > 0) {
    return teamMembers;
  }

  return DEFAULT_TEAM_MEMBERS;
}

async function listTeamMembers(req, res, next) {
  try {
    const members = (await fetchPublishedTeamMembers()).map(mapTeamMember);

    return res.status(200).json({
      success: true,
      message: "Team members fetched successfully",
      data: {
        section: TEAM_SECTION,
        members,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getTeamScreen(req, res, next) {
  try {
    const cards = (await fetchPublishedTeamMembers()).map(mapTeamCard);

    return res.status(200).json({
      success: true,
      message: "Team screen fetched successfully",
      data: {
        screen: {
          ...TEAM_SECTION,
          layout: {
            type: "grid",
            columns: {
              mobile: 1,
              tablet: 2,
              desktop: 3,
            },
          },
          cards,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listAdminTeamMembers(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query || {});
    const search = normalizeString(req.query.search);
    const filter = {};

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: searchRegex }, { role: searchRegex }, { bio: searchRegex }];
    }

    if (Object.prototype.hasOwnProperty.call(req.query || {}, "isPublished")) {
      filter.isPublished = normalizeBoolean(req.query.isPublished, true);
    }

    const [teamMembers, total] = await Promise.all([
      TeamMember.find(filter)
        .sort({ order: 1, createdAt: 1 })
        .skip(skip)
        .limit(limit),
      TeamMember.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Admin team members fetched successfully",
      data: {
        members: teamMembers.map(mapAdminTeamMember),
        filters: {
          search,
          isPublished:
            Object.prototype.hasOwnProperty.call(req.query || {}, "isPublished")
              ? normalizeBoolean(req.query.isPublished, true)
              : null,
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function createTeamMember(req, res, next) {
  try {
    const payloadResult = buildTeamMemberPayload(req.body || {});

    if (payloadResult.error) {
      return res.status(400).json({
        success: false,
        message: payloadResult.error,
      });
    }

    const teamMemberData = payloadResult.value;

    if (req.uploadedImageUrl) {
      teamMemberData.imageUrl = req.uploadedImageUrl;
    }

    const teamMember = await TeamMember.create(teamMemberData);

    return res.status(201).json({
      success: true,
      message: "Team member created successfully",
      data: {
        member: mapAdminTeamMember(teamMember),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getAdminTeamMemberById(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid team member id",
      });
    }

    const teamMember = await TeamMember.findById(id);

    if (!teamMember) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Team member fetched successfully",
      data: {
        member: mapAdminTeamMember(teamMember),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateTeamMember(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid team member id",
      });
    }

    const teamMember = await TeamMember.findById(id);

    if (!teamMember) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    const payloadResult = buildTeamMemberPayload(req.body || {}, { partial: true });

    if (payloadResult.error) {
      return res.status(400).json({
        success: false,
        message: payloadResult.error,
      });
    }

    const updates = payloadResult.value;

    if (req.uploadedImageUrl) {
      updates.imageUrl = req.uploadedImageUrl;
    }

    Object.assign(teamMember, updates);
    await teamMember.save();

    return res.status(200).json({
      success: true,
      message: "Team member updated successfully",
      data: {
        member: mapAdminTeamMember(teamMember),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listTeamMembers,
  getTeamScreen,
  listAdminTeamMembers,
  createTeamMember,
  getAdminTeamMemberById,
  updateTeamMember,
};

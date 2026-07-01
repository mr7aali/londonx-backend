const mongoose = require("mongoose");

const FaqPage = require("../models/FaqPage");
const LegalPage = require("../models/LegalPage");
const User = require("../models/User");
const { hashPassword, verifyPassword } = require("../utils/auth");

const NOTIFICATION_KEYS = [
  "courseUpdates",
  "bookingConfirmations",
  "checklistReminders",
  "documentRequests",
  "signatureRequests",
  "weeklyProgressDigest",
];

const LEGAL_PAGE_DEFAULTS = {
  "terms-and-conditions": {
    slug: "terms-and-conditions",
    category: "LEGAL",
    title: "Terms & Conditions",
    subtitle: "Edit the title, introduction, and section copy shown on the public terms page.",
    screenDescription: "Manage the public terms and conditions page content.",
    sections: [
      {
        title: "Using Our Website",
        introduction:
          "By using the London & Essex Electrical Training website, you agree to use it lawfully and in a way that does not harm our business, systems, or other visitors. We may update, remove, or improve content, course details, and service information from time to time.",
      },
      {
        title: "Bookings And Payments",
        introduction:
          "Course places are subject to availability. A booking is only confirmed once payment arrangements have been accepted by our team. Prices, schedules, and course availability may change. If a course needs to be rescheduled or cancelled, we will contact affected learners as soon as reasonably possible.",
      },
      {
        title: "Course Information",
        introduction:
          "We work to keep all training information accurate, but course requirements, awarding body guidance, and practical arrangements may change from time to time. It is your responsibility to make sure the course you choose is suitable for your circumstances before booking.",
      },
      {
        title: "Liability",
        introduction:
          "To the extent permitted by law, we are not responsible for indirect or consequential loss arising from use of this website or reliance on general information published here. Nothing in these terms limits liability where it cannot legally be excluded.",
      },
      {
        title: "Contact Us",
        introduction:
          "If you have questions about these terms, please contact our team at info@londonessexelectrical.co.uk.",
      },
    ],
  },
  "privacy-policy": {
    slug: "privacy-policy",
    category: "PRIVACY",
    title: "Privacy Policy",
    subtitle: "Manage the content blocks used on the public privacy policy page.",
    screenDescription: "Manage the public privacy policy page content.",
    sections: [
      {
        title: "Information We Collect",
        introduction:
          "We may collect information you provide directly, such as your name, email address, phone number, booking details, and any messages sent through our forms or support channels. Basic technical information may also be collected when you use the site.",
      },
      {
        title: "How We Use Your Information",
        introduction:
          "We use your information to respond to enquiries, manage bookings, provide learner support, send service-related updates, and improve our training experience. We do not use your personal information for purposes that are unrelated to the services you request.",
      },
      {
        title: "Sharing Your Data",
        introduction:
          "We may share information with trusted service providers or partners when necessary to deliver training, process bookings, maintain systems, or comply with legal obligations. We only share the information that is reasonably required for those purposes.",
      },
      {
        title: "Data Security And Retention",
        introduction:
          "We take reasonable steps to protect personal information from unauthorised access, loss, misuse, or disclosure. Information is retained only for as long as needed for operational, legal, or regulatory reasons.",
      },
    ],
  },
};

const LEGAL_PAGE_ALIASES = {
  terms: "terms-and-conditions",
  "terms-conditions": "terms-and-conditions",
  "terms-and-conditions": "terms-and-conditions",
  privacy: "privacy-policy",
  "privacy-policy": "privacy-policy",
};

const FAQ_PAGE_DEFAULTS = {
  key: "faq",
  category: "SUPPORT",
  title: "FAQ",
  subtitle: "Add, remove, and update frequently asked questions for the public-facing FAQ section.",
  screenDescription: "Manage the public frequently asked questions content.",
  items: [
    {
      question: "Who can join London & Essex training courses?",
      answer:
        "Our courses are suitable for new entrants, career changers, and experienced tradespeople who want to upgrade their qualifications. We offer flexible training pathways depending on your current level and goals.",
    },
    {
      question: "How do these courses help my career?",
      answer:
        "Our training supports career progression by helping learners gain recognised qualifications, practical skills, and confidence for site work, inspection, testing, and assessment pathways.",
    },
    {
      question: "How secure is my data on this platform?",
      answer:
        "We use reasonable safeguards to protect personal data and limit access to authorised staff and service providers who need the information to support your enquiry, booking, or learner journey.",
    },
  ],
};

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
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

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhoneNumber(phoneNumber) {
  return /^[0-9+\-\s()]{7,30}$/.test(phoneNumber);
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

function getInitial(value) {
  return (typeof value === "string" && value.trim() ? value.trim()[0] : "?").toUpperCase();
}

function getAvatarTone(seed) {
  const tones = ["green", "blue", "orange", "red", "cyan", "purple", "indigo", "teal"];
  const normalizedSeed = typeof seed === "string" ? seed : "";
  const toneIndex = normalizedSeed
    .split("")
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);

  return tones[toneIndex % tones.length];
}

function buildSettingsTabs(activeTab) {
  return [
    {
      id: "profile",
      label: "Profile",
      active: activeTab === "profile",
      apiUrl: "/api/settings/profile",
    },
    {
      id: "notifications",
      label: "Notifications",
      active: activeTab === "notifications",
      apiUrl: "/api/settings/notifications",
    },
    {
      id: "security",
      label: "Security",
      active: activeTab === "security",
      apiUrl: "/api/settings/security",
    },
  ];
}

function buildLegalSettingsTabs(activeTab) {
  return [
    {
      id: "profile",
      label: "Profile",
      active: activeTab === "profile",
      apiUrl: "/api/settings/profile",
    },
    {
      id: "notifications",
      label: "Notifications",
      active: activeTab === "notifications",
      apiUrl: "/api/settings/notifications",
    },
    {
      id: "security",
      label: "Security",
      active: activeTab === "security",
      apiUrl: "/api/settings/security",
    },
    {
      id: "terms-and-conditions",
      label: "Terms & Conditions",
      active: activeTab === "terms-and-conditions",
      apiUrl: "/api/settings/legal-pages/terms-and-conditions",
    },
    {
      id: "privacy-policy",
      label: "Privacy Policy",
      active: activeTab === "privacy-policy",
      apiUrl: "/api/settings/legal-pages/privacy-policy",
    },
    {
      id: "faq",
      label: "FAQ",
      active: activeTab === "faq",
      apiUrl: "/api/settings/faqs",
      enabled: true,
    },
  ];
}

function buildSettingsBreadcrumb(activeLabel) {
  return [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Setting", href: "/settings/profile" },
    { label: activeLabel, href: `/settings/${activeLabel.toLowerCase()}` },
  ];
}

function buildLegalSettingsBreadcrumb(page) {
  return [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Setting", href: "/settings/profile" },
    { label: page.title, href: `/settings/${page.slug}` },
  ];
}

function buildFaqSettingsBreadcrumb() {
  return [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Setting", href: "/settings/profile" },
    { label: "FAQ", href: "/settings/faq" },
  ];
}

function buildSettingsSidebarProfile(user = {}) {
  return {
    name: user.name || "",
    email: user.email || "",
    avatar: {
      imageUrl: user.profileImageUrl || "",
      initials: getInitial(user.name || user.email),
      tone: getAvatarTone(user.name || user.email),
    },
  };
}

function buildNotificationSettings(user) {
  const settings = user.notificationSettings || {};

  return {
    courseUpdates: normalizeBoolean(settings.courseUpdates, true),
    bookingConfirmations: normalizeBoolean(settings.bookingConfirmations, true),
    checklistReminders: normalizeBoolean(settings.checklistReminders, true),
    documentRequests: normalizeBoolean(settings.documentRequests, true),
    signatureRequests: normalizeBoolean(settings.signatureRequests, true),
    weeklyProgressDigest: normalizeBoolean(settings.weeklyProgressDigest, false),
  };
}

function buildProfileScreen(user) {
  return {
    breadcrumb: buildSettingsBreadcrumb("Profile"),
    title: "Setting",
    tabs: buildSettingsTabs("profile"),
    sidebarProfile: buildSettingsSidebarProfile(user),
    section: {
      title: "Profile Information",
      subtitle: "Update your personal details.",
      avatar: {
        imageUrl: user.profileImageUrl || "",
        initials: getInitial(user.name || user.email),
        tone: getAvatarTone(user.name || user.email),
        actions: {
          upload: {
            label: "Change Photo",
            method: "PATCH",
            apiUrl: "/api/settings/profile",
            fieldName: "file",
          },
          delete: {
            label: "Delete",
            method: "DELETE",
            apiUrl: "/api/settings/profile/photo",
            enabled: Boolean(user.profileImageUrl),
          },
        },
      },
      form: {
        submitAction: {
          label: "Save Changes",
          method: "PATCH",
          apiUrl: "/api/settings/profile",
        },
        fields: [
          { id: "name", label: "Your Name", type: "text", value: user.name || "", required: true },
          { id: "email", label: "Your Email", type: "email", value: user.email || "", required: true },
          { id: "phoneNumber", label: "Contact Phone", type: "tel", value: user.phoneNumber || "", required: true },
          { id: "ntiNumber", label: "NTI Number", type: "text", value: user.ntiNumber || "", required: false },
        ],
      },
    },
  };
}

function buildNotificationsScreen(user) {
  const settings = buildNotificationSettings(user);

  return {
    breadcrumb: buildSettingsBreadcrumb("Notification"),
    title: "Setting",
    tabs: buildSettingsTabs("notifications"),
    sidebarProfile: buildSettingsSidebarProfile(user),
    section: {
      title: "Email Notifications",
      subtitle: "Choose which emails you want to receive.",
      submitAction: {
        label: "Save Changes",
        method: "PATCH",
        apiUrl: "/api/settings/notifications",
      },
      toggles: [
        {
          id: "courseUpdates",
          label: "Course Updates",
          description: "Get notified about changes to your enrolled courses",
          value: settings.courseUpdates,
        },
        {
          id: "bookingConfirmations",
          label: "Booking Confirmations",
          description: "Receive confirmation emails when you book a course",
          value: settings.bookingConfirmations,
        },
        {
          id: "checklistReminders",
          label: "Checklist Reminders",
          description: "Get reminders to complete your AM2 checklist sections",
          value: settings.checklistReminders,
        },
        {
          id: "documentRequests",
          label: "Document Requests",
          description: "Get notified when documents are requested or approved",
          value: settings.documentRequests,
        },
        {
          id: "signatureRequests",
          label: "Signature Requests",
          description: "Get notified when signatures are needed or received",
          value: settings.signatureRequests,
        },
        {
          id: "weeklyProgressDigest",
          label: "Weekly Progress Digest",
          description: "Receive a weekly summary of your progress and upcoming deadlines",
          value: settings.weeklyProgressDigest,
        },
      ],
    },
  };
}

function buildSecurityScreen(user) {
  return {
    breadcrumb: buildSettingsBreadcrumb("Security"),
    title: "Setting",
    tabs: buildSettingsTabs("security"),
    sidebarProfile: buildSettingsSidebarProfile(user),
    section: {
      title: "Change Password",
      subtitle: "Update your password to keep your account secure.",
      form: {
        submitAction: {
          label: "Save Changes",
          method: "POST",
          apiUrl: "/api/settings/security/password",
        },
        fields: [
          { id: "currentPassword", label: "Current Password", type: "password", value: "", required: true },
          { id: "newPassword", label: "New Password", type: "password", value: "", required: true },
          { id: "confirmPassword", label: "Confirm New Password", type: "password", value: "", required: true },
        ],
      },
    },
  };
}

function normalizeLegalPageSlug(value) {
  const normalizedValue = normalizeString(value).toLowerCase();
  return LEGAL_PAGE_ALIASES[normalizedValue] || "";
}

function getLegalPageDefaults(slug) {
  const normalizedSlug = normalizeLegalPageSlug(slug);
  return normalizedSlug ? LEGAL_PAGE_DEFAULTS[normalizedSlug] : null;
}

function getFirstPayloadValue(payload, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return payload[key];
    }
  }

  return undefined;
}

function hasAnyPayloadKey(payload, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

function normalizeInteger(value, fallbackValue = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue)) {
      return Math.floor(parsedValue);
    }
  }

  return fallbackValue;
}

function normalizeLegalPageSection(sectionPayload, options = {}) {
  const { partial = false, fallbackTitle = "", fallbackIntroduction = "", fallbackOrder = 0 } = options;
  const payload = sectionPayload && typeof sectionPayload === "object" ? sectionPayload : {};
  const titleKeys = ["title", "heading"];
  const introductionKeys = ["introduction", "content", "body", "description"];
  const section = {};

  if (!partial || hasAnyPayloadKey(payload, titleKeys)) {
    const title = normalizeString(getFirstPayloadValue(payload, titleKeys)) || fallbackTitle;

    if (!title || title.length < 2 || title.length > 160) {
      return { error: "Section title must be between 2 and 160 characters" };
    }

    section.title = title;
  }

  if (!partial || hasAnyPayloadKey(payload, introductionKeys)) {
    const introduction =
      normalizeString(getFirstPayloadValue(payload, introductionKeys)) || fallbackIntroduction;

    if (!introduction || introduction.length < 2 || introduction.length > 5000) {
      return { error: "Section introduction must be between 2 and 5000 characters" };
    }

    section.introduction = introduction;
  }

  if (hasAnyPayloadKey(payload, ["isVisible", "visible"])) {
    section.isVisible = normalizeBoolean(
      getFirstPayloadValue(payload, ["isVisible", "visible"]),
      true
    );
  } else if (!partial) {
    section.isVisible = true;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "order")) {
    const order = normalizeInteger(payload.order, fallbackOrder);
    section.order = Math.max(1, order);
  } else if (!partial) {
    section.order = fallbackOrder;
  }

  return { value: section };
}

function normalizeLegalPageSections(sectionsPayload) {
  if (!Array.isArray(sectionsPayload)) {
    return { error: "Sections must be an array" };
  }

  if (sectionsPayload.length > 20) {
    return { error: "A legal page can contain up to 20 sections" };
  }

  const sections = [];

  for (const [index, sectionPayload] of sectionsPayload.entries()) {
    const sectionResult = normalizeLegalPageSection(sectionPayload, {
      fallbackOrder: index + 1,
    });

    if (sectionResult.error) {
      return { error: `Section ${index + 1}: ${sectionResult.error}` };
    }

    const sectionId = normalizeString(
      sectionPayload?._id || sectionPayload?.id || sectionPayload?.sectionId
    );

    if (sectionId) {
      if (!mongoose.isValidObjectId(sectionId)) {
        return { error: `Section ${index + 1}: Invalid section id` };
      }

      sectionResult.value._id = sectionId;
    }

    sections.push(sectionResult.value);
  }

  return { value: sections };
}

function normalizeFaqItem(itemPayload, options = {}) {
  const { partial = false, fallbackQuestion = "", fallbackAnswer = "", fallbackOrder = 0 } = options;
  const payload = itemPayload && typeof itemPayload === "object" ? itemPayload : {};
  const questionKeys = ["question", "title", "heading"];
  const answerKeys = ["answer", "content", "body", "description"];
  const item = {};

  if (!partial || hasAnyPayloadKey(payload, questionKeys)) {
    const question = normalizeString(getFirstPayloadValue(payload, questionKeys)) || fallbackQuestion;

    if (!question || question.length < 2 || question.length > 300) {
      return { error: "FAQ question must be between 2 and 300 characters" };
    }

    item.question = question;
  }

  if (!partial || hasAnyPayloadKey(payload, answerKeys)) {
    const answer = normalizeString(getFirstPayloadValue(payload, answerKeys)) || fallbackAnswer;

    if (!answer || answer.length < 2 || answer.length > 5000) {
      return { error: "FAQ answer must be between 2 and 5000 characters" };
    }

    item.answer = answer;
  }

  if (hasAnyPayloadKey(payload, ["isVisible", "visible"])) {
    item.isVisible = normalizeBoolean(
      getFirstPayloadValue(payload, ["isVisible", "visible"]),
      true
    );
  } else if (!partial) {
    item.isVisible = true;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "order")) {
    const order = normalizeInteger(payload.order, fallbackOrder);
    item.order = Math.max(1, order);
  } else if (!partial) {
    item.order = fallbackOrder;
  }

  return { value: item };
}

function normalizeFaqItems(itemsPayload) {
  if (!Array.isArray(itemsPayload)) {
    return { error: "FAQ items must be an array" };
  }

  if (itemsPayload.length > 50) {
    return { error: "FAQ can contain up to 50 items" };
  }

  const items = [];

  for (const [index, itemPayload] of itemsPayload.entries()) {
    const itemResult = normalizeFaqItem(itemPayload, {
      fallbackOrder: index + 1,
    });

    if (itemResult.error) {
      return { error: `FAQ ${index + 1}: ${itemResult.error}` };
    }

    const itemId = normalizeString(itemPayload?._id || itemPayload?.id || itemPayload?.faqId);

    if (itemId) {
      if (!mongoose.isValidObjectId(itemId)) {
        return { error: `FAQ ${index + 1}: Invalid FAQ id` };
      }

      itemResult.value._id = itemId;
    }

    items.push(itemResult.value);
  }

  return { value: items };
}

function buildDefaultLegalPageDocument(defaults) {
  return {
    slug: defaults.slug,
    category: defaults.category,
    title: defaults.title,
    subtitle: defaults.subtitle,
    isPublished: true,
    sections: defaults.sections.map((section, index) => ({
      ...section,
      order: index + 1,
      isVisible: true,
    })),
  };
}

function buildDefaultFaqPageDocument() {
  return {
    key: FAQ_PAGE_DEFAULTS.key,
    category: FAQ_PAGE_DEFAULTS.category,
    title: FAQ_PAGE_DEFAULTS.title,
    subtitle: FAQ_PAGE_DEFAULTS.subtitle,
    isPublished: true,
    items: FAQ_PAGE_DEFAULTS.items.map((item, index) => ({
      ...item,
      order: index + 1,
      isVisible: true,
    })),
  };
}

async function findOrCreateLegalPage(rawSlug) {
  const defaults = getLegalPageDefaults(rawSlug);

  if (!defaults) {
    return {
      error: "Legal page must be terms-and-conditions or privacy-policy",
      status: 400,
    };
  }

  let page = await LegalPage.findOne({ slug: defaults.slug });

  if (!page) {
    try {
      page = await LegalPage.create(buildDefaultLegalPageDocument(defaults));
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }

      page = await LegalPage.findOne({ slug: defaults.slug });
    }
  }

  return { value: page };
}

async function findOrCreateFaqPage() {
  let page = await FaqPage.findOne({ key: FAQ_PAGE_DEFAULTS.key });

  if (!page) {
    try {
      page = await FaqPage.create(buildDefaultFaqPageDocument());
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }

      page = await FaqPage.findOne({ key: FAQ_PAGE_DEFAULTS.key });
    }
  }

  return { value: page };
}

function reindexLegalPageSections(page) {
  page.sections.sort((left, right) => {
    const leftOrder = Number.isFinite(left.order) && left.order > 0 ? left.order : 1;
    const rightOrder = Number.isFinite(right.order) && right.order > 0 ? right.order : 1;
    return leftOrder - rightOrder;
  });

  page.sections.forEach((section, index) => {
    section.order = index + 1;
  });
}

function reindexFaqItems(page) {
  page.items.sort((left, right) => {
    const leftOrder = Number.isFinite(left.order) && left.order > 0 ? left.order : 1;
    const rightOrder = Number.isFinite(right.order) && right.order > 0 ? right.order : 1;
    return leftOrder - rightOrder;
  });

  page.items.forEach((item, index) => {
    item.order = index + 1;
  });
}

function getOrderedLegalPageSections(page, options = {}) {
  const { visibleOnly = false } = options;

  return (page.sections || [])
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => (visibleOnly ? section.isVisible !== false : true))
    .sort((left, right) => {
      const leftOrder =
        Number.isFinite(left.section.order) && left.section.order > 0
          ? left.section.order
          : left.index + 1;
      const rightOrder =
        Number.isFinite(right.section.order) && right.section.order > 0
          ? right.section.order
          : right.index + 1;

      return leftOrder - rightOrder;
    })
    .map(({ section }) => section);
}

function getOrderedFaqItems(page, options = {}) {
  const { visibleOnly = false } = options;

  return (page.items || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (visibleOnly ? item.isVisible !== false : true))
    .sort((left, right) => {
      const leftOrder =
        Number.isFinite(left.item.order) && left.item.order > 0
          ? left.item.order
          : left.index + 1;
      const rightOrder =
        Number.isFinite(right.item.order) && right.item.order > 0
          ? right.item.order
          : right.index + 1;

      return leftOrder - rightOrder;
    })
    .map(({ item }) => item);
}

function mapLegalPageSection(section, index, pageSlug, options = {}) {
  const { includeActions = false } = options;
  const sectionNumber = index + 1;
  const sectionId = String(section._id);
  const mappedSection = {
    id: sectionId,
    sectionId,
    label: `SECTION ${sectionNumber}`,
    order: section.order || sectionNumber,
    title: section.title || "",
    introduction: section.introduction || "",
    content: section.introduction || "",
    isVisible: section.isVisible !== false,
  };

  if (includeActions) {
    mappedSection.actions = {
      preview: {
        label: "Preview",
        method: "GET",
        apiUrl: `/api/settings/public/legal-pages/${pageSlug}`,
      },
      edit: {
        label: "Edit",
        method: "PATCH",
        apiUrl: `/api/settings/legal-pages/${pageSlug}/sections/${sectionId}`,
      },
      visibility: {
        label: mappedSection.isVisible ? "Hide" : "Show",
        method: "PATCH",
        apiUrl: `/api/settings/legal-pages/${pageSlug}/sections/${sectionId}/visibility`,
        payload: {
          isVisible: !mappedSection.isVisible,
        },
      },
      delete: {
        label: "Delete",
        method: "DELETE",
        apiUrl: `/api/settings/legal-pages/${pageSlug}/sections/${sectionId}`,
      },
    };
  }

  return mappedSection;
}

function mapFaqItem(item, index, options = {}) {
  const { includeActions = false } = options;
  const faqNumber = index + 1;
  const faqId = String(item._id);
  const mappedItem = {
    id: faqId,
    faqId,
    label: `FAQ ${faqNumber}`,
    order: item.order || faqNumber,
    question: item.question || "",
    answer: item.answer || "",
    isVisible: item.isVisible !== false,
  };

  if (includeActions) {
    mappedItem.actions = {
      preview: {
        label: "Preview",
        method: "GET",
        apiUrl: "/api/settings/public/faqs",
      },
      edit: {
        label: "Edit",
        method: "PATCH",
        apiUrl: `/api/settings/faqs/items/${faqId}`,
      },
      visibility: {
        label: mappedItem.isVisible ? "Hide" : "Show",
        method: "PATCH",
        apiUrl: `/api/settings/faqs/items/${faqId}/visibility`,
        payload: {
          isVisible: !mappedItem.isVisible,
        },
      },
      delete: {
        label: "Delete",
        method: "DELETE",
        apiUrl: `/api/settings/faqs/items/${faqId}`,
      },
    };
  }

  return mappedItem;
}

function mapLegalPage(page, options = {}) {
  const { includeActions = false, visibleOnly = false } = options;
  const sections = getOrderedLegalPageSections(page, { visibleOnly });

  return {
    id: String(page._id),
    slug: page.slug,
    category: page.category || "",
    title: page.title || "",
    subtitle: page.subtitle || "",
    isPublished: page.isPublished !== false,
    updatedAt: page.updatedAt,
    sections: sections.map((section, index) =>
      mapLegalPageSection(section, index, page.slug, { includeActions })
    ),
  };
}

function mapFaqPage(page, options = {}) {
  const { includeActions = false, visibleOnly = false } = options;
  const items = getOrderedFaqItems(page, { visibleOnly });

  return {
    id: String(page._id),
    key: page.key || "faq",
    category: page.category || "",
    title: page.title || "",
    subtitle: page.subtitle || "",
    isPublished: page.isPublished !== false,
    updatedAt: page.updatedAt,
    items: items.map((item, index) => mapFaqItem(item, index, { includeActions })),
    faqs: items.map((item, index) => mapFaqItem(item, index, { includeActions })),
  };
}

function buildLegalPageSettingsScreen(page, user) {
  const defaults = getLegalPageDefaults(page.slug);
  const pageData = mapLegalPage(page, { includeActions: true });

  return {
    breadcrumb: buildLegalSettingsBreadcrumb(page),
    title: "Setting",
    description: defaults?.screenDescription || "Manage public page content.",
    tabs: buildLegalSettingsTabs(page.slug),
    sidebarProfile: buildSettingsSidebarProfile(user),
    saveAction: {
      label: "Save Content",
      method: "PATCH",
      apiUrl: `/api/settings/legal-pages/${page.slug}`,
    },
    section: {
      category: pageData.category,
      title: pageData.title,
      subtitle: pageData.subtitle,
      addSectionAction: {
        label: "Add Section",
        method: "POST",
        apiUrl: `/api/settings/legal-pages/${page.slug}/sections`,
      },
      sections: pageData.sections,
    },
    page: pageData,
  };
}

function buildFaqSettingsScreen(page, user) {
  const pageData = mapFaqPage(page, { includeActions: true });

  return {
    breadcrumb: buildFaqSettingsBreadcrumb(),
    title: "Setting",
    description: FAQ_PAGE_DEFAULTS.screenDescription,
    tabs: buildLegalSettingsTabs("faq"),
    sidebarProfile: buildSettingsSidebarProfile(user),
    saveAction: {
      label: "Save Content",
      method: "PATCH",
      apiUrl: "/api/settings/faqs",
    },
    section: {
      category: pageData.category,
      title: pageData.title,
      subtitle: pageData.subtitle,
      icon: "help-circle",
      addFaqAction: {
        label: "Add FAQ",
        method: "POST",
        apiUrl: "/api/settings/faqs/items",
      },
      faqs: pageData.faqs,
      items: pageData.items,
    },
    page: pageData,
  };
}

async function findSettingsUser(userId, withPassword = false) {
  return withPassword
    ? User.findById(userId).select("+passwordHash +passwordSalt")
    : User.findById(userId);
}

async function getProfileSettingsScreen(req, res, next) {
  try {
    const user = await findSettingsUser(req.user.id);

    return res.status(200).json({
      success: true,
      message: "Profile settings screen fetched successfully",
      data: {
        screen: buildProfileScreen(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateProfileSettings(req, res, next) {
  try {
    const user = await findSettingsUser(req.user.id);
    const name = normalizeString(req.body.name);
    const email = normalizeEmail(req.body.email);
    const phoneNumber = normalizeString(req.body.phoneNumber);
    const ntiNumber = normalizeString(req.body.ntiNumber);

    if (!name || name.length < 2 || name.length > 80) {
      return res.status(400).json({
        success: false,
        message: "Name must be between 2 and 80 characters",
      });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "A valid email is required",
      });
    }

    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be between 7 and 30 valid characters",
      });
    }

    const existingUser = await User.findOne({ email, _id: { $ne: user._id } });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    user.name = name;
    user.email = email;
    user.phoneNumber = phoneNumber;
    user.ntiNumber = ntiNumber;

    if (req.uploadedImageUrl) {
      user.profileImageUrl = req.uploadedImageUrl;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile settings updated successfully",
      data: {
        screen: buildProfileScreen(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteProfilePhoto(req, res, next) {
  try {
    const user = await findSettingsUser(req.user.id);
    user.profileImageUrl = "";
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile photo removed successfully",
      data: {
        screen: buildProfileScreen(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getNotificationSettingsScreen(req, res, next) {
  try {
    const user = await findSettingsUser(req.user.id);

    return res.status(200).json({
      success: true,
      message: "Notification settings screen fetched successfully",
      data: {
        screen: buildNotificationsScreen(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateNotificationSettings(req, res, next) {
  try {
    const user = await findSettingsUser(req.user.id);
    const currentSettings = buildNotificationSettings(user);

    user.notificationSettings = NOTIFICATION_KEYS.reduce((accumulator, key) => {
      accumulator[key] = Object.prototype.hasOwnProperty.call(req.body, key)
        ? normalizeBoolean(req.body[key], currentSettings[key])
        : currentSettings[key];
      return accumulator;
    }, {});

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Notification settings updated successfully",
      data: {
        screen: buildNotificationsScreen(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getSecuritySettingsScreen(req, res, next) {
  try {
    const user = await findSettingsUser(req.user.id);

    return res.status(200).json({
      success: true,
      message: "Security settings screen fetched successfully",
      data: {
        screen: buildSecurityScreen(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updatePasswordSettings(req, res, next) {
  try {
    const user = await findSettingsUser(req.user.id, true);
    const currentPassword = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";
    const confirmPassword = typeof req.body.confirmPassword === "string" ? req.body.confirmPassword : "";

    if (!verifyPassword(currentPassword, user.passwordSalt, user.passwordHash)) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        message: passwordError,
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New password and confirm password must match",
      });
    }

    const { salt, passwordHash } = hashPassword(newPassword);
    user.passwordSalt = salt;
    user.passwordHash = passwordHash;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password updated successfully",
      data: {
        screen: buildSecurityScreen(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listLegalPages(req, res, next) {
  try {
    const pageResults = await Promise.all(
      Object.keys(LEGAL_PAGE_DEFAULTS).map((slug) => findOrCreateLegalPage(slug))
    );
    const pages = pageResults.map((result) => result.value);

    return res.status(200).json({
      success: true,
      message: "Legal pages fetched successfully",
      data: {
        pages: pages.map((page) => mapLegalPage(page)),
        tabs: buildLegalSettingsTabs(""),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getPublicFaqPage(req, res, next) {
  try {
    const pageResult = await findOrCreateFaqPage();
    const page = pageResult.value;

    if (page.isPublished === false) {
      return res.status(404).json({
        success: false,
        message: "FAQ page not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "FAQ page fetched successfully",
      data: {
        page: mapFaqPage(page, { visibleOnly: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getFaqSettingsScreen(req, res, next) {
  try {
    const pageResult = await findOrCreateFaqPage();

    return res.status(200).json({
      success: true,
      message: "FAQ settings screen fetched successfully",
      data: {
        screen: buildFaqSettingsScreen(pageResult.value, req.user),
        page: mapFaqPage(pageResult.value, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateFaqPageContent(req, res, next) {
  try {
    const pageResult = await findOrCreateFaqPage();
    const page = pageResult.value;
    const payload = req.body || {};

    if (Object.prototype.hasOwnProperty.call(payload, "title")) {
      const title = normalizeString(payload.title);

      if (!title || title.length < 2 || title.length > 160) {
        return res.status(400).json({
          success: false,
          message: "FAQ title must be between 2 and 160 characters",
        });
      }

      page.title = title;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "subtitle")) {
      const subtitle = normalizeString(payload.subtitle);

      if (subtitle.length > 500) {
        return res.status(400).json({
          success: false,
          message: "FAQ subtitle must be 500 characters or fewer",
        });
      }

      page.subtitle = subtitle;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "category")) {
      const category = normalizeString(payload.category).toUpperCase();

      if (category.length > 80) {
        return res.status(400).json({
          success: false,
          message: "FAQ category must be 80 characters or fewer",
        });
      }

      page.category = category;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "isPublished")) {
      page.isPublished = normalizeBoolean(payload.isPublished, page.isPublished !== false);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "items") || Object.prototype.hasOwnProperty.call(payload, "faqs")) {
      const itemsResult = normalizeFaqItems(payload.items || payload.faqs);

      if (itemsResult.error) {
        return res.status(400).json({
          success: false,
          message: itemsResult.error,
        });
      }

      page.items = itemsResult.value;
    }

    page.updatedBy = req.user.id;
    reindexFaqItems(page);
    await page.save();

    return res.status(200).json({
      success: true,
      message: "FAQ content updated successfully",
      data: {
        screen: buildFaqSettingsScreen(page, req.user),
        page: mapFaqPage(page, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function addFaqItem(req, res, next) {
  try {
    const pageResult = await findOrCreateFaqPage();
    const page = pageResult.value;

    if (page.items.length >= 50) {
      return res.status(400).json({
        success: false,
        message: "FAQ can contain up to 50 items",
      });
    }

    const itemResult = normalizeFaqItem(req.body || {}, {
      fallbackQuestion: "New FAQ question",
      fallbackAnswer: "Add FAQ answer.",
      fallbackOrder: page.items.length + 1,
    });

    if (itemResult.error) {
      return res.status(400).json({
        success: false,
        message: itemResult.error,
      });
    }

    page.items.push(itemResult.value);
    const createdItemId = String(page.items[page.items.length - 1]._id);
    page.updatedBy = req.user.id;
    reindexFaqItems(page);
    await page.save();

    const orderedItems = getOrderedFaqItems(page);
    const createdItemIndex = orderedItems.findIndex((item) => String(item._id) === createdItemId);
    const createdItem = createdItemIndex >= 0 ? orderedItems[createdItemIndex] : null;

    return res.status(201).json({
      success: true,
      message: "FAQ item created successfully",
      data: {
        item: createdItem ? mapFaqItem(createdItem, createdItemIndex, { includeActions: true }) : null,
        faq: createdItem ? mapFaqItem(createdItem, createdItemIndex, { includeActions: true }) : null,
        screen: buildFaqSettingsScreen(page, req.user),
        page: mapFaqPage(page, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateFaqItem(req, res, next) {
  try {
    const faqId = normalizeString(req.params.faqId);

    if (!mongoose.isValidObjectId(faqId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid FAQ id",
      });
    }

    const pageResult = await findOrCreateFaqPage();
    const page = pageResult.value;
    const item = page.items.id(faqId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "FAQ item not found",
      });
    }

    const itemResult = normalizeFaqItem(req.body || {}, { partial: true });

    if (itemResult.error) {
      return res.status(400).json({
        success: false,
        message: itemResult.error,
      });
    }

    const updates = itemResult.value;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one FAQ field is required",
      });
    }

    Object.assign(item, updates);
    page.updatedBy = req.user.id;
    reindexFaqItems(page);
    await page.save();

    const updatedItems = getOrderedFaqItems(page);
    const updatedItemIndex = updatedItems.findIndex((entry) => String(entry._id) === faqId);

    return res.status(200).json({
      success: true,
      message: "FAQ item updated successfully",
      data: {
        item:
          updatedItemIndex >= 0
            ? mapFaqItem(updatedItems[updatedItemIndex], updatedItemIndex, { includeActions: true })
            : null,
        faq:
          updatedItemIndex >= 0
            ? mapFaqItem(updatedItems[updatedItemIndex], updatedItemIndex, { includeActions: true })
            : null,
        screen: buildFaqSettingsScreen(page, req.user),
        page: mapFaqPage(page, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateFaqItemVisibility(req, res, next) {
  try {
    const faqId = normalizeString(req.params.faqId);

    if (!mongoose.isValidObjectId(faqId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid FAQ id",
      });
    }

    const pageResult = await findOrCreateFaqPage();
    const page = pageResult.value;
    const item = page.items.id(faqId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "FAQ item not found",
      });
    }

    const hasVisibilityPayload = hasAnyPayloadKey(req.body || {}, ["isVisible", "visible"]);
    item.isVisible = hasVisibilityPayload
      ? normalizeBoolean(getFirstPayloadValue(req.body || {}, ["isVisible", "visible"]), item.isVisible !== false)
      : item.isVisible === false;
    page.updatedBy = req.user.id;
    await page.save();

    const updatedItems = getOrderedFaqItems(page);
    const updatedItemIndex = updatedItems.findIndex((entry) => String(entry._id) === faqId);

    return res.status(200).json({
      success: true,
      message: "FAQ item visibility updated successfully",
      data: {
        item:
          updatedItemIndex >= 0
            ? mapFaqItem(updatedItems[updatedItemIndex], updatedItemIndex, { includeActions: true })
            : null,
        faq:
          updatedItemIndex >= 0
            ? mapFaqItem(updatedItems[updatedItemIndex], updatedItemIndex, { includeActions: true })
            : null,
        screen: buildFaqSettingsScreen(page, req.user),
        page: mapFaqPage(page, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteFaqItem(req, res, next) {
  try {
    const faqId = normalizeString(req.params.faqId);

    if (!mongoose.isValidObjectId(faqId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid FAQ id",
      });
    }

    const pageResult = await findOrCreateFaqPage();
    const page = pageResult.value;
    const item = page.items.id(faqId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "FAQ item not found",
      });
    }

    page.items.pull(item._id);
    page.updatedBy = req.user.id;
    reindexFaqItems(page);
    await page.save();

    return res.status(200).json({
      success: true,
      message: "FAQ item deleted successfully",
      data: {
        faqId,
        itemId: faqId,
        screen: buildFaqSettingsScreen(page, req.user),
        page: mapFaqPage(page, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getPublicLegalPage(req, res, next) {
  try {
    const pageResult = await findOrCreateLegalPage(req.params.slug);

    if (pageResult.error) {
      return res.status(pageResult.status || 400).json({
        success: false,
        message: pageResult.error,
      });
    }

    const page = pageResult.value;

    if (page.isPublished === false) {
      return res.status(404).json({
        success: false,
        message: "Legal page not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Legal page fetched successfully",
      data: {
        page: mapLegalPage(page, { visibleOnly: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getLegalPageSettingsScreen(req, res, next) {
  try {
    const pageResult = await findOrCreateLegalPage(req.params.slug);

    if (pageResult.error) {
      return res.status(pageResult.status || 400).json({
        success: false,
        message: pageResult.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Legal page settings screen fetched successfully",
      data: {
        screen: buildLegalPageSettingsScreen(pageResult.value, req.user),
        page: mapLegalPage(pageResult.value, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateLegalPageContent(req, res, next) {
  try {
    const pageResult = await findOrCreateLegalPage(req.params.slug);

    if (pageResult.error) {
      return res.status(pageResult.status || 400).json({
        success: false,
        message: pageResult.error,
      });
    }

    const page = pageResult.value;
    const payload = req.body || {};

    if (Object.prototype.hasOwnProperty.call(payload, "title")) {
      const title = normalizeString(payload.title);

      if (!title || title.length < 2 || title.length > 160) {
        return res.status(400).json({
          success: false,
          message: "Page title must be between 2 and 160 characters",
        });
      }

      page.title = title;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "subtitle")) {
      const subtitle = normalizeString(payload.subtitle);

      if (subtitle.length > 500) {
        return res.status(400).json({
          success: false,
          message: "Page subtitle must be 500 characters or fewer",
        });
      }

      page.subtitle = subtitle;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "category")) {
      const category = normalizeString(payload.category).toUpperCase();

      if (category.length > 80) {
        return res.status(400).json({
          success: false,
          message: "Page category must be 80 characters or fewer",
        });
      }

      page.category = category;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "isPublished")) {
      page.isPublished = normalizeBoolean(payload.isPublished, page.isPublished !== false);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "sections")) {
      const sectionsResult = normalizeLegalPageSections(payload.sections);

      if (sectionsResult.error) {
        return res.status(400).json({
          success: false,
          message: sectionsResult.error,
        });
      }

      page.sections = sectionsResult.value;
    }

    page.updatedBy = req.user.id;
    reindexLegalPageSections(page);
    await page.save();

    return res.status(200).json({
      success: true,
      message: "Legal page content updated successfully",
      data: {
        screen: buildLegalPageSettingsScreen(page, req.user),
        page: mapLegalPage(page, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function addLegalPageSection(req, res, next) {
  try {
    const pageResult = await findOrCreateLegalPage(req.params.slug);

    if (pageResult.error) {
      return res.status(pageResult.status || 400).json({
        success: false,
        message: pageResult.error,
      });
    }

    const page = pageResult.value;

    if (page.sections.length >= 20) {
      return res.status(400).json({
        success: false,
        message: "A legal page can contain up to 20 sections",
      });
    }

    const sectionResult = normalizeLegalPageSection(req.body || {}, {
      fallbackTitle: "New Section",
      fallbackIntroduction: "Add section content.",
      fallbackOrder: page.sections.length + 1,
    });

    if (sectionResult.error) {
      return res.status(400).json({
        success: false,
        message: sectionResult.error,
      });
    }

    page.sections.push(sectionResult.value);
    const createdSectionId = String(page.sections[page.sections.length - 1]._id);
    page.updatedBy = req.user.id;
    reindexLegalPageSections(page);
    await page.save();

    const orderedSections = getOrderedLegalPageSections(page);
    const createdSectionIndex = orderedSections.findIndex(
      (section) => String(section._id) === createdSectionId
    );
    const createdSection = createdSectionIndex >= 0 ? orderedSections[createdSectionIndex] : null;

    return res.status(201).json({
      success: true,
      message: "Legal page section created successfully",
      data: {
        section: createdSection
          ? mapLegalPageSection(createdSection, createdSectionIndex, page.slug, {
              includeActions: true,
            })
          : null,
        screen: buildLegalPageSettingsScreen(page, req.user),
        page: mapLegalPage(page, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateLegalPageSection(req, res, next) {
  try {
    const sectionId = normalizeString(req.params.sectionId);

    if (!mongoose.isValidObjectId(sectionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid section id",
      });
    }

    const pageResult = await findOrCreateLegalPage(req.params.slug);

    if (pageResult.error) {
      return res.status(pageResult.status || 400).json({
        success: false,
        message: pageResult.error,
      });
    }

    const page = pageResult.value;
    const section = page.sections.id(sectionId);

    if (!section) {
      return res.status(404).json({
        success: false,
        message: "Legal page section not found",
      });
    }

    const sectionResult = normalizeLegalPageSection(req.body || {}, { partial: true });

    if (sectionResult.error) {
      return res.status(400).json({
        success: false,
        message: sectionResult.error,
      });
    }

    const updates = sectionResult.value;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one section field is required",
      });
    }

    Object.assign(section, updates);
    page.updatedBy = req.user.id;
    reindexLegalPageSections(page);
    await page.save();

    const updatedSections = getOrderedLegalPageSections(page);
    const updatedSectionIndex = updatedSections.findIndex(
      (item) => String(item._id) === sectionId
    );

    return res.status(200).json({
      success: true,
      message: "Legal page section updated successfully",
      data: {
        section:
          updatedSectionIndex >= 0
            ? mapLegalPageSection(
                updatedSections[updatedSectionIndex],
                updatedSectionIndex,
                page.slug,
                { includeActions: true }
              )
            : null,
        screen: buildLegalPageSettingsScreen(page, req.user),
        page: mapLegalPage(page, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateLegalPageSectionVisibility(req, res, next) {
  try {
    const sectionId = normalizeString(req.params.sectionId);

    if (!mongoose.isValidObjectId(sectionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid section id",
      });
    }

    const pageResult = await findOrCreateLegalPage(req.params.slug);

    if (pageResult.error) {
      return res.status(pageResult.status || 400).json({
        success: false,
        message: pageResult.error,
      });
    }

    const page = pageResult.value;
    const section = page.sections.id(sectionId);

    if (!section) {
      return res.status(404).json({
        success: false,
        message: "Legal page section not found",
      });
    }

    const hasVisibilityPayload = hasAnyPayloadKey(req.body || {}, ["isVisible", "visible"]);
    section.isVisible = hasVisibilityPayload
      ? normalizeBoolean(getFirstPayloadValue(req.body || {}, ["isVisible", "visible"]), section.isVisible !== false)
      : section.isVisible === false;
    page.updatedBy = req.user.id;
    await page.save();

    const updatedSections = getOrderedLegalPageSections(page);
    const updatedSectionIndex = updatedSections.findIndex(
      (item) => String(item._id) === sectionId
    );

    return res.status(200).json({
      success: true,
      message: "Legal page section visibility updated successfully",
      data: {
        section:
          updatedSectionIndex >= 0
            ? mapLegalPageSection(
                updatedSections[updatedSectionIndex],
                updatedSectionIndex,
                page.slug,
                { includeActions: true }
              )
            : null,
        screen: buildLegalPageSettingsScreen(page, req.user),
        page: mapLegalPage(page, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteLegalPageSection(req, res, next) {
  try {
    const sectionId = normalizeString(req.params.sectionId);

    if (!mongoose.isValidObjectId(sectionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid section id",
      });
    }

    const pageResult = await findOrCreateLegalPage(req.params.slug);

    if (pageResult.error) {
      return res.status(pageResult.status || 400).json({
        success: false,
        message: pageResult.error,
      });
    }

    const page = pageResult.value;
    const section = page.sections.id(sectionId);

    if (!section) {
      return res.status(404).json({
        success: false,
        message: "Legal page section not found",
      });
    }

    page.sections.pull(section._id);
    page.updatedBy = req.user.id;
    reindexLegalPageSections(page);
    await page.save();

    return res.status(200).json({
      success: true,
      message: "Legal page section deleted successfully",
      data: {
        sectionId,
        screen: buildLegalPageSettingsScreen(page, req.user),
        page: mapLegalPage(page, { includeActions: true }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getProfileSettingsScreen,
  updateProfileSettings,
  deleteProfilePhoto,
  getNotificationSettingsScreen,
  updateNotificationSettings,
  getSecuritySettingsScreen,
  updatePasswordSettings,
  listLegalPages,
  getPublicFaqPage,
  getFaqSettingsScreen,
  updateFaqPageContent,
  addFaqItem,
  updateFaqItem,
  updateFaqItemVisibility,
  deleteFaqItem,
  getPublicLegalPage,
  getLegalPageSettingsScreen,
  updateLegalPageContent,
  addLegalPageSection,
  updateLegalPageSection,
  updateLegalPageSectionVisibility,
  deleteLegalPageSection,
};

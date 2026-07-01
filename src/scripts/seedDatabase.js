const mongoose = require("mongoose");

const loadEnv = require("../config/loadEnv");
const connectDatabase = require("../config/database");
const User = require("../models/User");
const Course = require("../models/Course");
const Booking = require("../models/Booking");
const { hashPassword } = require("../utils/auth");

loadEnv();

const ADMIN_PASSWORD = "AdminPass123";
const USER_PASSWORD = "UserPass123";

function addDays(baseDate, days, hours = 9, minutes = 0) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + days);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function createPasswordRecord(password) {
  const { salt, passwordHash } = hashPassword(password);
  return {
    passwordSalt: salt,
    passwordHash,
  };
}

function buildCourseSnapshot(course) {
  return {
    title: course.title,
    slug: course.slug,
    schedule: course.schedule || "",
    duration: course.duration || "",
    qualification: course.qualification || "",
    location: course.location || "",
    thumbnailUrl: course.thumbnailUrl || course.galleryImages?.[0] || "",
    price: course.price || 0,
    currency: course.currency || "GBP",
  };
}

function buildPersonalDetails({
  fullName,
  email,
  phoneNumber,
  dateOfBirth,
  address,
  trainingCenter,
  city,
  postcode,
}) {
  return {
    fullName,
    email,
    phoneNumber,
    dateOfBirth: new Date(dateOfBirth),
    address,
    trainingCenter,
    city,
    postcode,
  };
}

async function seedDatabase() {
  const now = new Date();
  await connectDatabase();

  const userIds = {
    admin: new mongoose.Types.ObjectId(),
    michael: new mongoose.Types.ObjectId(),
    rebecca: new mongoose.Types.ObjectId(),
    daniel: new mongoose.Types.ObjectId(),
    sara: new mongoose.Types.ObjectId(),
    olivia: new mongoose.Types.ObjectId(),
    ahmed: new mongoose.Types.ObjectId(),
  };

  const courseIds = {
    am2: new mongoose.Types.ObjectId(),
    nvq: new mongoose.Types.ObjectId(),
    inspection: new mongoose.Types.ObjectId(),
    ev: new mongoose.Types.ObjectId(),
    wiring: new mongoose.Types.ObjectId(),
  };

  const users = [
    {
      _id: userIds.admin,
      name: "Jenny Wilson",
      email: "jenny.wilson@example.com",
      phoneNumber: "+44 20 7946 0958",
      ntiNumber: "44 20 7946 0958",
      profileImageUrl: "",
      role: "admin",
      notificationSettings: {
        courseUpdates: true,
        bookingConfirmations: true,
        checklistReminders: true,
        documentRequests: true,
        signatureRequests: true,
        weeklyProgressDigest: false,
      },
      ...createPasswordRecord(ADMIN_PASSWORD),
      createdAt: addDays(now, -60, 10),
      updatedAt: addDays(now, -2, 11),
    },
    {
      _id: userIds.michael,
      name: "Michael Johnson",
      email: "michael.johnson@example.com",
      phoneNumber: "+44 20 7946 0958",
      ntiNumber: "44 20 7946 0958",
      profileImageUrl: "",
      role: "user",
      notificationSettings: {
        courseUpdates: true,
        bookingConfirmations: true,
        checklistReminders: true,
        documentRequests: true,
        signatureRequests: true,
        weeklyProgressDigest: false,
      },
      ...createPasswordRecord(USER_PASSWORD),
      createdAt: addDays(now, -35, 9),
      updatedAt: addDays(now, -4, 14),
    },
    {
      _id: userIds.rebecca,
      name: "Rebecca Stone",
      email: "rebecca.stone@example.com",
      role: "user",
      ...createPasswordRecord(USER_PASSWORD),
      createdAt: addDays(now, -29, 11),
      updatedAt: addDays(now, -1, 15),
    },
    {
      _id: userIds.daniel,
      name: "Daniel Clarke",
      email: "daniel.clarke@example.com",
      role: "user",
      ...createPasswordRecord(USER_PASSWORD),
      createdAt: addDays(now, -24, 12),
      updatedAt: addDays(now, -3, 10),
    },
    {
      _id: userIds.sara,
      name: "Sara Ali",
      email: "sara.ali@example.com",
      role: "user",
      ...createPasswordRecord(USER_PASSWORD),
      createdAt: addDays(now, -18, 10),
      updatedAt: addDays(now, -5, 13),
    },
    {
      _id: userIds.olivia,
      name: "Olivia Bennett",
      email: "olivia.bennett@example.com",
      role: "user",
      ...createPasswordRecord(USER_PASSWORD),
      createdAt: addDays(now, -12, 9),
      updatedAt: addDays(now, -2, 16),
    },
    {
      _id: userIds.ahmed,
      name: "Ahmed Rahman",
      email: "ahmed.rahman@example.com",
      role: "user",
      ...createPasswordRecord(USER_PASSWORD),
      createdAt: addDays(now, -9, 14),
      updatedAt: addDays(now, -1, 10),
    },
  ];

  const courses = [
    {
      _id: courseIds.am2,
      title: "AM2 Assessment Preparation",
      slug: "am2-assessment-preparation",
      status: "available",
      schedule: "22/04/2026 | 09:00 AM | 5 Days",
      shortDescription: "Hands-on AM2 preparation course covering safe isolation, inspection, testing, and portfolio readiness.",
      overview: "Prepare candidates for AM2 practical assessment with structured guided review.",
      description:
        "A practical review course for candidates preparing for AM2, with guided assessment tasks, documentation checks, and tutor feedback.",
      qualification: "Level 3 Electrical Installation",
      sourceCourse: null,
      sourceCourseName: "",
      location: "London Training Centre",
      sessionDate: addDays(now, 10, 9),
      timeSlot: "09:00 AM - 04:00 PM",
      entryRequirements: "Basic electrical installation experience and prior site exposure.",
      audience: "Electrical trainees preparing for AM2 final assessment.",
      duration: "5 Days",
      price: 885,
      assessmentVariantPricing: {
        am2: 885,
        am2e: 965,
        am2eV1: 1235,
      },
      totalSeats: 16,
      currency: "GBP",
      vatIncluded: true,
      priceNote: "inc VAT",
      thumbnailUrl: "https://placehold.co/600x400?text=AM2",
      galleryImages: ["https://placehold.co/600x400?text=AM2"],
      bookNowUrl: "/courses/am2-assessment-preparation",
      tags: ["am2", "assessment", "electrical"],
      detailSections: [
        {
          title: "Section A: Safe Isolation & Risk Assessment",
          content:
            "Carry out and document an assessment of risk\nCarry out safe isolation in the correct sequence",
        },
        {
          title: "Section B: Safe Isolation & Risk Assessment",
          content:
            "Interpretation of specifications and technical data\nSelection of protective devices\nInstall protective equipotential bonding\nProject timeline update\nTeam skill assessment",
        },
        {
          title: "Section C: Safe Isolation & Risk Assessment",
          content:
            "AM2 assessment preparation\nIoT device programming\nAI and machine learning\nBlockchain development\nCybersecurity fundamentals",
        },
      ],
      isPublished: true,
      order: 1,
      createdAt: addDays(now, -50, 10),
      updatedAt: addDays(now, -2, 12),
    },
    {
      _id: courseIds.nvq,
      title: "NVQ Portfolio Support Workshop",
      slug: "nvq-portfolio-support-workshop",
      status: "available",
      schedule: "29/04/2026 | 10:00 AM | 2 Days",
      shortDescription: "Portfolio support workshop for candidates completing evidence packs and verification requirements.",
      overview: "Help candidates organize evidence, practical writeups, and assessor-ready submissions.",
      description:
        "Focused NVQ support sessions for candidates who need help assembling evidence, mapping performance criteria, and closing portfolio gaps.",
      qualification: "NVQ Level 3",
      sourceCourse: courseIds.am2,
      sourceCourseName: "AM2 Assessment Preparation",
      location: "Essex Training Centre",
      sessionDate: addDays(now, 17, 10),
      timeSlot: "10:00 AM - 03:00 PM",
      entryRequirements: "Existing portfolio evidence or assessor guidance.",
      audience: "Candidates finalizing NVQ evidence packs.",
      duration: "2 Days",
      price: 299,
      totalSeats: 20,
      currency: "GBP",
      vatIncluded: true,
      priceNote: "inc VAT",
      thumbnailUrl: "https://placehold.co/600x400?text=NVQ",
      galleryImages: ["https://placehold.co/600x400?text=NVQ"],
      bookNowUrl: "/courses/nvq-portfolio-support-workshop",
      tags: ["nvq", "portfolio", "evidence"],
      detailSections: [
        {
          title: "Evidence Mapping",
          content:
            "Review existing site evidence\nMatch evidence to performance criteria\nIdentify missing portfolio items",
        },
        {
          title: "Submission Readiness",
          content:
            "Prepare assessor-ready summaries\nCheck signatures and candidate declarations\nConfirm document completeness",
        },
      ],
      isPublished: true,
      order: 2,
      createdAt: addDays(now, -42, 11),
      updatedAt: addDays(now, -3, 14),
    },
    {
      _id: courseIds.inspection,
      title: "Inspection & Testing 2391",
      slug: "inspection-and-testing-2391",
      status: "upcoming",
      schedule: "12/05/2026 | 09:30 AM | 4 Days",
      shortDescription: "Inspection and testing course for candidates preparing for certification and reporting.",
      overview: "Covers initial verification, inspection, testing methods, and certification workflows.",
      description:
        "Structured practical and theory support for inspection and testing candidates, including reports, schedules, and observations.",
      qualification: "City & Guilds 2391",
      sourceCourse: null,
      sourceCourseName: "",
      location: "East London Skills Hub",
      sessionDate: addDays(now, 30, 9, 30),
      timeSlot: "09:30 AM - 04:30 PM",
      entryRequirements: "Electrical installation background preferred.",
      audience: "Qualified electricians and trainees advancing into inspection and testing.",
      duration: "4 Days",
      price: 649,
      totalSeats: 12,
      currency: "GBP",
      vatIncluded: true,
      priceNote: "inc VAT",
      thumbnailUrl: "https://placehold.co/600x400?text=2391",
      galleryImages: ["https://placehold.co/600x400?text=2391"],
      bookNowUrl: "/courses/inspection-and-testing-2391",
      tags: ["2391", "testing", "inspection"],
      detailSections: [
        {
          title: "Inspection Tasks",
          content:
            "Visual inspection workflow\nSchedule of inspections\nRecording observations and deviations",
        },
        {
          title: "Testing Tasks",
          content:
            "Continuity testing\nInsulation resistance testing\nEarth fault loop impedance testing\nRCD verification",
        },
      ],
      isPublished: true,
      order: 3,
      createdAt: addDays(now, -38, 9),
      updatedAt: addDays(now, -5, 11),
    },
    {
      _id: courseIds.ev,
      title: "EV Charger Installation",
      slug: "ev-charger-installation",
      status: "available",
      schedule: "06/04/2026 | 08:30 AM | 3 Days",
      shortDescription: "Practical EV charger installation course covering design, inspection, and commissioning.",
      overview: "Installation planning and practical charger setup for domestic and commercial environments.",
      description:
        "Covers charger selection, protective devices, inspection, testing, and handover requirements for EV installations.",
      qualification: "EV Installation Awareness",
      sourceCourse: null,
      sourceCourseName: "",
      location: "South London Workshop",
      sessionDate: addDays(now, -6, 8, 30),
      timeSlot: "08:30 AM - 03:30 PM",
      entryRequirements: "Basic electrical installation competence.",
      audience: "Electricians expanding into EV charge point installation.",
      duration: "3 Days",
      price: 549,
      totalSeats: 14,
      currency: "GBP",
      vatIncluded: true,
      priceNote: "inc VAT",
      thumbnailUrl: "https://placehold.co/600x400?text=EV",
      galleryImages: ["https://placehold.co/600x400?text=EV"],
      bookNowUrl: "/courses/ev-charger-installation",
      tags: ["ev", "charger", "installation"],
      detailSections: [
        {
          title: "EV Installation Planning",
          content:
            "Site survey and load assessment\nProtective device selection\nCable route planning",
        },
        {
          title: "Commissioning & Handover",
          content:
            "Installation testing\nClient handover documentation\nFinal commissioning checks",
        },
      ],
      isPublished: true,
      order: 4,
      createdAt: addDays(now, -33, 12),
      updatedAt: addDays(now, -6, 9),
    },
    {
      _id: courseIds.wiring,
      title: "18th Edition Wiring Regulations Update",
      slug: "18th-edition-wiring-regulations-update",
      status: "archived",
      schedule: "18/03/2026 | 10:00 AM | 2 Days",
      shortDescription: "Update course covering key changes and practical interpretation of the 18th Edition regulations.",
      overview: "Regulation changes, compliance impacts, and exam preparation support.",
      description:
        "A concise update course focused on regulation changes, terminology, and application in electrical installation work.",
      qualification: "18th Edition Update",
      sourceCourse: null,
      sourceCourseName: "",
      location: "Online Classroom",
      sessionDate: addDays(now, -25, 10),
      timeSlot: "10:00 AM - 02:00 PM",
      entryRequirements: "Existing familiarity with BS 7671.",
      audience: "Electricians refreshing compliance knowledge.",
      duration: "2 Days",
      price: 199,
      totalSeats: 40,
      currency: "GBP",
      vatIncluded: true,
      priceNote: "inc VAT",
      thumbnailUrl: "https://placehold.co/600x400?text=18th",
      galleryImages: ["https://placehold.co/600x400?text=18th"],
      bookNowUrl: "/courses/18th-edition-wiring-regulations-update",
      tags: ["18th", "regulations", "bs7671"],
      detailSections: [
        {
          title: "Regulation Changes",
          content:
            "Review latest regulation changes\nInterpret scope and terminology updates\nApply compliance scenarios",
        },
      ],
      isPublished: true,
      order: 5,
      createdAt: addDays(now, -55, 8),
      updatedAt: addDays(now, -20, 10),
    },
  ];

  const courseMap = Object.fromEntries(courses.map((course) => [String(course._id), course]));

  const bookings = [
    {
      _id: new mongoose.Types.ObjectId(),
      bookingNumber: "BK-20260412-MJ001",
      user: userIds.michael,
      course: courseIds.am2,
      courseSnapshot: buildCourseSnapshot(courseMap[String(courseIds.am2)]),
      personalDetails: buildPersonalDetails({
        fullName: "Michael Johnson",
        email: "michael.johnson@example.com",
        phoneNumber: "07700 900456",
        dateOfBirth: "1997-09-14",
        address: "12 Westbury Street",
        trainingCenter: "PZ456789A",
        city: "London",
        postcode: "E16 2AB",
      }),
      status: "pending_payment",
      payment: {
        status: "pending",
        amount: 885,
        currency: "GBP",
        agreedToTerms: false,
        method: "card",
        transactionId: "",
        cardBrand: "",
        cardLast4: "",
        paidAt: null,
        failureReason: "",
      },
      session: {
        startDateTime: addDays(now, 10, 9),
        endDateTime: addDays(now, 10, 16),
        location: "London Training Centre",
      },
      notes: "Awaiting candidate signature and supporting uploads.",
      createdAt: addDays(now, -5, 14),
      updatedAt: addDays(now, -1, 10),
      confirmedAt: null,
      cancelledAt: null,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      bookingNumber: "BK-20260412-RS002",
      user: userIds.rebecca,
      course: courseIds.inspection,
      courseSnapshot: buildCourseSnapshot(courseMap[String(courseIds.inspection)]),
      personalDetails: buildPersonalDetails({
        fullName: "Rebecca Stone",
        email: "rebecca.stone@example.com",
        phoneNumber: "07700 900321",
        dateOfBirth: "1994-02-02",
        address: "48 King Edward Road",
        trainingCenter: "North Essex Centre",
        city: "Chelmsford",
        postcode: "CM1 1AA",
      }),
      status: "confirmed",
      payment: {
        status: "paid",
        amount: 649,
        currency: "GBP",
        agreedToTerms: true,
        method: "card",
        transactionId: "txn_rs002_paid",
        cardBrand: "Visa",
        cardLast4: "4242",
        paidAt: addDays(now, -7, 16),
        failureReason: "",
      },
      session: {
        startDateTime: addDays(now, 30, 9, 30),
        endDateTime: addDays(now, 30, 16, 30),
        location: "East London Skills Hub",
      },
      notes: "Approved by training provider and ready for attendance.",
      createdAt: addDays(now, -8, 11),
      updatedAt: addDays(now, -3, 12),
      confirmedAt: addDays(now, -7, 16),
      cancelledAt: null,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      bookingNumber: "BK-20260412-DC003",
      user: userIds.daniel,
      course: courseIds.ev,
      courseSnapshot: buildCourseSnapshot(courseMap[String(courseIds.ev)]),
      personalDetails: buildPersonalDetails({
        fullName: "Daniel Clarke",
        email: "daniel.clarke@example.com",
        phoneNumber: "07700 900654",
        dateOfBirth: "1991-06-08",
        address: "6 Oakfield Avenue",
        trainingCenter: "South London Workshop",
        city: "Croydon",
        postcode: "CR0 6PL",
      }),
      status: "confirmed",
      payment: {
        status: "paid",
        amount: 549,
        currency: "GBP",
        agreedToTerms: true,
        method: "manual",
        transactionId: "txn_dc003_paid",
        cardBrand: "Card",
        cardLast4: "1003",
        paidAt: addDays(now, -10, 13),
        failureReason: "",
      },
      session: {
        startDateTime: addDays(now, -6, 8, 30),
        endDateTime: addDays(now, -6, 15, 30),
        location: "South London Workshop",
      },
      notes: "Completed successfully. Follow-up certificate email scheduled.",
      createdAt: addDays(now, -14, 10),
      updatedAt: addDays(now, -4, 11),
      confirmedAt: addDays(now, -10, 13),
      cancelledAt: null,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      bookingNumber: "BK-20260412-SA004",
      user: userIds.sara,
      course: courseIds.wiring,
      courseSnapshot: buildCourseSnapshot(courseMap[String(courseIds.wiring)]),
      personalDetails: buildPersonalDetails({
        fullName: "Sara Ali",
        email: "sara.ali@example.com",
        phoneNumber: "07700 900777",
        dateOfBirth: "1995-11-19",
        address: "21 Hilltop Gardens",
        trainingCenter: "Online Classroom",
        city: "Ilford",
        postcode: "IG1 4XY",
      }),
      status: "cancelled",
      payment: {
        status: "refunded",
        amount: 199,
        currency: "GBP",
        agreedToTerms: true,
        method: "card",
        transactionId: "txn_sa004_refunded",
        cardBrand: "Mastercard",
        cardLast4: "4444",
        paidAt: addDays(now, -22, 15),
        failureReason: "",
      },
      session: {
        startDateTime: addDays(now, -25, 10),
        endDateTime: addDays(now, -25, 14),
        location: "Online Classroom",
      },
      notes: "Cancelled after candidate requested rescheduling. Payment refunded.",
      createdAt: addDays(now, -26, 9),
      updatedAt: addDays(now, -18, 12),
      confirmedAt: addDays(now, -22, 15),
      cancelledAt: addDays(now, -18, 12),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      bookingNumber: "BK-20260412-OB005",
      user: userIds.olivia,
      course: courseIds.nvq,
      courseSnapshot: buildCourseSnapshot(courseMap[String(courseIds.nvq)]),
      personalDetails: buildPersonalDetails({
        fullName: "Olivia Bennett",
        email: "olivia.bennett@example.com",
        phoneNumber: "07700 900888",
        dateOfBirth: "1998-04-21",
        address: "82 Station Road",
        trainingCenter: "Essex Training Centre",
        city: "Romford",
        postcode: "RM1 2LU",
      }),
      status: "pending_payment",
      payment: {
        status: "failed",
        amount: 299,
        currency: "GBP",
        agreedToTerms: true,
        method: "card",
        transactionId: "",
        cardBrand: "Visa",
        cardLast4: "1111",
        paidAt: null,
        failureReason: "Card authorization failed during payment capture.",
      },
      session: {
        startDateTime: addDays(now, 17, 10),
        endDateTime: addDays(now, 17, 15),
        location: "Essex Training Centre",
      },
      notes: "Candidate needs to retry payment before provider review can continue.",
      createdAt: addDays(now, -6, 13),
      updatedAt: addDays(now, -2, 9),
      confirmedAt: null,
      cancelledAt: null,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      bookingNumber: "BK-20260412-AR006",
      user: userIds.ahmed,
      course: courseIds.am2,
      courseSnapshot: buildCourseSnapshot(courseMap[String(courseIds.am2)]),
      personalDetails: buildPersonalDetails({
        fullName: "Ahmed Rahman",
        email: "ahmed.rahman@example.com",
        phoneNumber: "07700 900999",
        dateOfBirth: "1993-01-30",
        address: "14 Queensway",
        trainingCenter: "London Training Centre",
        city: "Barking",
        postcode: "IG11 8AA",
      }),
      status: "confirmed",
      payment: {
        status: "paid",
        amount: 885,
        currency: "GBP",
        agreedToTerms: true,
        method: "card",
        transactionId: "txn_ar006_paid",
        cardBrand: "Visa",
        cardLast4: "6060",
        paidAt: addDays(now, -4, 17),
        failureReason: "",
      },
      session: {
        startDateTime: addDays(now, 12, 9),
        endDateTime: addDays(now, 12, 16),
        location: "London Training Centre",
      },
      notes: "Candidate fully approved and included in next AM2 session.",
      createdAt: addDays(now, -4, 11),
      updatedAt: addDays(now, -1, 15),
      confirmedAt: addDays(now, -4, 17),
      cancelledAt: null,
    },
  ];

  await Booking.deleteMany({});
  await Course.deleteMany({});
  await User.deleteMany({});

  await User.insertMany(users);
  await Course.insertMany(courses);
  await Booking.insertMany(bookings);

  const summary = {
    users: users.length,
    courses: courses.length,
    bookings: bookings.length,
    database: process.env.MONGODB_DB || "default",
  };

  console.log("Database seeded successfully.");
  console.table(summary);
  console.log("Admin login:", "jenny.wilson@example.com", "/", ADMIN_PASSWORD);
  console.log("User login:", "michael.johnson@example.com", "/", USER_PASSWORD);
}

async function run() {
  try {
    await seedDatabase();
  } catch (error) {
    console.error("Failed to seed database.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

run();

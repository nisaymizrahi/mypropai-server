require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const passport = require("passport");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");

// --- Register all database models on startup ---
require('./models/User'); 
require('./models/Investment');
require('./models/ManagedProperty');
require('./models/Unit');
require('./models/Tenant');
require('./models/Lease');
require('./models/OperatingExpense');
require('./models/TenantUser');
require('./models/BudgetItem');
require('./models/Expense');
require('./models/Vendor');
require('./models/ProjectTask');
require('./models/ProjectDocument');
require('./models/MaintenanceTicket');
require('./models/Inspection');
require('./models/Lead');
require('./models/Bid');
require('./models/Application');
require('./models/Purchase');
// --- End of Model Registration ---

// --- Route Imports ---
const investmentRoutes = require("./routes/investments");
const authRoutes = require("./routes/auth");
const compsRoutes = require("./routes/comps");
const uploadRoutes = require("./routes/uploads");
const managementRoutes = require("./routes/management");
const tenantAuthRoutes = require("./routes/tenantAuthRoutes");
const tenantRoutes = require("./routes/tenantRoutes"); 
const budgetItemRoutes = require("./routes/budgetItemRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const projectTaskRoutes = require("./routes/projectTaskRoutes");
const documentRoutes = require("./routes/documentRoutes");
const unitDocumentRoutes = require("./routes/unitDocumentRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const operatingExpenseRoutes = require("./routes/operatingExpenseRoutes");
const inspectionRoutes = require("./routes/inspectionRoutes");
const aiToolsRoutes = require("./routes/aiToolsRoutes");
const leadRoutes = require("./routes/leadRoutes");
const stripeRoutes = require("./routes/stripeRoutes");
const bidRoutes = require("./routes/bidRoutes");
const notificationRoutes = require("./routes/notifications");
const billingRoutes = require("./routes/billingRoutes");
const propertyRoutes = require("./routes/properties");
// 1. IMPORT THE NEW APPLICATION ROUTES
const applicationRoutes = require("./routes/applicationRoutes");
const billingController = require("./controllers/billingController");
const stripeController = require("./controllers/stripeController");
const requireAuth = require("./middleware/requireAuth");

require("./config/passport");

const app = express();
connectDB();
app.set("trust proxy", 1);
app.disable("x-powered-by");

// CORS Configuration
const normalizeOrigin = (value) => value?.trim().replace(/\/+$/, "");

const allowedOrigins = new Set(["https://mypropai.onrender.com"]);

[process.env.FRONTEND_URL, process.env.FRONTEND_URLS]
  .filter(Boolean)
  .flatMap((value) => value.split(","))
  .map(normalizeOrigin)
  .filter(Boolean)
  .forEach((origin) => allowedOrigins.add(origin));

if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.add('http://localhost:3000');
}

app.use(
  cors({
    origin: function (origin, callback) {
      const normalizedOrigin = normalizeOrigin(origin);
      if (!origin || allowedOrigins.has(normalizedOrigin)) {
        callback(null, true);
      } else {
        callback(new Error('The CORS policy for this site does not allow access from the specified Origin.'));
      }
    },
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  next();
});

app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  billingController.handleStripeWebhook
);

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeController.handleWebhook
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// --- API Routes ---
app.use("/api/auth", authRoutes);
app.use("/api/investments", requireAuth, investmentRoutes);
app.use("/api/comps", requireAuth, compsRoutes);
app.use("/api/uploads", requireAuth, uploadRoutes);
app.use("/api/management", requireAuth, managementRoutes);
app.use("/api/tenant-auth", tenantAuthRoutes);
app.use("/api/tenant", tenantRoutes);
app.use("/api/budget-items", requireAuth, budgetItemRoutes);
app.use("/api/expenses", requireAuth, expenseRoutes);
app.use("/api/vendors", requireAuth, vendorRoutes);
app.use("/api/project-tasks", requireAuth, projectTaskRoutes);
app.use("/api/documents", requireAuth, documentRoutes);
app.use("/api/managed-documents", unitDocumentRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/maintenance", requireAuth, maintenanceRoutes);
app.use("/api/operating-expenses", requireAuth, operatingExpenseRoutes);
app.use("/api/inspections", requireAuth, inspectionRoutes);
app.use("/api/ai-tools", requireAuth, aiToolsRoutes);
app.use("/api/leads", requireAuth, leadRoutes);
app.use("/api/stripe", requireAuth, stripeRoutes);
app.use("/api/billing", requireAuth, billingRoutes);
app.use("/api/bids", requireAuth, bidRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/properties", requireAuth, propertyRoutes);
// 2. USE THE NEW APPLICATION ROUTES
app.use("/api/applications", applicationRoutes); // Note: Auth is handled inside the routes file

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ msg: "Uploaded file is too large." });
    }

    return res.status(400).json({ msg: err.message });
  }

  if (err && err.message === "Unsupported file type.") {
    return res.status(400).json({ msg: err.message });
  }

  return next(err);
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

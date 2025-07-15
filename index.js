require("dotenv").config();
const express = require("express");
const cors = require("cors");
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
const dashboardRoutes = require("./routes/dashboardRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const operatingExpenseRoutes = require("./routes/operatingExpenseRoutes");
const inspectionRoutes = require("./routes/inspectionRoutes");
const aiToolsRoutes = require("./routes/aiToolsRoutes");
const leadRoutes = require("./routes/leadRoutes");
// 1. IMPORT THE NEW STRIPE ROUTES
const stripeRoutes = require("./routes/stripeRoutes");
const requireAuth = require("./middleware/requireAuth");

require("./config/passport");

const app = express();
connectDB();

// CORS Configuration
const allowedOrigins = ["https://mypropai.onrender.com"];
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:3000');
}

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
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

app.use(express.json());
app.use(cookieParser());

app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
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
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/maintenance", requireAuth, maintenanceRoutes);
app.use("/api/operating-expenses", requireAuth, operatingExpenseRoutes);
app.use("/api/inspections", requireAuth, inspectionRoutes);
app.use("/api/ai-tools", requireAuth, aiToolsRoutes);
app.use("/api/leads", requireAuth, leadRoutes);
// 2. USE THE NEW STRIPE ROUTES
app.use("/api/stripe", requireAuth, stripeRoutes);


// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

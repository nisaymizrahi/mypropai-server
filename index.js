require("dotenv").config();
const express = require("express");
const cors = require("cors");
const passport = require("passport");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");

// --- NEW: Register all database models on startup ---
// By requiring them here, we ensure Mongoose is aware of every schema.
require('./models/User'); // Assuming you have a User model
require('./models/Investment');
require('./models/ManagedProperty');
require('./models/Unit');
require('./models/Tenant');
require('./models/Lease');
require('./models/OperatingExpense');
// --- End of Model Registration ---

const investmentRoutes = require("./routes/investments");
const authRoutes = require("./routes/auth");
const compsRoutes = require("./routes/comps");
const uploadRoutes = require("./routes/uploads");
const managementRoutes = require("./routes/management");
const requireAuth = require("./middleware/requireAuth");

require("./config/passport");

const app = express();
connectDB();

// CORS Configuration for Development and Production
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

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/investments", requireAuth, investmentRoutes);
app.use("/api/comps", requireAuth, compsRoutes);
app.use("/api/uploads", requireAuth, uploadRoutes);
app.use("/api/management", requireAuth, managementRoutes);

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

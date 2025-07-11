require("dotenv").config();
const express = require("express");
const cors = require("cors");
const passport = require("passport");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");

const investmentRoutes = require("./routes/investments");
const authRoutes = require("./routes/auth");
const compsRoutes = require("./routes/comps");
const uploadRoutes = require("./routes/uploads");
// NEW: Import the management routes
const managementRoutes = require("./routes/management"); 
const requireAuth = require("./middleware/requireAuth");

require("./config/passport");

const app = express();
connectDB();

app.use(
  cors({
    origin: "https://mypropai.onrender.com",
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
// NEW: Use the management routes and protect them
app.use("/api/management", requireAuth, managementRoutes);

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

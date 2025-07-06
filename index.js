require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const passport = require("passport");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");

const investmentRoutes = require("./routes/investments");
const authRoutes = require("./routes/auth");
const requireAuth = require("./middleware/requireAuth");

require("./config/passport");

const app = express();
connectDB();

// ✅ FIXED: Allow Authorization headers for token-based auth
app.use(
  cors({
    origin: "https://mypropai.onrender.com",
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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

// ✅ Routes
app.use("/api/auth", authRoutes);
app.use("/api/investments", requireAuth, investmentRoutes);

// ... other routes like /api/comps if needed ...

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const passport = require("passport");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");

const investmentRoutes = require("./routes/investments");
const authRoutes = require("./routes/auth"); // ✅ Add this line
const requireAuth = require("./middleware/requireAuth");

require("./config/passport");

const app = express();
connectDB();

app.use(
  cors({
    origin: "https://mypropai.onrender.com",
    credentials: true,
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

// ✅ Use centralized auth routes (don't duplicate Google login in here)
app.use("/api/auth", authRoutes);

// ✅ Protected Investment Routes
app.use("/api/investments", requireAuth, investmentRoutes);

// ... your /api/comps route remains unchanged ...

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

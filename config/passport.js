require("dotenv").config();
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");
const { normalizeEmail } = require("../utils/platformAccess");
const {
  applyProfileFields,
  buildDisplayName,
  isProfileCompletionRequired,
} = require("../utils/userProfile");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = normalizeEmail(profile?.emails?.[0]?.value || "");
        const avatar = profile?.photos?.[0]?.value || null;

        if (!email) {
          return done(new Error("Google sign-in did not return an email address."), null);
        }

        let user = await User.findOne({
          $or: [{ googleId: profile.id }, { email }],
        });

        if (!user) {
          user = new User({
            googleId: profile.id,
            email,
            avatar,
            profileCompletionRequired: true,
          });
        } else {
          user.googleId = user.googleId || profile.id;
          user.avatar = user.avatar || avatar;
          if (user.password && !user.hasPassword) {
            user.hasPassword = true;
          }
        }

        applyProfileFields(user, {
          firstName: profile?.name?.givenName || user.firstName,
          lastName: profile?.name?.familyName || user.lastName,
          name: profile?.displayName || user.name,
        });
        user.name = buildDisplayName(user);
        user.profileCompletionRequired = isProfileCompletionRequired(user);

        if (!user.profileCompletionRequired && !user.profileCompletedAt) {
          user.profileCompletedAt = new Date();
        }

        await user.save();

        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

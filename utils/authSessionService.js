const AuthSession = require("../models/AuthSession");
const { signJwt } = require("./jwtConfig");
const {
  AUTH_ABSOLUTE_TIMEOUT_MS,
  AUTH_ACTIVITY_TOUCH_INTERVAL_MS,
  AUTH_TOKEN_TTL,
} = require("./authSessionPolicy");

const buildRequestMetadata = (req) => ({
  userAgent: req?.get("user-agent") || null,
  ipAddress:
    req?.ip ||
    req?.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req?.socket?.remoteAddress ||
    null,
});

const createAuthSessionToken = async ({
  user,
  req,
  authMethod = "password",
  sessionType = "user",
  actorUser = null,
  expiresIn = AUTH_TOKEN_TTL,
  absoluteTimeoutMs = AUTH_ABSOLUTE_TIMEOUT_MS,
  extraPayload = {},
}) => {
  const now = new Date();
  const session = await AuthSession.create({
    user: user._id,
    actorUser: actorUser?._id || null,
    sessionType,
    authMethod,
    lastActivityAt: now,
    expiresAt: new Date(now.getTime() + absoluteTimeoutMs),
    ...buildRequestMetadata(req),
  });

  const token = signJwt(
    {
      userId: String(user._id),
      sessionId: String(session._id),
      ...extraPayload,
    },
    { expiresIn }
  );

  return { token, session };
};

const revokeAuthSession = async (sessionId, revokedAt = new Date()) => {
  if (!sessionId) {
    return null;
  }

  return AuthSession.findByIdAndUpdate(
    sessionId,
    { revokedAt },
    { new: true }
  );
};

const maybeTouchAuthSession = async (session, now = new Date()) => {
  if (!session) {
    return null;
  }

  const lastActivityTime = new Date(session.lastActivityAt).getTime();
  if (now.getTime() - lastActivityTime < AUTH_ACTIVITY_TOUCH_INTERVAL_MS) {
    return session;
  }

  session.lastActivityAt = now;
  await session.save();
  return session;
};

module.exports = {
  createAuthSessionToken,
  revokeAuthSession,
  maybeTouchAuthSession,
};

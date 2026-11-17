import {
  Strategy as GoogleStrategy,
  Profile,
  VerifyCallback,
} from 'passport-google-oauth20';
import passport from 'passport';
import { env } from './env';
import { User } from '../modules/users/user.model';
import { logger } from '../utils/logger';

/**
 * Google OAuth strategy (PRD §6 / blueprint — Passport.js strategies).
 * Registered ONLY when both env vars exist — Google login is disabled
 * otherwise and the routes answer 404 (blueprint: OAuth only when env
 * vars exist).
 *
 * Account linking: a Google account is matched first by `googleId`, then
 * by email (Google emails are verified accounts). An existing email/
 * password user who consents to the same email gets `googleId` attached —
 * one account, both login methods.
 */

export function isGoogleOAuthEnabled(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

let initialized = false;

export function initPassport(): void {
  if (initialized || !isGoogleOAuthEnabled()) return;
  initialized = true;

  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        callbackURL: env.GOOGLE_CALLBACK_URL,
        // Endpoint overrides (proxy / self-hosted OIDC / test doubles)
        ...(env.GOOGLE_TOKEN_URL ? { tokenURL: env.GOOGLE_TOKEN_URL } : {}),
        ...(env.GOOGLE_USERINFO_URL
          ? { userProfileURL: env.GOOGLE_USERINFO_URL }
          : {}),
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: VerifyCallback
      ): Promise<void> => {
        try {
          // Google's OIDC profile: only verified emails are exposed by default
          const email = profile.emails?.[0]?.value?.toLowerCase();
          const googleId = profile.id;
          if (!email) {
            done(null, false);
            return;
          }

          let user = await User.findOne({ googleId });
          if (!user) {
            user = await User.findOne({ email });
            if (user) {
              // Link the Google identity to the existing account
              user.googleId = googleId;
              await user.save();
            } else {
              user = await User.create({
                name: profile.displayName || email.split('@')[0],
                email,
                googleId,
                // OAuth-only account — passwordHash stays unset
              });
            }
          }
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
  logger.info('Google OAuth strategy registered');
}

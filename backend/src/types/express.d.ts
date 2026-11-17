/**
 * Express request augmentation (blueprint — requireAuth contract).
 * requireAuth attaches the authenticated user's identity to req.user;
 * every controller reads `req.user.id` from here.
 */
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      sid?: string; // refresh-session id from the access token
    }
  }
}

export {};

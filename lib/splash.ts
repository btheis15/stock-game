// Shared between the server layout's inline skip script and the client
// Splash component (a constant exported from a "use client" module would
// arrive in a server component as a client reference, not a string).
export const SPLASH_SEEN_KEY = "stockgame.splash.seen";

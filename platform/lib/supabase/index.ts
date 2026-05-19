// createClient is exported from both client.ts and server.ts; alias both clearly
export { createClient as createBrowserClient } from './client';
export { createClient as createServerClient } from './server';
export { updateSession } from './middleware';

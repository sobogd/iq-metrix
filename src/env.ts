// Fail-fast env loading. A missing required var throws at boot rather than
// producing a confusing runtime error the first time the code path is hit.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8205),
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Read directly by Prisma (DATABASE_URL) — required here too, so a missing
  // one fails at boot instead of on the first query.
  databaseUrl: required("DATABASE_URL"),
  ingestSharedSecret: required("INGEST_SHARED_SECRET"),
  adminUser: required("ADMIN_USER"),
  adminPasswordHash: required("ADMIN_PASSWORD_HASH"),
  sessionSecret: required("SESSION_SECRET"),
};

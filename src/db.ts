import { PrismaClient } from "@prisma/client";

// Single shared client for the whole process (pm2 runs this as one fork —
// see ecosystem.config.js). Prisma pools its own connections internally, so
// one PrismaClient instance is the right amount here.
export const prisma = new PrismaClient();

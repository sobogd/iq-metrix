import { PrismaClient } from "@prisma/client";

// Idempotent — upsert, not create. Safe to rerun any time, including
// against prod later: it only ever sets these two rows to this exact
// state, never touches Visit/Event/AnalyticsSalt.
//
// Run via `npx prisma db seed` (wired in package.json's "prisma.seed") or
// directly with `npx tsx prisma/seed.ts`.

const prisma = new PrismaClient();

const sites = [
  {
    id: "iq-rest",
    domain: "dashboard.iq-rest.com",
    metaKeys: {
      restaurantId: {
        label: "Restaurant",
        link: "https://dashboard.iq-rest.com/dashboard/settings/admin/restaurants/{v}",
      },
    },
  },
  {
    id: "iq-translate",
    domain: "translate.iq-factura.com",
    metaKeys: {
      topicId: { label: "Topic" },
    },
  },
  {
    id: "iq-mermaid",
    domain: "iq-mermaid.com",
    metaKeys: {},
  },
] as const;

async function main(): Promise<void> {
  for (const site of sites) {
    const row = await prisma.site.upsert({
      where: { id: site.id },
      create: site,
      update: { domain: site.domain, metaKeys: site.metaKeys },
    });
    console.log(`seeded site: ${row.id} (${row.domain})`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

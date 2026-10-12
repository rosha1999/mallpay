import { readdir } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { productionConfigIssues } from "@/lib/production-readiness";

async function main() {
  const issues = productionConfigIssues();
  if (issues.length) {
    console.error("Production preflight blocked. Missing or invalid settings:");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const directories = await readdir("prisma/migrations", {
      withFileTypes: true,
    });
    const migrationNames = directories
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const applied = await prisma.$queryRaw<
      { migration_name: string }[]
    >`SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
    const appliedNames = new Set(applied.map((row) => row.migration_name));
    const pending = migrationNames.filter((name) => !appliedNames.has(name));
    if (pending.length) {
      console.error("Production preflight blocked. Pending migrations:");
      for (const name of pending) console.error(`- ${name}`);
      process.exitCode = 1;
      return;
    }
    console.log("Production configuration, PostgreSQL, and migrations are ready.");
  } catch {
    console.error(
      "Production preflight blocked. PostgreSQL is unreachable or migrations are not applied.",
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();

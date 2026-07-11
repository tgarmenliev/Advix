// prisma.config.ts
// Prisma 7+ — connection се конфигурира тук, не в schema.prisma
// Документация: https://pris.ly/d/config-datasource

import path from "node:path";
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// DATABASE_URL формат:
// postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),

  migrations: {
    path: path.join("prisma", "migrations"),
  },

  datasource: {
    url: env("DATABASE_URL"),
  },
});

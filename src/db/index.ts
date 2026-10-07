import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let client: Db | null = null;

// Connects on first use, not at import. `next build` imports every route to
// collect page data, and in CI DATABASE_URL only exists at runtime (a Worker
// secret), so connecting at import fails the build.
export const db = new Proxy({} as Db, {
  get(_, prop) {
    client ??= drizzle(neon(process.env.DATABASE_URL!), { schema });
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No ISR in Marginalia, so no incremental cache binding is needed.
const config = defineCloudflareConfig();

// `pnpm build` is the OpenNext build, so Workers Builds' default build step
// produces the .open-next/ output its deploy step needs (a plain `next build`
// fails with "Could not find compiled Open Next config"). OpenNext runs
// `pnpm build` internally by default, which would now call itself, so the
// inner Next build is named explicitly.
config.buildCommand = "pnpm next:build";

export default config;

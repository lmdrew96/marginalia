import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No ISR in Marginalia, so no incremental cache binding is needed.
export default defineCloudflareConfig();

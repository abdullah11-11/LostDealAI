import { register } from "node:module";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url), import.meta.url);

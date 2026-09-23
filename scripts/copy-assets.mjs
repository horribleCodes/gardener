import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist/store"), { recursive: true });
mkdirSync(join(root, "dist/tables"), { recursive: true });
cpSync(join(root, "src/store/schema.sql"), join(root, "dist/store/schema.sql"));
cpSync(join(root, "src/tables/catalog.json"), join(root, "dist/tables/catalog.json"));

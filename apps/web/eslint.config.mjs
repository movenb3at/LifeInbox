import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([...nextVitals, ...nextTs, globalIgnores([".next/**", ".next-e2e/**", "public/ocr/**", "src/lib/api/schema.d.ts", "next-env.d.ts"])]);

import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.wrangler/**", "apps/web/public/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
];

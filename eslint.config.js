// Flat config (ESLint 9+). A csomag "type": "module", ezért ez a fájl natívan ESM.
//
// Miért ez a három réteg: az `@eslint/js` recommended a nyelvi alapszabályokat adja
// (pl. el nem ért ág), a `typescript-eslint` recommended a típusos hibákat (pl. hiányzó
// await, felesleges any) — ez a lényeg, hiszen a forrás 100%-ban TypeScript. Az
// `eslint-config-prettier` a végén kikapcsolja az ütköző stílus-szabályokat, mert a
// formázás a Prettier dolga (`.prettierrc` + `format:check`), nem az eslinté — a kettő
// versengése hamis pirosat adna ugyanarra a sorra.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "build/**", "node_modules/**", "*.mcpb", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Az aláhúzással kezdett paraméter szándékosan nem használt (pl. interfész-egyezés).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // A kódban több helyen (client.ts, projection.ts) a Flex válasza `unknown`-ként jön be,
      // és a szűk típusra szűkítés kézzel, `as`-sal történik — ez tudatos, nem hanyagság.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  eslintConfigPrettier,
);

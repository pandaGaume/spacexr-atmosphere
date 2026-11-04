module.exports = {
    root: true,
    env: { es2022: true, node: true },
    parser: "@typescript-eslint/parser",
    parserOptions: { ecmaVersion: "latest", sourceType: "module", project: "./tsconfig.json" },
    plugins: ["@typescript-eslint", "prettier"],
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "plugin:prettier/recommended"],
    ignorePatterns: ["dist", "coverage", "docs/api"],
    rules: {
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/no-non-null-assertion": "off",
    },
};

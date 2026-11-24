import { so1ve } from "@so1ve/eslint-config";

export default so1ve({
  ignores: [
    "**/.devenv/**",
    "**/.direnv/**",
    "**/.wrangler/**",
    "worker-configuration.d.ts",
  ],
  typescript: {
    overrides: {
      "ts/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: { string: true } },
      ],
    },
  },
  rules: {
    "no-console": "off",
  },
});

module.exports = {
  env: {
    node: true,
    mocha: true,
    es2020: true,
  },
  extends: ["plugin:prettier/recommended", "eslint:recommended"],
  plugins: ["prettier", "mocha"],
  rules: {
    "prettier/prettier": ["error"],
    indent: 0, // avoid conflict with prettier's indent system
    "linebreak-style": ["error", "unix"],
    quotes: ["error", "double", { avoidEscape: true }],
    semi: ["error", "always"],
    "spaced-comment": ["error", "always", { exceptions: ["-", "+"] }],
    "mocha/no-exclusive-tests": "error",
    "no-console": 0,
  },
  overrides: [
    {
      files: "*.ts",
      parser: "@typescript-eslint/parser",
      extends: [
        "plugin:prettier/recommended",
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
      ],
      rules: {
        "@typescript-eslint/no-var-requires": 0,
      },
    },
  ],
  settings: {
    "mocha/additionalTestFunctions": ["describeModule"],
  },
  globals: {
    web3: "readonly",
    artifacts: "readonly",
    assert: "readonly",
    contract: "readonly",
  },
};

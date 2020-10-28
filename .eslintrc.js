module.exports = {
  env: {
    node: true,
    mocha: true,
    es2020: true
  },
  extends: ["plugin:prettier/recommended", "eslint:recommended"],
  plugins: ["prettier", "mocha"],
  rules: {
    "prettier/prettier": ["error"],
    indent: ["error", 2, { SwitchCase: 1 }],
    "linebreak-style": ["error", "unix"],
    quotes: ["error", "double", { avoidEscape: true }],
    semi: ["error", "always"],
    "spaced-comment": ["error", "always", { exceptions: ["-", "+"] }],
    "mocha/no-exclusive-tests": "error",
    "no-console": 0
  },
  settings: {
    "mocha/additionalTestFunctions": ["describeModule"]
  },
  globals: {
    web3: "readonly",
    artifacts: "readonly",
    assert: "readonly",
    contract: "readonly"
  }
};

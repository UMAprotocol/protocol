module.exports = {
  env: {
    browser: true,
    es6: true,
    node: true,
    mocha: true
  },
  extends: ["plugin:prettier/recommended", "eslint:recommended"],
  plugins: ["prettier", "mocha"],
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
      modules: true
    }
  },
  globals: {
    web3: "writable",
    artifacts: "readonly"
  },
  parser: "babel-eslint",
  rules: {
    "prettier/prettier": ["error"],
    indent: ["error", 2, { SwitchCase: 1 }],
    "linebreak-style": ["error", "unix"],
    quotes: ["error", "double", { avoidEscape: true }],
    semi: ["error", "always"],
    "spaced-comment": ["error", "always", { exceptions: ["-", "+"] }],
    "mocha/no-exclusive-tests": "error"
  },
  settings: {
    "mocha/additionalTestFunctions": ["describeModule"]
  }
};

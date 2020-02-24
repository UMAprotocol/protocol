module.exports = {
  env: {
    browser: true
  },
  extends: "eslint:recommended",
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "module"
  },
  rules: {
    indent: ["error", 2, { SwitchCase: 1 }],
    "linebreak-style": ["error", "unix"],
    quotes: ["error", "double", { avoidEscape: true }],
    semi: ["error", "always"],
    "spaced-comment": ["error", "always", { exceptions: ["-", "+"] }],
    "no-undef": [0],
    "no-unused-vars": [0],
    "no-case-declarations": [0],
    "no-constant-condition": [0],
    "no-redeclare": [0],
    "no-console": [0],
    "no-irregular-whitespace": [0]
  }
}

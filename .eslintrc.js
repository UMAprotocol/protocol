module.exports = {
  env: {
    browser: true
  },
  extends: ["plugin:prettier/recommended"],
  plugins: ["prettier"],
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
      modules: true
    }
  },
  parser: "babel-eslint",
  rules: {
    "prettier/prettier": ["error"],
    indent: ["error", 2, { SwitchCase: 1 }],
    "linebreak-style": ["error", "unix"],
    quotes: ["error", "double", { avoidEscape: true }],
    semi: ["error", "always"],
    "spaced-comment": ["error", "always", { exceptions: ["-", "+"] }]
  }
};

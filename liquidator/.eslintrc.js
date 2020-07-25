module.exports = {
  plugins: ["mocha", "prettier"],
  extends: ["eslint:recommended", "plugin:prettier/recommended", "plugin:mocha/recommended"],
  env: {
    browser: false,
    es6: true,
    node: true,
    mocha: true
  },
  parserOptions: {
    ecmaFeatures: {
      experimentalObjectRestSpread: true
    },
    sourceType: "module"
  },
  settings: {
    "mocha/additionalTestFunctions": ["describeModule"]
  },
  globals: {
    web3: "writable",
    artifacts: "readonly"
  },
  overrides: [
    {
      files: ["test*/**.js"],
      globals: {
        assert: "readonly",
        contract: "readonly"
      },
      rules: {
        // truffle injects 'contract'
        "mocha/no-top-level-hooks": "off",
        // currying 'before/after Each'
        "mocha/no-hooks-for-single-case": "off",
        "mocha/no-sibling-hooks": "off"
      }
    }
  ]
};

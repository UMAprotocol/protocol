// Export the truffle-fixture file from `/core/test` so that we can use the `.deployed()` syntax in our tests.
const truffleFixture = require("@uma/core/test/truffle-fixture");
module.exports = truffleFixture;

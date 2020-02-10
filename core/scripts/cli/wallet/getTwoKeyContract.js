const TWO_KEY_ADDRESS = process.env.TWO_KEY_ADDRESS;

/**
 * Validate that 2-Key contract's voter is same as provided default account and return
 * an instance of the contract, or return nothing.
 */
const getDefaultAccount = require("./getDefaultAccount");

const getTwoKeyContract = async (web3, artifacts) => {
  if (TWO_KEY_ADDRESS) {
    const DesignatedVoting = artifacts.require("DesignatedVoting");
    try {
      const voterAccount = await getDefaultAccount(web3);
      const designatedVoting = await DesignatedVoting.at(TWO_KEY_ADDRESS);
      // Role ID '0' = Cold Storage Address
      // Role ID '1' = Voter/Hot Storage Address
      const designatedVoterAccount = await designatedVoting.getMember("1");
      if (designatedVoterAccount !== voterAccount) {
        // Provided voting account is not the designated voter for the provided Two Key Contract
      } else {
        return designatedVoting;
      }
    } catch (err) {
      // Two Key Contract likely does not exist
    }
  }
  // No Two Key Address supplied
};

module.exports = getTwoKeyContract;

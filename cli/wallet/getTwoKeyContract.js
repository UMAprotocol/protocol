/**
 * Detect and return voter's 2 key contract.
 */
const getDefaultAccount = require("./getDefaultAccount");

const DesignatedVoting = require("@umaprotocol/core/build/contracts/DesignatedVoting.json");
const DesignatedVotingFactory = require("@umaprotocol/core/build/contracts/DesignatedVotingFactory.json");

const getTwoKeyContract = async (web3, artifacts) => {
  try {
    const designatedVotingFactory = await DesignatedVotingFactory.deployed();
    const voterAccount = await getDefaultAccount(web3);
    const designatedVoting = await DesignatedVoting.at(
      await designatedVotingFactory.designatedVotingContracts(voterAccount)
    );

    // Confirm that voting permissions are set properly. TODO: This might be redundant.
    // Role ID '0' = Cold Storage Address
    // Role ID '1' = Voter/Hot Storage Address
    const designatedVoterAccount = await designatedVoting.getMember("1");
    if (designatedVoterAccount !== voterAccount) {
      // Provided voting account is not the designated voter for the provided Two Key Contract
      return null;
    } else {
      return designatedVoting;
    }
  } catch (err) {
    // Voter address has not deployed a 2 key contract.
    return null;
  }
};

module.exports = getTwoKeyContract;

/**
 * Return voting contract, voting account, and signing account based on whether user is using a
 * designated voting proxy.
 * @param {String} account current default signing account
 * @param {Object} voting DVM contract
 * @param {Object} [designatedVoting] designated voting proxy contract
 * @return votingContract Contract to send votes to.
 * @return votingAccount address that votes are attributed to.
 * @return signingAddress address used to sign encrypted messages.
 */
function getVotingRoles(account, voting, designatedVoting) {
  const votingRoles = {
    signingAddress: account
  };
  if (designatedVoting) {
    return {
      ...votingRoles,
      votingContract: designatedVoting,
      votingAccount: designatedVoting.options.address
    };
  } else {
    return {
      ...votingRoles,
      votingContract: voting,
      votingAccount: account
    };
  }
}

module.exports = {
  getVotingRoles
};

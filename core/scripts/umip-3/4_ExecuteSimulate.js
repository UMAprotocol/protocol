// This script is used to execute some basic operations on the DVM after the 1_Propose, 2_VoteSimulate, 3_Verify flow is
//  compleat.

const assert = require("assert").strict;

const { getRandomUnsignedInt } = require("../../../common/Random.js");
const { advanceBlockAndSetTime, takeSnapshot, revertToSnapshot } = require("../../../common/SolidityTestUtils.js");
const { RegistryRolesEnum } = require("../../../common/Enums.js");
const { computeVoteHash } = require("../../../common/EncryptionHelper.js");

const Token = artifacts.require("ExpandedERC20");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const Store = artifacts.require("Store");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const Governor = artifacts.require("Governor");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const TokenFactory = artifacts.require("TokenFactory");
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");

const { interfaceName } = require("../../utils/Constants.js");

const publicNetworks = require("../../../common/PublicNetworks.js");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const foundationWallet = "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc";
const largeDaiTokenHolder = "0x4d10ae710bd8d1c31bd7465c8cbc3add6f279e81";
const zeroAddress = "0x0000000000000000000000000000000000000000";

const ownerRole = "0";

// New addresses of ecosystem components after porting from `Propose.js`
const upgradeAddresses = {
  Voting: "0x7492cdbc126ffc05c32249a470982173870e95b0",
  Registry: "0x46209e15a14f602897e6d72da858a6ad806403f1",
  Store: "0x74d367e2207e52f05963479e8395cf44909f075b",
  FinancialContractsAdmin: "0x3b99859be43d543960803c09a0247106e82e74ee",
  IdentifierWhitelist: "0x9e39424eab9161cc3399d886b1428cba71586cb8",
  Governor: "0x878cFeDb234C226ddefd33657937aF74c17628BF",
  Finder: "0x40f941E48A552bF496B154Af6bf55725f18D77c3" // Finder was no upgraded in UMIP3
};

async function runExport() {
  console.log("Running UMIP-3 Upgrade vote simulator🔥");
  let snapshot = await takeSnapshot(web3);
  snapshotId = snapshot["result"];
  console.log("Snapshotting starting state...", snapshotId);

  const secondsPerDay = 86400;
  const accounts = await web3.eth.getAccounts();

  // 1. Load contract infrastructure
  console.log("1. LOADING DEPLOYED CONTRACTS");

  collateralToken = await Token.at(publicNetworks[1].daiAddress);
  console.log("collateralToken loaded \t\t", collateralToken.address);

  const registry = await Registry.at(upgradeAddresses.Registry);
  console.log("registry loaded \t\t", registry.address);

  const finder = await Finder.at(upgradeAddresses.Finder);
  console.log("finder loaded \t\t\t", finder.address);

  const voting = await Voting.at(upgradeAddresses.Voting);
  console.log("voting loaded \t\t\t", voting.address);

  const identiferWhitelist = await IdentifierWhitelist.at(upgradeAddresses.IdentifierWhitelist);
  console.log("identiferWhitelist loaded \t", identiferWhitelist.address);

  const governor = await Governor.at(upgradeAddresses.Governor);

  // 2. Deploy EMP infrastructure
  console.log("2. DEPLOYING EMP INFRASTRUCTURE");

  const tokenFactory = await TokenFactory.new();
  console.log("tokenFactory deployed \t\t", tokenFactory.address);

  const addressWhitelist = await AddressWhitelist.new();
  console.log("addressWhitelist deployed \t", addressWhitelist.address);

  const expiringMultiPartyCreator = await ExpiringMultiPartyCreator.new(
    finder.address,
    addressWhitelist.address,
    tokenFactory.address,
    zeroAddress
  );
  console.log("emp creator deployed \t\t", expiringMultiPartyCreator.address);

  // 3. Create vote to register the EMP creator within the registry
  console.log("3. CREATING DVM REGISTRATION PROPOSAL");

  const empCreatorRegistrationTx = registry.contract.methods
    .addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address)
    .encodeABI();

  const additionProposalTx = await governor.propose(
    [{ to: registry.address, value: 0, data: empCreatorRegistrationTx }],
    {
      from: proposerWallet
    }
  );

  console.log("Adding EMP factory to registry tx:", additionProposalTx.tx);

  // 4. There should now be a vote within the DVM that can be voted on
  console.log("4. VALIDATING PROPOSAL");

  assert.equal((await governor.numProposals()).toNumber(), 1); // there should be 1 proposal
  assert.equal((await voting.getPendingRequests()).length, 0); // There should be no pending requests

  let currentTime = (await voting.getCurrentTime()).toNumber();
  let votingPhase = (await voting.getVotePhase()).toNumber();

  console.log(
    "1 pending proposal. No pending requests.\nCurrent timestamp:",
    currentTime,
    "Voting phase:",
    votingPhase,
    "CurrentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  /** ****************************************************
   * 1) Advance Ganache block time to move voting round *
   ******************************************************/
  console.log("5. ADVANCING TIME TO VOTE ON PROPOSAL");

  // If the DVM is currently in the commit phase (0) then we need to advance into the next round by advancing
  // forward by 2 days. Else if we are in the reveal phase (1) then we need to advance into the next round by
  // advancing by one day to take us into the next round.

  if (votingPhase == 0) {
    await advanceBlockAndSetTime(web3, currentTime + secondsPerDay * 2);
  } else {
    await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);
  }
  console.log(
    "⏱  Advancing time by one phase to enable voting by the DVM\nNew timestamp",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "CurrentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );
  let pendingRequests = await voting.getPendingRequests();
  assert.equal(pendingRequests.length, 1); // the one proposal should have advanced to a request

  let currentRoundId = (await voting.getCurrentRoundId()).toString();

  const identifier = pendingRequests[0].identifier.toString();
  const time = pendingRequests[0].time.toString();
  const price = "1"; // a "yes" vote to include the new EMP factory

  const salt = getRandomUnsignedInt();

  // We can now use the new create vote hash function
  const voteHash = computeVoteHash({
    price,
    salt,
    account: foundationWallet,
    time: time,
    roundId: currentRoundId,
    identifier
  });

  console.log("6. COMMIT VOTE FROM FOUNDATION WALLET\nVote information:");
  console.table({
    price: price,
    salt: salt.toString(),
    account: foundationWallet,
    time: time,
    roundId: currentRoundId,
    identifier: identifier,
    voteHash: voteHash
  });
  // send the foundation wallet some eth to submit the Tx
  await web3.eth.sendTransaction({ from: accounts[0], to: foundationWallet, value: web3.utils.toWei("1") });

  const VoteTx = await voting.commitVote(identifier, time, voteHash, { from: foundationWallet });
  console.log("Voting Tx done!", VoteTx.tx);

  console.log("7. REVEALING FOUNDATION VOTE");
  currentTime = (await voting.getCurrentTime()).toNumber();
  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to enable reveal\nNew timestamp:",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "currentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  const revealTx = await voting.revealVote(identifier, time, price, salt, { from: foundationWallet });
  console.log("Reveal Tx done!", revealTx.tx);

  currentTime = (await voting.getCurrentTime()).toNumber();
  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to conclude vote\nNew timestamp:",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "currentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  assert.equal((await voting.getPendingRequests()).length, 0); // There should be no pending requests as vote is concluded

  /** *******************************************************************
   * 4) Execute proposal submitted to governor now that voting is done *
   **********************************************************************/

  console.log("8. EXECUTING GOVERNOR PROPOSALS");
  console.log((await governor.numProposals()).toNumber());
  const proposalId = 0; // first and only proposal in voting.sol
  const proposal = await governor.getProposal(proposalId);

  // for every transactions within the proposal
  for (let i = 0; i < proposal.transactions.length; i++) {
    console.log("Submitting tx", i, "...");
    let tx = await governor.executeProposal(proposalId.toString(), i.toString(), { from: foundationWallet });
    console.log("Transaction", i, "submitted! tx", tx.tx);
  }

  console.log("9. GOVERNOR TRANSACTION SUCCESSFULLY EXECUTED...EMP FACTORY REGISTERED🎉!");

  //   expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
  //   await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address, {
  //     from: contractCreator
  //   });

  //   // Whitelist collateral currency
  //   collateralTokenWhitelist = await AddressWhitelist.at(await expiringMultiPartyCreator.collateralTokenWhitelist());
  //   await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

  //   constructorParams = {
  //     expirationTimestamp: (await expiringMultiPartyCreator.VALID_EXPIRATION_TIMESTAMPS(0)).toString(),
  //     collateralAddress: collateralToken.address,
  //     priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
  //     syntheticName: "Test UMA Token",
  //     syntheticSymbol: "UMATEST",
  //     collateralRequirement: { rawValue: toWei("1.5") },
  //     disputeBondPct: { rawValue: toWei("0.1") },
  //     sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
  //     disputerDisputeRewardPct: { rawValue: toWei("0.1") },
  //     minSponsorTokens: { rawValue: toWei("1") },
  //     timerAddress: Timer.address
  //   };

  //   identifierWhitelist = await IdentifierWhitelist.deployed();
  //   await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
  //     from: contractCreator
  //   });

  //   await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
  //     from: contractCreator
  //   });
  console.log("...REVERTING STATE...", snapshotId);
  await revertToSnapshot(web3, snapshotId);
}

run = async function(callback) {
  try {
    await runExport();
  } catch (err) {
    console.log("SCRIPT CRASHED...REVERTING STATE...", snapshotId);
    await revertToSnapshot(web3, snapshotId);
    callback(err);
  }
  callback();
};

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
run.runExport = runExport;
module.exports = run;

// This script is used to execute some basic operations on the DVM after the 1_Propose, 2_VoteSimulate, 3_Verify flow is
//  compleat.

const assert = require("assert").strict;

const {
  RegistryRolesEnum,
  PublicNetworks,
  getRandomUnsignedInt,
  advanceBlockAndSetTime,
  takeSnapshot,
  revertToSnapshot,
  computeVoteHash,
} = require("@uma/common");

const Token = artifacts.require("ExpandedERC20");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingInterfaceTesting = artifacts.require("VotingInterfaceTesting");
const Store = artifacts.require("Store");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const Governor = artifacts.require("Governor");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const TokenFactory = artifacts.require("TokenFactory");
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const foundationWallet = "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc";
const largeDaiTokenHolder = "0x4d10ae710bd8d1c31bd7465c8cbc3add6f279e81";
const zeroAddress = "0x0000000000000000000000000000000000000000";

// New addresses of ecosystem components after porting from `Propose.js`
const upgradeAddresses = {
  Voting: Voting.address,
  Registry: Registry.address,
  Store: Store.address,
  FinancialContractsAdmin: FinancialContractsAdmin.address,
  IdentifierWhitelist: IdentifierWhitelist.address,
  Governor: Governor.address,
  Finder: Finder.address, // Finder was not upgraded in UMIP3
};

let snapshotId;

async function runExport() {
  console.log("Running UMIP-3 Upgrade vote simulator🔥");
  let snapshot = await takeSnapshot(web3);
  snapshotId = snapshot["result"];
  console.log("Snapshotting starting state...", snapshotId);

  const secondsPerDay = 86400;
  const accounts = await web3.eth.getAccounts();

  /** ********************************
   * 1. Load contract infrastructure *
   ***********************************/
  console.log("1. LOADING DEPLOYED CONTRACTS");

  const collateralToken = await Token.at(PublicNetworks[1].daiAddress);
  console.log("collateralToken loaded \t\t", collateralToken.address);

  const registry = await Registry.at(upgradeAddresses.Registry);
  console.log("registry loaded \t\t", registry.address);

  const finder = await Finder.at(upgradeAddresses.Finder);
  console.log("finder loaded \t\t\t", finder.address);

  const voting = await VotingInterfaceTesting.at(upgradeAddresses.Voting);
  console.log("voting loaded \t\t\t", voting.address);

  const identifierWhitelist = await IdentifierWhitelist.at(upgradeAddresses.IdentifierWhitelist);
  console.log("identifierWhitelist loaded \t", identifierWhitelist.address);

  const governor = await Governor.at(upgradeAddresses.Governor);
  console.log("governor loaded \t\t", governor.address);

  /** *****************************
   * 2. Deploy EMP infrastructure *
   ********************************/
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

  /** ***************************************************************
   * 3. Create vote to register the EMP creator within the registry *
   ******************************************************************/
  console.log("3. CREATING DVM REGISTRATION PROPOSAL");

  // Transaction to give the EMP creator appropriate roles to create new contracts
  const empCreatorRegistrationTx = registry.contract.methods
    .addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address)
    .encodeABI();

  // Register the EMP's identifer within the identifer whitelist
  const identiferRegistrationTx = identifierWhitelist.contract.methods
    .addSupportedIdentifier(web3.utils.utf8ToHex("ETHBTC"))
    .encodeABI();

  // We can include both transactions at the same time so the DVM only needs to vote once
  const additionProposalTx = await governor.propose(
    [
      { to: registry.address, value: 0, data: empCreatorRegistrationTx },
      { to: identifierWhitelist.address, value: 0, data: identiferRegistrationTx },
    ],
    { from: proposerWallet }
  );

  console.log("Adding EMP factory to registry tx:", additionProposalTx.tx);

  /** ******************************************************************
   * 4. There should now be a vote within the DVM that can be voted on *
   *********************************************************************/
  console.log("4. VALIDATING PROPOSAL");

  let numProposals = (await governor.numProposals()).toNumber();
  let pendingRequests = (await voting.getPendingRequests()).length;

  let currentTime = (await voting.getCurrentTime()).toNumber();
  let votingPhase = (await voting.getVotePhase()).toNumber();

  console.log(
    numProposals,
    "pending proposal.",
    pendingRequests,
    "pending requests.\nCurrent timestamp:",
    currentTime,
    "Voting phase:",
    votingPhase,
    "CurrentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  /** ****************************************************
   * 5. Advance Ganache block time to move voting round *
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
  pendingRequests = await voting.getPendingRequests();
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
    identifier,
  });

  /** *******************************************************************************
   * 6) Submit a commitment to register the emp factory and identifer with the DVM  *
   **********************************************************************************/
  console.log("6. COMMIT VOTE FROM FOUNDATION WALLET\nVote information:");
  console.table({
    price: price,
    salt: salt.toString(),
    account: foundationWallet,
    time: time,
    roundId: currentRoundId,
    identifier: identifier,
    voteHash: voteHash,
  });
  // send the foundation wallet some eth to submit the Tx
  await web3.eth.sendTransaction({ from: accounts[0], to: foundationWallet, value: web3.utils.toWei("1") });

  const VoteTx = await voting.commitVote(identifier, time, voteHash, { from: foundationWallet });
  console.log("Voting Tx done!", VoteTx.tx);

  /** *****************************
   * 7) Revealing foundation vote *
   ********************************/
  console.log("7. REVEALING FOUNDATION VOTE");
  currentTime = (await voting.getCurrentTime()).toNumber();
  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to enable reveal\nNew timestamp:",
    currentTime,
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
    currentTime,
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "currentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  assert.equal((await voting.getPendingRequests()).length, 0); // There should be no pending requests as vote is concluded

  /** ******************************************************************
   * 8) Execute proposal submitted to governor now that voting is done *
   *********************************************************************/
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

  console.log("GOVERNOR TRANSACTION SUCCESSFULLY EXECUTED🔥EMP FACTORY REGISTERED!");

  /** ***************************************
   * 9) Deploy the EMP from the EMP factory *
   ******************************************/
  console.log("9. DEPLOYING NEW EMP FROM FACTORY");

  await addressWhitelist.addToWhitelist(collateralToken.address);

  const constructorParams = {
    expirationTimestamp: "1590969600", // one week contract
    collateralAddress: collateralToken.address,
    priceFeedIdentifier: web3.utils.utf8ToHex("ETHBTC"),
    syntheticName: "Test Synthetic Token",
    syntheticSymbol: "ETHBTCSynth",
    collateralRequirement: { rawValue: web3.utils.toWei("1.5") },
    disputeBondPercentage: { rawValue: web3.utils.toWei("0.1") },
    sponsorDisputeRewardPercentage: { rawValue: web3.utils.toWei("0.1") },
    disputerDisputeRewardPercentage: { rawValue: web3.utils.toWei("0.1") },
    minSponsorTokens: { rawValue: web3.utils.toWei("1") },
    timerAddress: zeroAddress,
  };

  console.log(
    "Is identifer registered",
    await identifierWhitelist.isIdentifierSupported(web3.utils.utf8ToHex("ETHBTC"))
  );

  const empAddress = await expiringMultiPartyCreator.createExpiringMultiParty.call(constructorParams);
  await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams);

  console.log("EMP DEPLOYED🔥\t", empAddress);

  /** ******************************
   * 10) Validating EMP deployment *
   *********************************/
  console.log("10. VALIDATING EMP DEPLOYMENT");

  // Instantiate an instance of the expiringMultiParty and check a few constants that should hold true.
  let expiringMultiParty = await ExpiringMultiParty.at(empAddress);

  assert.equal((await expiringMultiParty.expirationTimestamp()).toString(), constructorParams.expirationTimestamp);
  // Liquidation liveness should be strictly set by EMP creator.
  const enforcedLiquidationLiveness = await expiringMultiPartyCreator.STRICT_LIQUIDATION_LIVENESS();
  assert.equal((await expiringMultiParty.liquidationLiveness()).toString(), enforcedLiquidationLiveness.toString());
  // Withdrawal liveness should be strictly set by EMP creator.
  const enforcedWithdrawalLiveness = await expiringMultiPartyCreator.STRICT_WITHDRAWAL_LIVENESS();
  assert.equal((await expiringMultiParty.withdrawalLiveness()).toString(), enforcedWithdrawalLiveness.toString());
  assert.equal(
    web3.utils.hexToUtf8(await expiringMultiParty.priceIdentifer()),
    web3.utils.hexToUtf8(constructorParams.priceFeedIdentifier)
  );

  /** *********************************
   * 11) Simulate a position creation *
   ************************************/
  console.log("11. CREATING A POSITION FROM A SPONSOR");

  // Instance of the synthetic token
  const syntheticToken = await Token.at(await expiringMultiParty.tokenCurrency());

  // Accounts to execute logic
  const sponsor = accounts[1];
  const liquidator = accounts[2];
  const disputer = accounts[3];

  // approve tokens and send dai from whale
  for (let i = 1; i < 4; i++) {
    console.log("collateral and synthetic approval and seeding account", accounts[i]);
    await collateralToken.approve(expiringMultiParty.address, web3.utils.toWei("1000000"), { from: accounts[i] });
    await syntheticToken.approve(expiringMultiParty.address, web3.utils.toWei("1000000"), { from: accounts[i] });
    await collateralToken.transfer(accounts[i], web3.utils.toWei("1000000"), { from: largeDaiTokenHolder });
  }

  const sponsorPositionSize = web3.utils.toWei("100"); // Let the sponsor make 100 units of synthetic

  // create a position from the sponsor with 200 units of collateral and 100 units of synthetics
  await expiringMultiParty.create(
    { rawValue: web3.utils.toWei("200") },
    { rawValue: sponsorPositionSize },
    { from: sponsor }
  );

  console.log("sponsor position created! sponsor balance", (await syntheticToken.balanceOf(sponsor)).toString());

  // Create a position for the liquidator
  await expiringMultiParty.create(
    { rawValue: web3.utils.toWei("300") },
    { rawValue: sponsorPositionSize },
    { from: liquidator }
  );
  console.log(
    "liquidator position created! liquidator balance",
    (await syntheticToken.balanceOf(liquidator)).toString()
  );

  /** *************************************************************
   * 12) Liquidate the position from the liquidator, then dispute *
   ****************************************************************/
  console.log("12. LIQUIDATE SPONSOR POSITION");

  // The liquidator thinks the price is 1.5e18. This means that each unit of debt is redeemable for 1.5 units of
  // underlying collateral. At this price the position has a collateralization of 133%, which is below the 150%
  // specified by the collateral requirement of the expiring multiparty contract

  await expiringMultiParty.createLiquidation(
    sponsor,
    { rawValue: web3.utils.toWei("999999") },
    { rawValue: sponsorPositionSize },
    { from: liquidator }
  );

  // Create the dispute
  await expiringMultiParty.dispute("0", sponsor, { from: disputer });

  /** **************************************
   * 13) Settle the dispute via a DVM vote *
   *****************************************/
  console.log("13. Vote on outcome of DVM execution");
  currentRoundId = (await voting.getCurrentRoundId()).toString();
  currentTime = (await voting.getCurrentTime()).toNumber();

  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay * 2);

  console.log(
    "⏱  Advancing time to move to next voting round to enable reveal\nNew timestamp:",
    (await voting.getCurrentTime()).toNumber(),
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "currentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  pendingRequests = await voting.getPendingRequests();
  console.log("pendingRequests", pendingRequests);

  const liquidatorObservedPrice = web3.utils.toWei("1.5");
  const identifier2 = pendingRequests[0].identifier.toString();
  const time2 = pendingRequests[0].time.toString();

  const salt2 = getRandomUnsignedInt();

  // We can now use the new create vote hash function
  const voteHash2 = computeVoteHash({
    price: liquidatorObservedPrice,
    salt: salt2,
    account: foundationWallet,
    time: time2,
    roundId: currentRoundId,
    identifer: identifier2,
  });

  console.table({
    price: liquidatorObservedPrice,
    salt: salt2.toString(),
    account: foundationWallet,
    time: time2,
    roundId: currentRoundId,
    identifier: identifier2,
    voteHash: voteHash2,
  });

  const VoteTx2 = await voting.commitVote(identifier2, time2, voteHash2, { from: foundationWallet });
  console.log("Vote committed", VoteTx2.tx);

  // console.log("7. REVEALING FOUNDATION VOTE");
  currentTime = (await voting.getCurrentTime()).toNumber();
  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to enable reveal\nNew timestamp:",
    currentTime,
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "currentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  const revealTx2 = await voting.revealVote(identifier2, time2, liquidatorObservedPrice, salt2, {
    from: foundationWallet,
  });
  console.log("Reveal Tx done!", revealTx2.tx);

  currentTime = (await voting.getCurrentTime()).toNumber();
  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to conclude vote\nNew timestamp:",
    currentTime,
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "currentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  assert.equal((await voting.getPendingRequests()).length, 0); // There should be no pending requests as vote is concluded

  /** ****************************
   * 14) Retrieving rewards from voting *
   *********************************/
  console.log("14. RETRIEVING DVM VOTING REWARDS");
  // TODO: implement logic to retrieve rewards

  console.log("...REVERTING STATE...", snapshotId);
  await revertToSnapshot(web3, snapshotId);
}

const run = async function (callback) {
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

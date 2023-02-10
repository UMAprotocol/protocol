const { assert } = require("chai");
const hre = require("hardhat");
const { web3, getContract, assertEventEmitted, findEvent } = hre;
const {
  didContractThrow,
  interfaceName,
  runDefaultFixture,
  TokenRolesEnum,
  ZERO_ADDRESS,
  RegistryRolesEnum,
} = require("@uma/common");
// const { isEmpty } = require("lodash");
const { hexToUtf8, leftPad, rightPad, utf8ToHex, toWei, toBN /* randomHex, toChecksumAddress */ } = web3.utils;

// Tested contracts
const OptimisticGovernor = getContract("OptimisticGovernorTest");

// Helper contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticAsserterTest = getContract("OptimisticAsserterTest");
const MockOracle = getContract("MockOracleAncillary");
const Timer = getContract("Timer");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const TestnetERC20 = getContract("TestnetERC20");
const TestAvatar = getContract("TestAvatar");

const finalFee = toWei("100");
const liveness = 7200;
const bond = toWei("500");
const identifier = utf8ToHex("ZODIAC");
const totalBond = toBN(finalFee).add(toBN(bond)).toString();
const doubleTotalBond = toBN(totalBond).mul(toBN(2)).toString();
const rules = "https://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.ipfs.dweb.link/";

describe("OptimisticGovernor", () => {
  let accounts, owner, proposer, disputer, rando, executor;

  let timer,
    finder,
    collateralWhitelist,
    store,
    identifierWhitelist,
    registry,
    bondToken,
    mockOracle,
    optimisticAsserter,
    optimisticOracleModule,
    testToken,
    testToken2,
    avatar;

  const constructTransferTransaction = (destination, amount) => {
    return testToken.methods.transfer(destination, amount).encodeABI();
  };

  // const constructProposalDeleteTransaction = (proposalHash) => {
  //   return optimisticOracleModule.methods.deleteProposal(proposalHash).encodeABI();
  // };

  const advanceTime = async (timeIncrease) => {
    await timer.methods
      .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + timeIncrease)
      .send({ from: owner });
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, proposer, disputer, rando, executor] = accounts;

    await runDefaultFixture(hre);

    timer = await Timer.deployed();
    finder = await Finder.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    store = await Store.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    registry = await getContract("Registry").deployed();
    testToken = await TestnetERC20.new("Test", "TEST", 18).send({ from: accounts[0] });
    testToken2 = await TestnetERC20.new("Test2", "TEST2", 18).send({ from: accounts[0] });

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: owner });

    // Deploy new OptimisticAsserter and register it with the Finder and Registry:
    // TODO: This should be moved to separate fixture. defaultCurrency is not added to the whitelist
    // and Store since it is not used in this test, but would be required when moved to a fixture.
    const defaultCurrency = await TestnetERC20.new("Default Currency", "DC", 18).send({ from: owner });
    optimisticAsserter = await OptimisticAsserterTest.new(
      finder.options.address,
      defaultCurrency.options.address,
      liveness,
      timer.options.address
    ).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticAsserter), optimisticAsserter.options.address)
      .send({ from: owner });
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: owner });
    await registry.methods.registerContract([], optimisticAsserter.options.address).send({ from: owner });
    await registry.methods.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: owner });
  });

  beforeEach(async function () {
    // Deploy new contracts with clean state and perform setup:
    avatar = await TestAvatar.new().send({ from: owner });
    bondToken = await ERC20.new("BOND", "BOND", 18).send({ from: owner });
    await bondToken.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
    await collateralWhitelist.methods.addToWhitelist(bondToken.options.address).send({ from: owner });
    await store.methods.setFinalFee(bondToken.options.address, { rawValue: finalFee }).send({ from: owner });

    optimisticOracleModule = await OptimisticGovernor.new(
      finder.options.address,
      avatar.options.address,
      bondToken.options.address,
      bond,
      rules,
      identifier,
      liveness,
      timer.options.address
    ).send({ from: owner });

    await avatar.methods.setModule(optimisticOracleModule.options.address).send({ from: owner });

    await bondToken.methods.mint(proposer, doubleTotalBond).send({ from: owner });
    await bondToken.methods.approve(optimisticOracleModule.options.address, doubleTotalBond).send({ from: proposer });
    await bondToken.methods.mint(disputer, totalBond).send({ from: owner });
    await bondToken.methods.approve(optimisticAsserter.options.address, totalBond).send({ from: disputer });
  });

  it("Constructor validation", async function () {
    // 0 liveness.
    assert(
      await didContractThrow(
        OptimisticGovernor.new(
          finder.options.address,
          avatar.options.address,
          bondToken.options.address,
          bond,
          rules,
          identifier,
          0,
          timer.options.address
        ).send({ from: owner })
      )
    );

    // Unapproved token.
    assert(
      await didContractThrow(
        OptimisticGovernor.new(
          finder.options.address,
          avatar.options.address,
          (await ERC20.new("BOND", "BOND", 18).send({ from: owner })).options.address,
          bond,
          rules,
          identifier,
          liveness,
          timer.options.address
        ).send({ from: owner })
      )
    );

    // Unapproved identifier.
    assert(
      await didContractThrow(
        OptimisticGovernor.new(
          finder.options.address,
          avatar.options.address,
          bondToken.options.address,
          bond,
          rules,
          utf8ToHex("Unapproved"),
          liveness,
          timer.options.address
        ).send({ from: owner })
      )
    );
  });

  it("Valid proposals should be hashed and stored and emit event", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: testToken.options.address, operation, value: 0, data: txnData1 },
      { to: testToken.options.address, operation, value: 0, data: txnData2 },
      { to: testToken2.options.address, operation, value: 0, data: txnData3 },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    let receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { proposalHash } = (
      await findEvent(receipt, optimisticOracleModule, "TransactionsProposed")
    ).match.returnValues;
    assert.notEqual(proposalHash, "0x0000000000000000000000000000000000000000000000000000000000000000");

    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());
    const endingTime = proposalTime + liveness;

    const assertionId = await optimisticOracleModule.methods.proposalHashes(proposalHash).call();
    const claim = utf8ToHex("proposalHash:" + proposalHash.slice(2) + ",explanation:" + hexToUtf8(explanation));

    await assertEventEmitted(
      receipt,
      optimisticOracleModule,
      "TransactionsProposed",
      (event) =>
        event.proposer == proposer &&
        event.proposalTime == proposalTime &&
        event.proposalHash == proposalHash &&
        event.explanation == explanation &&
        event.challengeWindowEnds == endingTime &&
        event.proposal.requestTime == proposalTime &&
        event.proposal.transactions[0].to == testToken.options.address &&
        event.proposal.transactions[0].value == 0 &&
        event.proposal.transactions[0].data == txnData1 &&
        event.proposal.transactions[0].operation == 0 &&
        event.proposal.transactions[1].to == testToken.options.address &&
        event.proposal.transactions[1].value == 0 &&
        event.proposal.transactions[1].data == txnData2 &&
        event.proposal.transactions[1].operation == 0 &&
        event.proposal.transactions[2].to == testToken2.options.address &&
        event.proposal.transactions[2].value == 0 &&
        event.proposal.transactions[2].data == txnData3 &&
        event.proposal.transactions[2].operation == 0
    );
    await assertEventEmitted(
      receipt,
      optimisticAsserter,
      "AssertionMade",
      (event) =>
        event.assertionId == assertionId &&
        event.domainId == leftPad(0, 64) &&
        event.claim == claim &&
        event.asserter == proposer &&
        event.callbackRecipient == optimisticOracleModule.options.address &&
        event.escalationManager == ZERO_ADDRESS &&
        event.caller == optimisticOracleModule.options.address &&
        event.expirationTime == endingTime &&
        event.currency == bondToken.options.address &&
        event.bond == bond.toString()
    );
  });

  it("Can not send transactions to the 0x0 address", async function () {
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const operation = 0; // 0 for call, 1 for delegatecall
    const transactions = [{ to: ZERO_ADDRESS, operation, value: 0, data: txnData1 }];
    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    assert(
      await didContractThrow(
        optimisticOracleModule.methods.proposeTransactions(transactions, explanation).send({ from: proposer })
      )
    );
  });

  it("Can not send transactions with data to an EOA", async function () {
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const operation = 0; // 0 for call, 1 for delegatecall
    const transactions = [{ to: executor, operation, value: 0, data: txnData1 }];
    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    assert(
      await didContractThrow(
        optimisticOracleModule.methods.proposeTransactions(transactions, explanation).send({ from: proposer })
      )
    );
  });

  it("Approved proposals can be executed by any address", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: testToken.options.address, operation, value: 0, data: txnData1 },
      { to: testToken.options.address, operation, value: 0, data: txnData2 },
      { to: testToken2.options.address, operation, value: 0, data: txnData3 },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    let receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { proposalHash } = (
      await findEvent(receipt, optimisticOracleModule, "TransactionsProposed")
    ).match.returnValues;

    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());
    const endingTime = proposalTime + liveness;

    const assertionId = await optimisticOracleModule.methods.proposalHashes(proposalHash).call();

    await assertEventEmitted(
      receipt,
      optimisticOracleModule,
      "TransactionsProposed",
      (event) =>
        event.proposer == proposer &&
        event.proposalTime == proposalTime &&
        event.proposalHash == proposalHash &&
        event.explanation == explanation &&
        event.challengeWindowEnds == endingTime &&
        event.proposal.requestTime == proposalTime &&
        event.proposal.transactions[0].to == testToken.options.address &&
        event.proposal.transactions[0].value == 0 &&
        event.proposal.transactions[0].data == txnData1 &&
        event.proposal.transactions[0].operation == 0 &&
        event.proposal.transactions[1].to == testToken.options.address &&
        event.proposal.transactions[1].value == 0 &&
        event.proposal.transactions[1].data == txnData2 &&
        event.proposal.transactions[1].operation == 0 &&
        event.proposal.transactions[2].to == testToken2.options.address &&
        event.proposal.transactions[2].value == 0 &&
        event.proposal.transactions[2].data == txnData3 &&
        event.proposal.transactions[2].operation == 0
    );

    // Wait until the end of the dispute period.
    await advanceTime(liveness);

    // Set starting balances of tokens to be transferred.
    const startingBalance1 = toBN(await testToken.methods.balanceOf(proposer).call());
    const startingBalance2 = toBN(await testToken.methods.balanceOf(rando).call());
    const startingBalance3 = toBN(await testToken2.methods.balanceOf(proposer).call());

    receipt = await optimisticOracleModule.methods.executeProposal(transactions).send({ from: executor });
    assert.equal(
      (await testToken.methods.balanceOf(proposer).call()).toString(),
      startingBalance1.add(toBN(toWei("1"))).toString()
    );
    assert.equal(
      (await testToken.methods.balanceOf(rando).call()).toString(),
      startingBalance2.add(toBN(toWei("2"))).toString()
    );
    assert.equal(
      (await testToken2.methods.balanceOf(proposer).call()).toString(),
      startingBalance3.add(toBN(toWei("2"))).toString()
    );

    await assertEventEmitted(
      receipt,
      optimisticOracleModule,
      "ProposalExecuted",
      (event) => event.proposalHash == proposalHash && event.assertionId == assertionId
    );
  });

  it("Proposals can not be executed twice", async function () {
    // Issue some test tokens to the avatar address (double the amount needed to execute the proposal).
    await testToken.methods.allocateTo(avatar.options.address, toWei("6")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("4")).send({ from: accounts[0] });

    // Construct the transaction data to send half of newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: testToken.options.address, operation, value: 0, data: txnData1 },
      { to: testToken.options.address, operation, value: 0, data: txnData2 },
      { to: testToken2.options.address, operation, value: 0, data: txnData3 },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    await optimisticOracleModule.methods.proposeTransactions(transactions, explanation).send({ from: proposer });

    // Wait until the end of the dispute period.
    await advanceTime(liveness);

    // Execute the proposal.
    await optimisticOracleModule.methods.executeProposal(transactions).send({ from: executor });

    // Try to execute the proposal again.
    assert(
      await didContractThrow(optimisticOracleModule.methods.executeProposal(transactions).send({ from: executor }))
    );
  });

  it("Proposals can not be executed until after liveness", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: testToken.options.address, operation, value: 0, data: txnData1 },
      { to: testToken.options.address, operation, value: 0, data: txnData2 },
      { to: testToken2.options.address, operation, value: 0, data: txnData3 },
    ];

    // Advance time to one second before end of the dispute period.
    const tooEarly = liveness - 1;
    await advanceTime(tooEarly);

    assert(
      await didContractThrow(optimisticOracleModule.methods.executeProposal(transactions).send({ from: executor }))
    );
  });

  it("Proposals can be disputed", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: testToken.options.address, operation, value: 0, data: txnData1 },
      { to: testToken.options.address, operation, value: 0, data: txnData2 },
      { to: testToken2.options.address, operation, value: 0, data: txnData3 },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    let receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { assertionId } = (await findEvent(receipt, optimisticAsserter, "AssertionMade")).match.returnValues;

    const { proposalHash } = (
      await findEvent(receipt, optimisticOracleModule, "TransactionsProposed")
    ).match.returnValues;

    // Advance time to one second before end of the dispute period.
    const stillOpen = liveness - 1;
    await advanceTime(stillOpen);

    let disputeReceipt = await optimisticAsserter.methods
      .disputeAssertion(assertionId, disputer)
      .send({ from: disputer });

    await assertEventEmitted(
      disputeReceipt,
      optimisticAsserter,
      "AssertionDisputed",
      (event) => event.assertionId == assertionId && event.caller == disputer && event.disputer == disputer
    );

    // Disputed proposal hash is deleted automatically from callback.
    const disputedProposalHash = await optimisticOracleModule.methods.proposalHashes(proposalHash).call();
    assert.equal(disputedProposalHash, 0);
  });

  it("Disputed proposals can be proposed again", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: testToken.options.address, operation, value: 0, data: txnData1 },
      { to: testToken.options.address, operation, value: 0, data: txnData2 },
      { to: testToken2.options.address, operation, value: 0, data: txnData3 },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    let receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { assertionId } = (await findEvent(receipt, optimisticAsserter, "AssertionMade")).match.returnValues;

    const { proposalHash } = (
      await findEvent(receipt, optimisticOracleModule, "TransactionsProposed")
    ).match.returnValues;

    // Advance time to one second before end of the dispute period.
    const stillOpen = liveness - 1;
    await advanceTime(stillOpen);

    // Duplicate proposal should be rejected if the proposal still exists.
    assert(
      await didContractThrow(
        optimisticOracleModule.methods.proposeTransactions(transactions, explanation).send({ from: proposer })
      )
    );

    // Dispute proposal
    await optimisticAsserter.methods.disputeAssertion(assertionId, disputer).send({ from: disputer });

    // Disputed proposal hash is deleted automatically from callback.
    const disputedProposalHashTimestamp = await optimisticOracleModule.methods.proposalHashes(proposalHash).call();
    assert.equal(disputedProposalHashTimestamp, 0);

    // Duplicate proposal can be made after original proposal is deleted. This is useful in case the disputer was wrong.
    let receipt2 = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const proposalTime2 = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());
    const endingTime2 = proposalTime2 + liveness;

    await assertEventEmitted(
      receipt2,
      optimisticOracleModule,
      "TransactionsProposed",
      (event) =>
        event.proposer == proposer &&
        event.proposalTime == proposalTime2 &&
        event.proposalHash == proposalHash &&
        event.explanation == explanation &&
        event.challengeWindowEnds == endingTime2 &&
        event.proposal.requestTime == proposalTime2 &&
        event.proposal.transactions[0].to == testToken.options.address &&
        event.proposal.transactions[0].value == 0 &&
        event.proposal.transactions[0].data == txnData1 &&
        event.proposal.transactions[0].operation == 0 &&
        event.proposal.transactions[1].to == testToken.options.address &&
        event.proposal.transactions[1].value == 0 &&
        event.proposal.transactions[1].data == txnData2 &&
        event.proposal.transactions[1].operation == 0 &&
        event.proposal.transactions[2].to == testToken2.options.address &&
        event.proposal.transactions[2].value == 0 &&
        event.proposal.transactions[2].data == txnData3 &&
        event.proposal.transactions[2].operation == 0
    );
  });

  it("Can not delete proposal with the same optimistic asserter", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: testToken.options.address, operation, value: 0, data: txnData1 },
      { to: testToken.options.address, operation, value: 0, data: txnData2 },
      { to: testToken2.options.address, operation, value: 0, data: txnData3 },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    let receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { proposalHash } = (
      await findEvent(receipt, optimisticOracleModule, "TransactionsProposed")
    ).match.returnValues;

    // deleteProposalOnUpgrade should fail if the optimistic asserter was not upgraded.
    assert(
      await didContractThrow(
        optimisticOracleModule.methods.deleteProposalOnUpgrade(proposalHash).send({ from: disputer })
      )
    );
  });

  it("Can delete proposal after optimistic asserter upgrade", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: testToken.options.address, operation, value: 0, data: txnData1 },
      { to: testToken.options.address, operation, value: 0, data: txnData2 },
      { to: testToken2.options.address, operation, value: 0, data: txnData3 },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    let receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { assertionId } = (await findEvent(receipt, optimisticAsserter, "AssertionMade")).match.returnValues;

    const { proposalHash } = (
      await findEvent(receipt, optimisticOracleModule, "TransactionsProposed")
    ).match.returnValues;

    // Upgrade the optimistic asserter.
    const defaultCurrency = await TestnetERC20.new("Default Currency", "DC", 18).send({ from: owner });
    const newOptimisticAsserter = await OptimisticAsserterTest.new(
      finder.options.address,
      defaultCurrency.options.address,
      liveness,
      timer.options.address
    ).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticAsserter), newOptimisticAsserter.options.address)
      .send({ from: owner });

    // deleteProposalOnUpgrade should still fail as the upgraded optimistic asserter is not yet cached.
    assert(
      await didContractThrow(
        optimisticOracleModule.methods.deleteProposalOnUpgrade(proposalHash).send({ from: disputer })
      )
    );

    // Cache the upgraded optimistic asserter.
    await optimisticOracleModule.methods.sync().send({ from: disputer });

    // deleteProposalOnUpgrade should now succeed.
    let receipt2 = await optimisticOracleModule.methods.deleteProposalOnUpgrade(proposalHash).send({ from: disputer });
    await assertEventEmitted(
      receipt2,
      optimisticOracleModule,
      "ProposalDeleted",
      (event) => event.proposalHash == proposalHash && event.assertionId == assertionId
    );

    // Revert to the original optimistic asserter for other tests.
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticAsserter), optimisticAsserter.options.address)
      .send({ from: owner });
  });

  it("Disputed proposals can not be executed", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: testToken.options.address, operation, value: 0, data: txnData1 },
      { to: testToken.options.address, operation, value: 0, data: txnData2 },
      { to: testToken2.options.address, operation, value: 0, data: txnData3 },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    const receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { assertionId } = (await findEvent(receipt, optimisticAsserter, "AssertionMade")).match.returnValues;

    // Advance time to one second before end of the dispute period.
    const stillOpen = liveness - 1;
    await advanceTime(stillOpen);

    // Dispute.
    await optimisticAsserter.methods.disputeAssertion(assertionId, disputer).send({ from: disputer });

    // Advance time past the liveness window.
    await advanceTime(2);

    // Proposal should not be executed.
    assert(
      await didContractThrow(optimisticOracleModule.methods.executeProposal(transactions).send({ from: executor }))
    );
  });

  // /*
  //  * This test is currently failing. Need to reason about how to send a transaction from the avatar
  //  * to the module itself, with the transaction being proposed and approved through the module.
  //  */
  // it("Owner can delete proposals before execution", async function () {
  //   // Issue some test tokens to the avatar address.
  //   await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
  //   await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });
  //   // Construct the transaction data to send the newly minted tokens to proposer and another address.
  //   const txnData1 = constructTransferTransaction(proposer, toWei("1"));
  //   const txnData2 = constructTransferTransaction(rando, toWei("2"));
  //   const txnData3 = constructTransferTransaction(proposer, toWei("2"));
  //   const operation = 0; // 0 for call, 1 for delegatecall
  //   // Send the proposal with multiple transactions.
  //   const prevProposalId = parseInt(await optimisticOracleModule.methods.prevProposalId().call());
  //   const proposalId = prevProposalId + 1;
  //   const transactions = [
  //     { to: testToken.options.address, value: 0, data: txnData1, operation },
  //     { to: testToken.options.address, value: 0, data: txnData2, operation },
  //     { to: testToken2.options.address, value: 0, data: txnData3, operation },
  //   ];
  //   const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");
  //   await optimisticOracleModule.methods.proposeTransactions(transactions, explanation).send({ from: proposer });
  //   const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

  //   // Wait until the end of the dispute period.
  //   await advanceTime(liveness);

  //   // Create new proposal to delete the old one.
  //   const txnData4 = constructProposalDeleteTransaction(proposalId);
  //   const deleteId = proposalId + 1;
  //   console.log("deleteId:", deleteId);
  //   const deleteTransaction = [{ to: optimisticOracleModule.options.address, value: 0, data: txnData4, operation }];
  //   const deleteExplanation = utf8ToHex("Oops, we messed up the parameters on the other proposal.");
  //   await optimisticOracleModule.methods
  //     .proposeTransactions(deleteTransaction, deleteExplanation)
  //     .send({ from: proposer });
  //   const deleteProposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

  //   // Wait until the end of the new dispute period.
  //   await advanceTime(liveness);

  //   // Execute the delete proposal.
  //   await optimisticOracleModule.methods
  //     .executeProposal(deleteId, deleteTransaction, deleteProposalTime)
  //     .send({ from: executor });

  //   // Original proposal can not be executed.
  //   assert(
  //     await didContractThrow(
  //       optimisticOracleModule.methods.executeProposal(proposalId, transactions, proposalTime).send({ from: executor })
  //     )
  //   );
  // });

  it("Owner can update stored contract parameters", async function () {
    // All tests here are run through the avatar contract that is the owner of the module.

    // Deploy new bond token and set it as the new collateral currency.
    const newBondToken = await ERC20.new("New Bond", "BOND2", 18).send({ from: owner });
    await collateralWhitelist.methods.addToWhitelist(newBondToken.options.address).send({ from: owner });
    const newBondAmount = "1";
    const setCollateralData = optimisticOracleModule.methods
      .setCollateralAndBond(newBondToken.options.address, newBondAmount)
      .encodeABI();
    let collateralReceipt = await avatar.methods
      .exec(optimisticOracleModule.options.address, "0", setCollateralData)
      .send({ from: owner });

    // Check that the new bond token is set as the collateral currency and correct amount.
    assert.equal(await optimisticOracleModule.methods.collateral().call(), newBondToken.options.address);
    assert.equal(await optimisticOracleModule.methods.bondAmount().call(), newBondAmount);
    await assertEventEmitted(
      collateralReceipt,
      optimisticOracleModule,
      "SetBond",
      (event) => event.collateral == newBondToken.options.address && event.bondAmount == newBondAmount
    );

    // Set new rules.
    const newRules = "New rules";
    const setRulesData = optimisticOracleModule.methods.setRules(newRules).encodeABI();
    let rulesReceipt = await avatar.methods
      .exec(optimisticOracleModule.options.address, "0", setRulesData)
      .send({ from: owner });

    // Check that the new rules are set.
    assert.equal(await optimisticOracleModule.methods.rules().call(), newRules);
    await assertEventEmitted(rulesReceipt, optimisticOracleModule, "SetRules", (event) => event.rules == newRules);

    // Set new liveness.
    const newLiveness = "10";
    const setLivenessData = optimisticOracleModule.methods.setLiveness(newLiveness).encodeABI();
    let livenessReceipt = await avatar.methods
      .exec(optimisticOracleModule.options.address, "0", setLivenessData)
      .send({ from: owner });

    // Check that the new liveness is set.
    assert.equal(await optimisticOracleModule.methods.liveness().call(), newLiveness);
    await assertEventEmitted(
      livenessReceipt,
      optimisticOracleModule,
      "SetLiveness",
      (event) => event.liveness == newLiveness
    );

    // Set new identifier and whitelist it.
    const newIdentifier = rightPad(utf8ToHex("New Identifier"), 64);
    await identifierWhitelist.methods.addSupportedIdentifier(newIdentifier).send({ from: owner });
    const setIdentifierData = optimisticOracleModule.methods.setIdentifier(newIdentifier).encodeABI();
    let identifierReceipt = await avatar.methods
      .exec(optimisticOracleModule.options.address, "0", setIdentifierData)
      .send({ from: owner });

    // Check that the new identifier is set.
    assert.equal(await optimisticOracleModule.methods.identifier().call(), newIdentifier);
    await assertEventEmitted(
      identifierReceipt,
      optimisticOracleModule,
      "SetIdentifier",
      (event) => event.identifier == newIdentifier
    );

    // Set new Escalation Manager.
    const newEscalationManager = executor;
    const setEscalationManagerData = optimisticOracleModule.methods
      .setEscalationManager(newEscalationManager)
      .encodeABI();
    let escalationManagerReceipt = await avatar.methods
      .exec(optimisticOracleModule.options.address, "0", setEscalationManagerData)
      .send({ from: owner });

    // Check that the new Escalation Manager is set.
    assert.equal(await optimisticOracleModule.methods.escalationManager().call(), newEscalationManager);
    await assertEventEmitted(
      escalationManagerReceipt,
      optimisticOracleModule,
      "SetEscalationManager",
      (event) => event.escalationManager == newEscalationManager
    );
  });

  it("Non-owners can not update stored contract parameters", async function () {});

  it("Proposals can be executed with minimal proxy optimistic governor", async function () {
    // Deploy proxy factory.
    const ModuleProxyFactory = getContract("ModuleProxyFactory");
    const moduleProxyFactory = await ModuleProxyFactory.new().send({ from: owner });

    // Deploy and initialize module through proxy factory.
    const initializeParams = web3.eth.abi.encodeParameters(
      ["address", "address", "uint256", "string", "bytes32", "uint64"],
      [avatar.options.address, bondToken.options.address, bond, rules, identifier, liveness]
    );
    const moduleSetupData = optimisticOracleModule.methods.setUp(initializeParams).encodeABI();
    const saltNonce = 0;
    let receipt = await moduleProxyFactory.methods
      .deployModule(optimisticOracleModule.options.address, moduleSetupData, saltNonce)
      .send({ from: owner });

    // Get deployed proxy module.
    const proxyAddress = (await findEvent(receipt, moduleProxyFactory, "ModuleProxyCreation")).match.returnValues.proxy;
    const proxyOptimisticOracleModule = await getContract("OptimisticGovernorTest").at(proxyAddress);

    // Set timer for proxy module.
    await proxyOptimisticOracleModule.methods.setTimer(timer.options.address).send({ from: owner });

    // Point avatar to proxy module.
    await avatar.methods.setModule(proxyAddress).send({ from: owner });

    // Approve proposal bond for proxy module.
    await bondToken.methods.approve(proxyAddress, doubleTotalBond).send({ from: proposer });

    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: testToken.options.address, operation, value: 0, data: txnData1 },
      { to: testToken.options.address, operation, value: 0, data: txnData2 },
      { to: testToken2.options.address, operation, value: 0, data: txnData3 },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    // Propose transactions on proxy module.
    receipt = await proxyOptimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { proposalHash } = (
      await findEvent(receipt, proxyOptimisticOracleModule, "TransactionsProposed")
    ).match.returnValues;

    const proposalTime = parseInt(await proxyOptimisticOracleModule.methods.getCurrentTime().call());
    const endingTime = proposalTime + liveness;

    await assertEventEmitted(
      receipt,
      proxyOptimisticOracleModule,
      "TransactionsProposed",
      (event) =>
        event.proposer == proposer &&
        event.proposalTime == proposalTime &&
        event.proposalHash == proposalHash &&
        event.explanation == explanation &&
        event.challengeWindowEnds == endingTime &&
        event.proposal.requestTime == proposalTime &&
        event.proposal.transactions[0].to == testToken.options.address &&
        event.proposal.transactions[0].value == 0 &&
        event.proposal.transactions[0].data == txnData1 &&
        event.proposal.transactions[0].operation == 0 &&
        event.proposal.transactions[1].to == testToken.options.address &&
        event.proposal.transactions[1].value == 0 &&
        event.proposal.transactions[1].data == txnData2 &&
        event.proposal.transactions[1].operation == 0 &&
        event.proposal.transactions[2].to == testToken2.options.address &&
        event.proposal.transactions[2].value == 0 &&
        event.proposal.transactions[2].data == txnData3 &&
        event.proposal.transactions[2].operation == 0
    );

    // Wait until the end of the dispute period.
    await advanceTime(liveness);

    // Set starting balances of tokens to be transferred.
    const startingBalance1 = toBN(await testToken.methods.balanceOf(proposer).call());
    const startingBalance2 = toBN(await testToken.methods.balanceOf(rando).call());
    const startingBalance3 = toBN(await testToken2.methods.balanceOf(proposer).call());

    // Execute transactions on proxy module.
    await proxyOptimisticOracleModule.methods.executeProposal(transactions).send({ from: executor });
    assert.equal(
      (await testToken.methods.balanceOf(proposer).call()).toString(),
      startingBalance1.add(toBN(toWei("1"))).toString()
    );
    assert.equal(
      (await testToken.methods.balanceOf(rando).call()).toString(),
      startingBalance2.add(toBN(toWei("2"))).toString()
    );
    assert.equal(
      (await testToken2.methods.balanceOf(proposer).call()).toString(),
      startingBalance3.add(toBN(toWei("2"))).toString()
    );
  });
});

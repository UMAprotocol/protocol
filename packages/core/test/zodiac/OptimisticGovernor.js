const { assert } = require("chai");
const hre = require("hardhat");
const { web3, getContract, assertEventEmitted, findEvent } = hre;
const { didContractThrow, interfaceName, runDefaultFixture, TokenRolesEnum, ZERO_ADDRESS } = require("@uma/common");
// const { isEmpty } = require("lodash");
const { utf8ToHex, toWei, toBN /* randomHex, toChecksumAddress */ } = web3.utils;

// Tested contracts
const OptimisticGovernor = getContract("OptimisticGovernorTest");

// Helper contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("OptimisticOracle");
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
const rules = "https://insert.gist.text.url";

describe("OptimisticGovernor", () => {
  let accounts, owner, proposer, disputer, rando, executor;

  let timer,
    finder,
    collateralWhitelist,
    store,
    identifierWhitelist,
    bondToken,
    mockOracle,
    optimisticOracle,
    optimisticOracleModule,
    testToken,
    testToken2,
    avatar;

  const constructTransferTransaction = (destination, amount) => {
    return testToken.methods.transfer(destination, amount).encodeABI();
  };

  const constructProposalDeleteTransaction = (id) => {
    return optimisticOracleModule.methods.deleteProposal(id).encodeABI();
  };

  const advanceTime = async (timeIncrease) => {
    await timer.methods
      .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + timeIncrease)
      .send({ from: owner });
  };

  const pushPrice = async (price) => {
    const [lastQuery] = (await mockOracle.methods.getPendingQueries().call()).slice(-1);
    await mockOracle.methods
      .pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price)
      .send({ from: accounts[0] });
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
    optimisticOracle = await OptimisticOracle.deployed();
    testToken = await TestnetERC20.new("Test", "TEST", 18).send({ from: accounts[0] });
    testToken2 = await TestnetERC20.new("Test2", "TEST2", 18).send({ from: accounts[0] });

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: owner });
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

    avatar.methods.setModule(optimisticOracleModule.options.address).send({ from: owner });

    await bondToken.methods.mint(proposer, doubleTotalBond).send({ from: owner });
    await bondToken.methods.approve(optimisticOracleModule.options.address, doubleTotalBond).send({ from: proposer });
    await bondToken.methods.mint(disputer, totalBond).send({ from: owner });
    await bondToken.methods.approve(optimisticOracle.options.address, totalBond).send({ from: disputer });
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
    const prevProposalId = parseInt(await optimisticOracleModule.methods.prevProposalId().call());
    const id = prevProposalId + 1;

    const transactions = [
      { to: testToken.options.address, value: 0, data: txnData1, operation },
      { to: testToken.options.address, value: 0, data: txnData2, operation },
      { to: testToken2.options.address, value: 0, data: txnData3, operation },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    let receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const proposalHash = await optimisticOracleModule.methods.proposalHashes(id).call();
    assert.notEqual(proposalHash, "0x0000000000000000000000000000000000000000000000000000000000000000");
    const futureProposalHash = await optimisticOracleModule.methods.proposalHashes(id + 1).call();
    assert.equal(futureProposalHash, "0x0000000000000000000000000000000000000000000000000000000000000000");

    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

    await assertEventEmitted(
      receipt,
      optimisticOracleModule,
      "TransactionsProposed",
      (event) =>
        event.proposalId == id &&
        event.proposer == proposer &&
        event.proposalTime == proposalTime &&
        event.explanation == explanation &&
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
  });

  it("Can not send transactions to the 0x0 address", async function () {
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const operation = 0; // 0 for call, 1 for delegatecall
    const transactions = [{ to: ZERO_ADDRESS, value: 0, data: txnData1, operation }];
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
    const transactions = [{ to: executor, value: 0, data: txnData1, operation }];
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
    const prevProposalId = parseInt(await optimisticOracleModule.methods.prevProposalId().call());
    const id = prevProposalId + 1;

    const transactions = [
      { to: testToken.options.address, value: 0, data: txnData1, operation },
      { to: testToken.options.address, value: 0, data: txnData2, operation },
      { to: testToken2.options.address, value: 0, data: txnData3, operation },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    let receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

    await assertEventEmitted(
      receipt,
      optimisticOracleModule,
      "TransactionsProposed",
      (event) =>
        event.proposalId == id &&
        event.proposer == proposer &&
        event.proposalTime == proposalTime &&
        event.explanation == explanation &&
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

    await optimisticOracleModule.methods.executeProposal(id, transactions, proposalTime).send({ from: executor });
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

  it("Proposals can not be executed twice", async function () {});

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
    const prevProposalId = parseInt(await optimisticOracleModule.methods.prevProposalId().call());
    const id = prevProposalId + 1;

    const transactions = [
      { to: testToken.options.address, value: 0, data: txnData1, operation },
      { to: testToken.options.address, value: 0, data: txnData2, operation },
      { to: testToken2.options.address, value: 0, data: txnData3, operation },
    ];

    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

    // Advance time to one second before end of the dispute period.
    const tooEarly = liveness - 1;
    await advanceTime(tooEarly);

    assert(
      await didContractThrow(
        optimisticOracleModule.methods.executeProposal(id, transactions, proposalTime).send({ from: executor })
      )
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
      { to: testToken.options.address, value: 0, data: txnData1, operation },
      { to: testToken.options.address, value: 0, data: txnData2, operation },
      { to: testToken2.options.address, value: 0, data: txnData3, operation },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    let receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { ancillaryData } = (await findEvent(receipt, optimisticOracle, "ProposePrice")).match.returnValues;

    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

    // Advance time to one second before end of the dispute period.
    const stillOpen = liveness - 1;
    await advanceTime(stillOpen);

    let disputeReceipt = await optimisticOracle.methods
      .disputePrice(optimisticOracleModule.options.address, identifier, proposalTime, ancillaryData)
      .send({ from: disputer });

    await assertEventEmitted(
      disputeReceipt,
      optimisticOracle,
      "DisputePrice",
      (event) => event.requester == optimisticOracleModule.options.address && event.ancillaryData == ancillaryData
    );
  });

  it("Disputed proposals can not be settled until DVM vote resolves", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const prevProposalId = parseInt(await optimisticOracleModule.methods.prevProposalId().call());
    const id = prevProposalId + 1;

    const transactions = [
      { to: testToken.options.address, value: 0, data: txnData1, operation },
      { to: testToken.options.address, value: 0, data: txnData2, operation },
      { to: testToken2.options.address, value: 0, data: txnData3, operation },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    let receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { ancillaryData } = (await findEvent(receipt, optimisticOracle, "ProposePrice")).match.returnValues;

    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

    // Advance time to one second before end of the dispute period.
    const stillOpen = liveness - 1;
    await advanceTime(stillOpen);

    await optimisticOracle.methods
      .disputePrice(optimisticOracleModule.options.address, identifier, proposalTime, ancillaryData)
      .send({ from: disputer });

    // Advance time past end of liveness window.
    await advanceTime(2);

    assert(
      await didContractThrow(
        optimisticOracleModule.methods.executeProposal(id, transactions, proposalTime).send({ from: executor })
      )
    );
  });

  it("Disputed proposals can be executed if approved by the DVM", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const prevProposalId = parseInt(await optimisticOracleModule.methods.prevProposalId().call());
    const id = prevProposalId + 1;

    const transactions = [
      { to: testToken.options.address, value: 0, data: txnData1, operation },
      { to: testToken.options.address, value: 0, data: txnData2, operation },
      { to: testToken2.options.address, value: 0, data: txnData3, operation },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    const receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { ancillaryData } = (await findEvent(receipt, optimisticOracle, "ProposePrice")).match.returnValues;

    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

    // Advance time to one second before end of the dispute period.
    const stillOpen = liveness - 1;
    await advanceTime(stillOpen);

    // Dispute.
    await optimisticOracle.methods
      .disputePrice(optimisticOracleModule.options.address, identifier, proposalTime, ancillaryData)
      .send({ from: disputer });

    // DVM approves the proposal.
    await pushPrice(toWei("1"));

    // Set starting balances of tokens to be transferred.
    const startingBalance1 = toBN(await testToken.methods.balanceOf(proposer).call());
    const startingBalance2 = toBN(await testToken.methods.balanceOf(rando).call());
    const startingBalance3 = toBN(await testToken2.methods.balanceOf(proposer).call());

    // Execute proposal and test results.
    await optimisticOracleModule.methods.executeProposal(id, transactions, proposalTime).send({ from: executor });
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

  it("Disputed proposals can not be executed if rejected by the DVM", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const prevProposalId = parseInt(await optimisticOracleModule.methods.prevProposalId().call());
    const id = prevProposalId + 1;

    const transactions = [
      { to: testToken.options.address, value: 0, data: txnData1, operation },
      { to: testToken.options.address, value: 0, data: txnData2, operation },
      { to: testToken2.options.address, value: 0, data: txnData3, operation },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    const receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { ancillaryData } = (await findEvent(receipt, optimisticOracle, "ProposePrice")).match.returnValues;

    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

    // Advance time to one second before end of the dispute period.
    const stillOpen = liveness - 1;
    await advanceTime(stillOpen);

    // Dispute.
    await optimisticOracle.methods
      .disputePrice(optimisticOracleModule.options.address, identifier, proposalTime, ancillaryData)
      .send({ from: disputer });

    // DVM rejects the proposal.
    await pushPrice(0);

    // Proposal should not be executed.
    assert(
      await didContractThrow(
        optimisticOracleModule.methods.executeProposal(id, transactions, proposalTime).send({ from: executor })
      )
    );
  });

  it("Rejected proposals can be deleted by any address", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const prevProposalId = parseInt(await optimisticOracleModule.methods.prevProposalId().call());
    const id = prevProposalId + 1;

    const transactions = [
      { to: testToken.options.address, value: 0, data: txnData1, operation },
      { to: testToken.options.address, value: 0, data: txnData2, operation },
      { to: testToken2.options.address, value: 0, data: txnData3, operation },
    ];

    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");

    const receipt = await optimisticOracleModule.methods
      .proposeTransactions(transactions, explanation)
      .send({ from: proposer });

    const { ancillaryData } = (await findEvent(receipt, optimisticOracle, "ProposePrice")).match.returnValues;

    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

    // Advance time to one second before end of the dispute period.
    const stillOpen = liveness - 1;
    await advanceTime(stillOpen);

    // Dispute.
    await optimisticOracle.methods
      .disputePrice(optimisticOracleModule.options.address, identifier, proposalTime, ancillaryData)
      .send({ from: disputer });

    // DVM rejects the proposal.
    await pushPrice(0);

    // Proposal should not be executed.
    assert(
      await didContractThrow(
        optimisticOracleModule.methods.executeProposal(id, transactions, proposalTime).send({ from: executor })
      )
    );

    // Proposal can be deleted by any address.
    const receipt2 = await optimisticOracleModule.methods
      .deleteRejectedProposal(id, proposalTime)
      .send({ from: rando });

    await assertEventEmitted(receipt2, optimisticOracleModule, "ProposalDeleted", (event) => event.proposalId == id);
  });

  /*
   * This test is currently failing. Need to reason about how to send a transaction from the avatar
   * to the module itself, with the transaction being proposed and approved through the module.
   */
  it("Owner can delete proposals before execution", async function () {
    // Issue some test tokens to the avatar address.
    await testToken.methods.allocateTo(avatar.options.address, toWei("3")).send({ from: accounts[0] });
    await testToken2.methods.allocateTo(avatar.options.address, toWei("2")).send({ from: accounts[0] });
    // Construct the transaction data to send the newly minted tokens to proposer and another address.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(rando, toWei("2"));
    const txnData3 = constructTransferTransaction(proposer, toWei("2"));
    const operation = 0; // 0 for call, 1 for delegatecall
    // Send the proposal with multiple transactions.
    const prevProposalId = parseInt(await optimisticOracleModule.methods.prevProposalId().call());
    const proposalId = prevProposalId + 1;
    const transactions = [
      { to: testToken.options.address, value: 0, data: txnData1, operation },
      { to: testToken.options.address, value: 0, data: txnData2, operation },
      { to: testToken2.options.address, value: 0, data: txnData3, operation },
    ];
    const explanation = utf8ToHex("These transactions were approved by majority vote on Snapshot.");
    await optimisticOracleModule.methods.proposeTransactions(transactions, explanation).send({ from: proposer });
    const proposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

    // Wait until the end of the dispute period.
    await advanceTime(liveness);

    // Create new proposal to delete the old one.
    const txnData4 = constructProposalDeleteTransaction(proposalId);
    const deleteId = proposalId + 1;
    console.log("deleteId:", deleteId);
    const deleteTransaction = [{ to: optimisticOracleModule.options.address, value: 0, data: txnData4, operation }];
    const deleteExplanation = utf8ToHex("Oops, we messed up the parameters on the other proposal.");
    await optimisticOracleModule.methods
      .proposeTransactions(deleteTransaction, deleteExplanation)
      .send({ from: proposer });
    const deleteProposalTime = parseInt(await optimisticOracleModule.methods.getCurrentTime().call());

    // Wait until the end of the new dispute period.
    await advanceTime(liveness);

    // Execute the delete proposal.
    await optimisticOracleModule.methods
      .executeProposal(deleteId, deleteTransaction, deleteProposalTime)
      .send({ from: executor });

    // Original proposal can not be executed.
    assert(
      await didContractThrow(
        optimisticOracleModule.methods.executeProposal(proposalId, transactions, proposalTime).send({ from: executor })
      )
    );
  });

  it("Non-owners can not delete unexecuted proposals", async function () {});

  it("Owner can update stored contract parameters", async function () {});

  it("Non-owners can not update stored contract parameters", async function () {});
});

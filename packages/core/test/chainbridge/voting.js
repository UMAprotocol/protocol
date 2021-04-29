// TODO:
// Need to write unit tests for Beacon, Source, and Sink oracles.

// Test integrations between GenericHandler and UMA voting contracts. The purpose of this test script and the contracts
// found in the `chainbridge` directory is to make sure that the latest Voting interface is compatible with the
// chainbridge GenericHandler contract. This file contains an End-to-End test. Unit tests for BeaconOracle
// contracts will be placed in other files.
// Note: Inspired by tests from chainbridge-solidity repo's test folder:
// https://github.com/ChainSafe/chainbridge-solidity/tree/master/test/handlers/generic

const TruffleAssert = require("truffle-assertions");
const Ethers = require("ethers");

const Helpers = require("./helpers");
const { interfaceName, RegistryRolesEnum } = require("@uma/common");
const { assert } = require("chai");

// Chainbridge Contracts:
const BridgeContract = artifacts.require("Bridge");
const GenericHandlerContract = artifacts.require("GenericHandler");

// UMA DVM Contracts:
const MockOracle = artifacts.require("MockOracleAncillary");
const SinkOracle = artifacts.require("SinkOracle");
const SourceOracle = artifacts.require("SourceOracle");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const Registry = artifacts.require("Registry");

const { utf8ToHex, hexToUtf8, toWei, sha3 } = web3.utils;
const { abi } = web3.eth;

// Returns the equivalent of keccak256(abi.encode(address,uint8)) in Solidity:
const getResourceIdForBeaconOracle = (oracleAddress, chainID) => {
  const encoded = abi.encodeParameters(["address", "uint8"], [oracleAddress, chainID]);
  const hash = sha3(encoded, { encoding: "hex " });
  return hash;
};

contract("GenericHandler - [UMA Cross-chain Voting]", async accounts => {
  // # of relayers who must vote on a proposal before it can be executed.
  const relayerThreshold = 2;
  // Source chain ID.
  const chainId = 0;
  // Side chain ID.
  const sidechainId = 1;
  // We only expect to make 1 deposit per test.
  const expectedDepositNonce = 1;

  const depositerAddress = accounts[1];
  const relayer1Address = accounts[2];
  const relayer2Address = accounts[3];

  const initialRelayers = [relayer1Address, relayer2Address];

  // Chainbridge contracts:
  let bridgeMainnet;
  let bridgeSidechain;
  let genericHandlerMainnet;
  let genericHandlerSidechain;

  // DVM contracts:
  let voting;
  let sourceOracle; // Beacon oracle on Mainnet
  let sinkOracle; // Beacon oracle on Sidechain
  let identifierWhitelist;
  let sourceFinder;
  let sinkFinder;
  let registry;
  let timer;

  // Test variables
  const ancillaryData = utf8ToHex("Test Ancillary Data");
  const identifier = utf8ToHex("Test Identifier");
  const requestPrice = toWei("1");
  const requestTime = Date.now();

  // Resource ID's are unique for each contract address.
  let votingResourceId;
  let votingResourceSidechainId;

  before(async () => {
    registry = await Registry.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, depositerAddress);
    // Register EOA as a contract creator that can make price requests directly to the SinkOracle
    await registry.registerContract([], depositerAddress, { from: depositerAddress });
  });
  beforeEach(async () => {
    sourceFinder = await Finder.deployed();
    sinkFinder = await Finder.new();
    await sinkFinder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.address);
    timer = await Timer.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();

    // MockOracle is the test DVM for Mainnet.
    voting = await MockOracle.new(sourceFinder.address, timer.address);
    await sourceFinder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), voting.address);

    // Mainnet bridge variables:
    bridgeMainnet = await BridgeContract.new(chainId, initialRelayers, relayerThreshold, 0, 100);
    await sourceFinder.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridgeMainnet.address);
    sourceOracle = await SourceOracle.new(sourceFinder.address, chainId);
    votingResourceId = getResourceIdForBeaconOracle(sourceOracle.address, chainId);
    assert.equal(votingResourceId, await sourceOracle.getResourceId());

    // Sidechain bridge variables:
    bridgeSidechain = await BridgeContract.new(sidechainId, initialRelayers, relayerThreshold, 0, 100);
    await sinkFinder.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridgeSidechain.address);
    sinkOracle = await SinkOracle.new(sinkFinder.address, sidechainId, chainId);
    votingResourceSidechainId = getResourceIdForBeaconOracle(sinkOracle.address, sidechainId);
    assert.equal(votingResourceSidechainId, await sinkOracle.getResourceId());

    // Configure contracts such that price requests will succeed:
    await identifierWhitelist.addSupportedIdentifier(identifier);

    // Set up Handlers: Should specify a contract address and function to call for each resource ID.
    genericHandlerMainnet = await GenericHandlerContract.new(
      bridgeMainnet.address,
      [votingResourceId],
      [sourceOracle.address],
      [Helpers.getFunctionSignature(sourceOracle, "validateDeposit")],
      [Helpers.getFunctionSignature(sourceOracle, "requestPrice")]
    );
    await sourceFinder.changeImplementationAddress(
      utf8ToHex(interfaceName.GenericHandler),
      genericHandlerMainnet.address
    );
    genericHandlerSidechain = await GenericHandlerContract.new(
      bridgeSidechain.address,
      [votingResourceSidechainId],
      [sinkOracle.address],
      [Helpers.getFunctionSignature(sinkOracle, "validateDeposit")],
      [Helpers.getFunctionSignature(sinkOracle, "publishPrice")]
    );
    await sinkFinder.changeImplementationAddress(
      utf8ToHex(interfaceName.GenericHandler),
      genericHandlerSidechain.address
    );

    // Mainnet resource ID 1: Voting Contract
    // - Deposit: Should validate that price was resolved by DVM.
    // - ExecuteProposal: Should request price to DVM.
    await bridgeMainnet.adminSetGenericResource(
      genericHandlerMainnet.address,
      votingResourceId,
      sourceOracle.address,
      Helpers.getFunctionSignature(sourceOracle, "validateDeposit"),
      Helpers.getFunctionSignature(sourceOracle, "requestPrice")
    );
    // Sidechain resource ID 1: Voting Contract
    // - Deposit: Should validate that price was requested.
    // - ExecuteProposal: Should publish price resolved by DVM.
    await bridgeSidechain.adminSetGenericResource(
      genericHandlerSidechain.address,
      votingResourceSidechainId,
      sinkOracle.address,
      Helpers.getFunctionSignature(sinkOracle, "validateDeposit"),
      Helpers.getFunctionSignature(sinkOracle, "publishPrice")
    );
  });

  // Scenario: Sidechain contract needs a price from DVM.
  it("Sidechain deposit: requests price on sidechain and enables bridged price request to mainnet", async function() {
    // Request price triggers cross-chain deposit:
    const depositTxn = await sinkOracle.requestPrice(identifier, requestTime, ancillaryData, {
      from: depositerAddress
    });

    // Bridge emits a Deposit event and the SinkOracle emitted a PriceRequest event.
    TruffleAssert.eventEmitted(
      depositTxn,
      "PriceRequestAdded",
      event =>
        event.requester.toLowerCase() === depositerAddress.toLowerCase() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase()
    );
    const depositInternalTx = await TruffleAssert.createTransactionResult(bridgeSidechain, depositTxn.tx);
    TruffleAssert.eventEmitted(
      depositInternalTx,
      "Deposit",
      event =>
        event.destinationChainID.toString() === chainId.toString() &&
        event.resourceID.toLowerCase() === votingResourceSidechainId.toLowerCase() &&
        event.depositNonce.toString() === expectedDepositNonce.toString()
    );

    // Now, we should be able to take the metadata stored in DepositRecord and execute the proposal on the mainnet
    // Bridge.
    const depositRecord = await genericHandlerSidechain.getDepositRecord(expectedDepositNonce, chainId);
    const proposalData = Helpers.createGenericDepositData(depositRecord._metaData);
    const proposalDataHash = Ethers.utils.keccak256(genericHandlerMainnet.address + proposalData.substr(2));
    TruffleAssert.passes(
      await bridgeMainnet.voteProposal(sidechainId, expectedDepositNonce, votingResourceId, proposalDataHash, {
        from: relayer1Address
      })
    );
    TruffleAssert.passes(
      await bridgeMainnet.voteProposal(sidechainId, expectedDepositNonce, votingResourceId, proposalDataHash, {
        from: relayer2Address
      })
    );

    // This will call requestPrice on the SourceOracle, which will make a price request to the DVM.
    const executeProposalTx = await bridgeMainnet.executeProposal(
      sidechainId,
      expectedDepositNonce,
      proposalData,
      votingResourceId,
      { from: relayer1Address }
    );

    // Verifying price was requested on mainnet DVM and source oracle.
    let internalTx = await TruffleAssert.createTransactionResult(sourceOracle, executeProposalTx.tx);
    TruffleAssert.eventEmitted(
      internalTx,
      "PriceRequestAdded",
      event =>
        event.requester.toLowerCase() === genericHandlerMainnet.address.toLowerCase() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase()
    );
    internalTx = await TruffleAssert.createTransactionResult(voting, executeProposalTx.tx);
    TruffleAssert.eventEmitted(
      internalTx,
      "PriceRequestAdded",
      event =>
        event.requester.toLowerCase() === sourceOracle.address.toLowerCase() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase()
    );

    // Should now be able to publish a price to the DVM and source oracle.
    await voting.pushPrice(identifier, requestTime, ancillaryData, requestPrice);
    await sourceOracle.publishPrice(sidechainId, identifier, requestTime, ancillaryData, requestPrice, {
      from: depositerAddress
    });
  });

  // Scenario: Someone wants to publish a price from mainnet to sidechain.
  it("Mainnet deposit: publishes price on mainnet and enables bridged price resolution to sidechain", async function() {
    // Note: We need to make a price available on the DVM before we can publish a price to the SourceOracle:
    await voting.requestPrice(identifier, requestTime, ancillaryData);
    await voting.pushPrice(identifier, requestTime, ancillaryData, requestPrice);

    // Deposit will fail because price has not been requested on the SourceOracle yet, so let's manually request one:
    // Note: Only GenericHandler can call requestPrice on sourceOracle, so we temporarily give this role to an EOA.
    // In production, the price would have been requested originally from a Deposit on the sidechain Bridge.
    await sourceFinder.changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), depositerAddress);
    await sourceOracle.requestPrice(identifier, requestTime, ancillaryData, { from: depositerAddress });

    const depositTxn = await sourceOracle.publishPrice(
      sidechainId,
      identifier,
      requestTime,
      ancillaryData,
      requestPrice,
      { from: depositerAddress }
    );

    // Bridge emits a Deposit event and the SinkOracle emitted a PushedPrice event.
    TruffleAssert.eventEmitted(depositTxn, "PushedPrice", event => {
      return (
        event.pusher.toLowerCase() === depositerAddress.toLowerCase() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase() &&
        event.price.toString() === requestPrice
      );
    });
    const depositInternalTx = await TruffleAssert.createTransactionResult(bridgeMainnet, depositTxn.tx);
    TruffleAssert.eventEmitted(
      depositInternalTx,
      "Deposit",
      event =>
        event.destinationChainID.toString() === sidechainId.toString() &&
        event.resourceID.toLowerCase() === votingResourceId.toLowerCase() &&
        event.depositNonce.toString() === expectedDepositNonce.toString()
    );

    // Now, we should be able to take the metadata stored in DepositRecord and execute the proposal on the sidechain
    // Bridge.
    const depositRecord = await genericHandlerMainnet.getDepositRecord(expectedDepositNonce, sidechainId);
    const proposalData = Helpers.createGenericDepositData(depositRecord._metaData);
    const proposalDataHash = Ethers.utils.keccak256(genericHandlerSidechain.address + proposalData.substr(2));
    TruffleAssert.passes(
      await bridgeSidechain.voteProposal(chainId, expectedDepositNonce, votingResourceSidechainId, proposalDataHash, {
        from: relayer1Address
      })
    );
    TruffleAssert.passes(
      await bridgeSidechain.voteProposal(chainId, expectedDepositNonce, votingResourceSidechainId, proposalDataHash, {
        from: relayer2Address
      })
    );

    // This will call requestPrice on the SinkOracle, which will publish the price that the DVM resolved.
    // Note: This will fail unless a price has been requested on the sink oracle.
    await sinkOracle.requestPrice(identifier, requestTime, ancillaryData, { from: depositerAddress });
    const executeProposalTx = await bridgeSidechain.executeProposal(
      chainId,
      expectedDepositNonce,
      proposalData,
      votingResourceSidechainId,
      { from: relayer1Address }
    );

    // Verifying price was published on sidechain sink oracle.
    const internalTx = await TruffleAssert.createTransactionResult(sinkOracle, executeProposalTx.tx);
    TruffleAssert.eventEmitted(internalTx, "PushedPrice", event => {
      return (
        event.pusher.toLowerCase() === genericHandlerSidechain.address.toLowerCase() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase() &&
        event.price.toString() === requestPrice
      );
    });
  });
});

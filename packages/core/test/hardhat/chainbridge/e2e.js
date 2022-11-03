const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
// Test integrations between GenericHandler and UMA voting contracts. The purpose of this test script and the contracts
// found in the `chainbridge` directory is to make sure that the latest Voting interface is compatible with the
// chainbridge GenericHandler contract. This file contains an End-to-End test. Unit tests for BeaconOracle
// contracts will be placed in other files.
// Note: Inspired by tests from chainbridge-solidity repo's test folder:
// https://github.com/ChainSafe/chainbridge-solidity/tree/master/test/handlers/generic

const Ethers = require("ethers");

const Helpers = require("./helpers");
const { interfaceName, RegistryRolesEnum, ZERO_ADDRESS, didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Chainbridge Contracts:
const BridgeContract = getContract("Bridge");
const GenericHandlerContract = getContract("GenericHandler");

// UMA DVM Contracts:
const MockOracle = getContract("MockOracleAncillary");
const SinkOracle = getContract("SinkOracle");
const SourceOracle = getContract("SourceOracle");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const SourceGovernor = getContract("SourceGovernor");
const SinkGovernor = getContract("SinkGovernor");
const ERC20 = getContract("ExpandedERC20");

const { utf8ToHex, hexToUtf8, toWei, sha3 } = web3.utils;
const { abi } = web3.eth;

// Returns the equivalent of keccak256(abi.encode(address,uint8)) in Solidity:
const getResourceId = (chainID, name) => {
  const encoded = abi.encodeParameters(["string", "uint8"], [name, chainID]);
  const hash = sha3(encoded, { encoding: "hex " });
  return hash;
};

describe("GenericHandler - [UMA Cross-chain Communication]", async () => {
  // # of relayers who must vote on a proposal before it can be executed.
  const relayerThreshold = 2;
  // Source chain ID.
  const chainId = 0;
  // Side chain ID.
  const sidechainId = 1;
  // We only expect to make 1 deposit per test.
  const expectedDepositNonce = 1;

  let accounts;
  let owner;
  let depositerAddress;
  let relayer1Address;
  let relayer2Address;
  let rando;
  let initialRelayers;

  // Chainbridge contracts:
  let bridgeMainnet;
  let bridgeSidechain;
  let genericHandlerMainnet;
  let genericHandlerSidechain;

  // DVM contracts:
  let voting;
  let sourceOracle; // Beacon oracle on Mainnet
  let sinkOracle; // Beacon oracle on Sidechain
  let sourceGovernor; // Mainnet governance relayer
  let sinkGovernor; // Sidechain governance receiver
  let identifierWhitelist;
  let sourceFinder;
  let sinkFinder;
  let registry;

  // Test contract
  let erc20;

  // Test variables
  const ancillaryData = utf8ToHex("Test Ancillary Data");
  const identifier = utf8ToHex("Test Identifier");
  const requestPrice = toWei("1");
  const requestTime = Date.now();

  // Resource IDs link Sink and Source contracts and should be the same for any contracts that will communicate with each
  // other.
  let votingResourceId;
  let governanceResourceId;

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [owner, depositerAddress, relayer1Address, relayer2Address, rando] = accounts;
    initialRelayers = [relayer1Address, relayer2Address];
    await runDefaultFixture(hre);
    registry = await Registry.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, depositerAddress).send({ from: accounts[0] });
    // Register EOA as a contract creator that can make price requests directly to the SinkOracle
    await registry.methods.registerContract([], depositerAddress).send({ from: depositerAddress });
    sourceFinder = await Finder.deployed();
    sinkFinder = await Finder.new().send({ from: accounts[0] });
    await sinkFinder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address)
      .send({ from: accounts[0] });
    identifierWhitelist = await IdentifierWhitelist.deployed();
  });

  beforeEach(async () => {
    // MockOracle is the test DVM for Mainnet.
    voting = await MockOracle.new(sourceFinder.options.address, ZERO_ADDRESS).send({ from: accounts[0] });
    await sourceFinder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), voting.options.address)
      .send({ from: accounts[0] });

    // Mainnet bridge variables:
    bridgeMainnet = await BridgeContract.new(chainId, initialRelayers, relayerThreshold, 0, 100).send({
      from: accounts[0],
    });
    await sourceFinder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridgeMainnet.options.address)
      .send({ from: accounts[0] });
    sourceOracle = await SourceOracle.new(sourceFinder.options.address, chainId).send({ from: accounts[0] });
    votingResourceId = getResourceId(chainId, "Oracle");
    assert.equal(votingResourceId, await sourceOracle.methods.getResourceId().call());
    sourceGovernor = await SourceGovernor.new(sourceFinder.options.address, chainId).send({ from: accounts[0] });
    governanceResourceId = getResourceId(chainId, "Governor");

    // Sidechain bridge variables:
    bridgeSidechain = await BridgeContract.new(sidechainId, initialRelayers, relayerThreshold, 0, 100).send({
      from: accounts[0],
    });
    await sinkFinder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridgeSidechain.options.address)
      .send({ from: accounts[0] });
    sinkOracle = await SinkOracle.new(sinkFinder.options.address, sidechainId, chainId).send({ from: accounts[0] });
    assert.equal(
      votingResourceId,
      await sinkOracle.methods.getResourceId().call(),
      "Sink and Source oracles should have same resource ID"
    );
    sinkGovernor = await SinkGovernor.new(sinkFinder.options.address).send({ from: accounts[0] });

    // Configure contracts such that price requests will succeed:
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Set up Handlers.
    genericHandlerMainnet = await GenericHandlerContract.new(bridgeMainnet.options.address, [], [], [], []).send({
      from: accounts[0],
    });
    await sourceFinder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), genericHandlerMainnet.options.address)
      .send({ from: accounts[0] });
    genericHandlerSidechain = await GenericHandlerContract.new(bridgeSidechain.options.address, [], [], [], []).send({
      from: accounts[0],
    });
    await sinkFinder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), genericHandlerSidechain.options.address)
      .send({ from: accounts[0] });

    // Mainnet resource ID 1: Voting Contract
    // - Deposit: Should validate that price was resolved by DVM.
    // - ExecuteProposal: Should request price to DVM.
    await bridgeMainnet.methods
      .adminSetGenericResource(
        genericHandlerMainnet.options.address,
        votingResourceId,
        sourceOracle.options.address,
        Helpers.getFunctionSignature(SourceOracle, "validateDeposit"),
        Helpers.getFunctionSignature(SourceOracle, "executeRequestPrice")
      )
      .send({ from: accounts[0] });
    // Sidechain resource ID 1: Voting Contract
    // - Deposit: Should validate that price was requested.
    // - ExecuteProposal: Should publish price resolved by DVM.
    await bridgeSidechain.methods
      .adminSetGenericResource(
        genericHandlerSidechain.options.address,
        votingResourceId,
        sinkOracle.options.address,
        Helpers.getFunctionSignature(SinkOracle, "validateDeposit"),
        Helpers.getFunctionSignature(SinkOracle, "executePublishPrice")
      )
      .send({ from: accounts[0] });

    // Mainnet resource ID 1: SourceGovernor Contract
    // - Deposit: Should validate that the request was actually sent by the source governor.
    // - ExecuteProposal: No need for an execution proposal because it does not receive messages from L2.
    await bridgeMainnet.methods
      .adminSetGenericResource(
        genericHandlerMainnet.options.address,
        governanceResourceId,
        sourceGovernor.options.address,
        Helpers.getFunctionSignature(SourceGovernor, "verifyRequest"),
        Helpers.blankFunctionSig
      )
      .send({ from: accounts[0] });

    // Sidechain resource ID 1: SinkGovernor Contract
    // - Deposit: No need for a deposit function -- does not send cross-chain messages.
    // - ExecuteProposal: executes an incoming governance proposal.
    await bridgeSidechain.methods
      .adminSetGenericResource(
        genericHandlerSidechain.options.address,
        governanceResourceId,
        sinkGovernor.options.address,
        Helpers.blankFunctionSig,
        Helpers.getFunctionSignature(SinkGovernor, "executeGovernance")
      )
      .send({ from: accounts[0] });

    // Deploy an ERC20 so the SinkGovernor contract has something to act on.
    erc20 = await ERC20.new("Test Token", "TEST", 18).send({ from: accounts[0] });
    await erc20.methods.addMember(1, owner).send({ from: accounts[0] });
    await erc20.methods.mint(sinkGovernor.options.address, web3.utils.toWei("1")).send({ from: accounts[0] });
  });

  // Scenario: Sidechain contract needs a price from DVM.
  it("Sidechain deposit: requests price on sidechain and enables bridged price request to mainnet", async function () {
    // Request price triggers cross-chain deposit:
    const depositTxn = await sinkOracle.methods
      .requestPrice(identifier, requestTime, ancillaryData)
      .send({ from: depositerAddress });

    // Bridge emits a Deposit event and the SinkOracle emitted a PriceRequest event.
    await assertEventEmitted(
      depositTxn,
      sinkOracle,
      "PriceRequestAdded",
      (event) =>
        event.chainID.toString() === sidechainId.toString() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase()
    );

    await assertEventEmitted(
      depositTxn,
      bridgeSidechain,
      "Deposit",
      (event) =>
        event.destinationChainID.toString() === chainId.toString() &&
        event.resourceID.toLowerCase() === votingResourceId.toLowerCase() &&
        event.depositNonce.toString() === expectedDepositNonce.toString()
    );

    // Now, we should be able to take the metadata stored in DepositRecord and execute the proposal on the mainnet
    // Bridge.
    const depositRecord = await genericHandlerSidechain.methods.getDepositRecord(expectedDepositNonce, chainId).call();
    assert(
      await didContractThrow(
        bridgeSidechain.methods.deposit(chainId, votingResourceId, depositRecord._metaData).send({ from: accounts[0] })
      ),
      "Should not be able to call Bridge.deposit directly"
    );
    const proposalData = Helpers.createGenericDepositData(depositRecord._metaData);
    const proposalDataHash = Ethers.utils.keccak256(genericHandlerMainnet.options.address + proposalData.substr(2));
    await bridgeMainnet.methods
      .voteProposal(sidechainId, expectedDepositNonce, votingResourceId, proposalDataHash)
      .send({ from: relayer1Address });
    await bridgeMainnet.methods
      .voteProposal(sidechainId, expectedDepositNonce, votingResourceId, proposalDataHash)
      .send({ from: relayer2Address });

    // This will call requestPrice on the SourceOracle, which will make a price request to the DVM.
    const executeProposalTx = await bridgeMainnet.methods
      .executeProposal(sidechainId, expectedDepositNonce, proposalData, votingResourceId)
      .send({ from: relayer1Address });

    // Verifying price was requested on mainnet DVM and source oracle.
    await assertEventEmitted(
      executeProposalTx,
      sourceOracle,
      "PriceRequestAdded",
      (event) =>
        event.chainID.toString() === sidechainId.toString() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase()
    );

    await assertEventEmitted(
      executeProposalTx,
      voting,
      "PriceRequestAdded",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase()
    );

    // Should now be able to publish a price to the DVM and source oracle.
    await voting.methods.pushPrice(identifier, requestTime, ancillaryData, requestPrice).send({ from: accounts[0] });
    await sourceOracle.methods
      .publishPrice(sidechainId, identifier, requestTime, ancillaryData)
      .send({ from: depositerAddress });
  });

  // Scenario: Someone wants to publish a price from mainnet to sidechain.
  it("Mainnet deposit: publishes price on mainnet and enables bridged price resolution to sidechain", async function () {
    // Deposit will fail because price has not been requested on the SourceOracle yet, so let's manually request one:
    // Note: Only GenericHandler can call requestPrice on sourceOracle, so we temporarily give this role to an EOA.
    // In production, the price would have been requested originally from a Deposit on the sidechain Bridge.
    await sourceFinder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), depositerAddress)
      .send({ from: accounts[0] });
    await sourceOracle.methods
      .executeRequestPrice(sidechainId, identifier, requestTime, ancillaryData)
      .send({ from: depositerAddress });
    // Note: We need to make a price available on the DVM before we can publish a price to the SourceOracle:
    await voting.methods.pushPrice(identifier, requestTime, ancillaryData, requestPrice).send({ from: accounts[0] });

    const depositTxn = await sourceOracle.methods
      .publishPrice(sidechainId, identifier, requestTime, ancillaryData)
      .send({ from: depositerAddress });

    // Bridge emits a Deposit event and the SinkOracle emitted a PushedPrice event.
    await assertEventEmitted(depositTxn, sourceOracle, "PushedPrice", (event) => {
      return (
        event.chainID.toString() === sidechainId.toString() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase() &&
        event.price.toString() === requestPrice
      );
    });

    await assertEventEmitted(
      depositTxn,
      bridgeMainnet,
      "Deposit",
      (event) =>
        event.destinationChainID.toString() === sidechainId.toString() &&
        event.resourceID.toLowerCase() === votingResourceId.toLowerCase() &&
        event.depositNonce.toString() === expectedDepositNonce.toString()
    );

    // Now, we should be able to take the metadata stored in DepositRecord and execute the proposal on the sidechain
    // Bridge.
    const depositRecord = await genericHandlerMainnet.methods
      .getDepositRecord(expectedDepositNonce, sidechainId)
      .call();
    assert(
      await didContractThrow(
        bridgeMainnet.methods
          .deposit(sidechainId, votingResourceId, depositRecord._metaData)
          .send({ from: accounts[0] })
      ),
      "Should not be able to call Bridge.deposit directly"
    );
    const proposalData = Helpers.createGenericDepositData(depositRecord._metaData);
    const proposalDataHash = Ethers.utils.keccak256(genericHandlerSidechain.options.address + proposalData.substr(2));
    await bridgeSidechain.methods
      .voteProposal(chainId, expectedDepositNonce, votingResourceId, proposalDataHash)
      .send({ from: relayer1Address });
    await bridgeSidechain.methods
      .voteProposal(chainId, expectedDepositNonce, votingResourceId, proposalDataHash)
      .send({ from: relayer2Address });

    // This will call requestPrice on the SinkOracle, which will publish the price that the DVM resolved.
    // Note: This will fail unless a price has been requested on the sink oracle.
    await sinkOracle.methods.requestPrice(identifier, requestTime, ancillaryData).send({ from: depositerAddress });
    const executeProposalTx = await bridgeSidechain.methods
      .executeProposal(chainId, expectedDepositNonce, proposalData, votingResourceId)
      .send({ from: relayer1Address });

    // Verifying price was published on sidechain sink oracle.
    await assertEventEmitted(executeProposalTx, sinkOracle, "PushedPrice", (event) => {
      return (
        event.chainID.toString() === sidechainId.toString() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase() &&
        event.price.toString() === requestPrice
      );
    });
  });

  // Scenario: someone wants to send a governance proposal from mainnet to the sidechain.
  it("Mainnet deposit: Governance transaction sent to sidechain", async function () {
    await sinkFinder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), genericHandlerSidechain.options.address)
      .send({ from: accounts[0] });
    await sourceFinder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), genericHandlerMainnet.options.address)
      .send({ from: accounts[0] });

    const innerTransactionCalldata = erc20.methods.transfer(rando, web3.utils.toWei("1")).encodeABI();

    await sourceGovernor.methods
      .relayGovernance(sidechainId, erc20.options.address, innerTransactionCalldata)
      .send({ from: owner });

    const { _resourceID, _metaData } = await genericHandlerMainnet.methods
      ._depositRecords(sidechainId, expectedDepositNonce)
      .call();

    const data = Helpers.createGenericDepositData(_metaData);

    const dataHash = web3.utils.soliditySha3(
      { t: "address", v: genericHandlerSidechain.options.address },
      { t: "bytes", v: data }
    );

    await bridgeSidechain.methods
      .voteProposal(chainId, expectedDepositNonce, _resourceID, dataHash)
      .send({ from: relayer1Address });
    await bridgeSidechain.methods
      .voteProposal(chainId, expectedDepositNonce, _resourceID, dataHash)
      .send({ from: relayer2Address });
    await bridgeSidechain.methods
      .executeProposal(chainId, expectedDepositNonce, data, _resourceID)
      .send({ from: relayer1Address });

    assert.equal((await erc20.methods.balanceOf(rando).call()).toString(), web3.utils.toWei("1"));
    assert.equal((await erc20.methods.balanceOf(sinkGovernor.options.address).call()).toString(), "0");
  });
});

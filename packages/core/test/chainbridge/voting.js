// Test integrations between GenericHandler and UMA voting contracts.
// Inspired by tests from chainbridge-solidity repo's test folder:
// https://github.com/ChainSafe/chainbridge-solidity/tree/master/test/handlers/generic

const TruffleAssert = require("truffle-assertions");
const Ethers = require("ethers");

const Helpers = require("./helpers");
const { didContractThrow } = require("@uma/common");

// Chainbridge Contracts:
const BridgeContract = artifacts.require("Bridge");
const GenericHandlerContract = artifacts.require("GenericHandler");

// UMA DVM Contracts:
const MockOracle = artifacts.require("MockOracleAncillary");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");

const { utf8ToHex, padRight, hexToUtf8, toWei } = web3.utils;

contract("GenericHandler - [UMA Cross-chain Voting]", async accounts => {
  const relayerThreshold = 2;
  const chainId = 1;
  const sidechainId = 2;
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
  let votingSidechain;
  let identifierWhitelist;
  let finder;
  let timer;

  // Test variables
  const ancillaryData = utf8ToHex("Test Ancillary Data");
  const identifier = utf8ToHex("Test Identifier");
  const requestPrice = toWei("1");
  const requestTime = Date.now();

  // These are the functions that the GenericHandler will be calling.
  let votingPushPriceFuncSig;
  let votingRequestPriceFuncSig;

  // Resource ID's are unique for each contract address.
  let votingResourceId;
  let votingResourceSidechainId;

  beforeEach(async () => {
    // Duplicate contracts on both chain (represented for convenience in this test as a singleton contract).
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();

    // Mainnet bridge variables:
    bridgeMainnet = await BridgeContract.new(chainId, initialRelayers, relayerThreshold, 0, 100);
    voting = await MockOracle.new(finder.address, timer.address);
    votingResourceId = Helpers.createResourceID(voting.address, chainId);
    votingRequestPriceFuncSig = Helpers.getFunctionSignature(voting, "requestPrice");

    // Sidechain bridge variables:
    bridgeSidechain = await BridgeContract.new(sidechainId, initialRelayers, relayerThreshold, 0, 100);
    votingSidechain = await MockOracle.new(finder.address, timer.address);
    votingResourceSidechainId = Helpers.createResourceID(votingSidechain.address, sidechainId);
    votingPushPriceFuncSig = Helpers.getFunctionSignature(votingSidechain, "pushPrice");

    // Configure contracts such that price requests will succeed:
    await identifierWhitelist.addSupportedIdentifier(identifier);

    // Set up Handlers: Should specify a contract address and function to call for each resource ID.
    genericHandlerMainnet = await GenericHandlerContract.new(
      bridgeMainnet.address,
      [votingResourceId],
      [voting.address],
      [Helpers.blankFunctionSig],
      [votingRequestPriceFuncSig]
    );
    genericHandlerSidechain = await GenericHandlerContract.new(
      bridgeSidechain.address,
      [votingResourceSidechainId],
      [votingSidechain.address],
      [Helpers.blankFunctionSig],
      [votingPushPriceFuncSig]
    );

    // Sidechain resource ID 1: Voting Contract
    // - Deposit: null
    // - ExecuteProposal: Should push price.
    await bridgeSidechain.adminSetGenericResource(
      genericHandlerSidechain.address,
      votingResourceSidechainId,
      votingSidechain.address,
      Helpers.blankFunctionSig,
      votingPushPriceFuncSig
    );
    // Mainnet resource ID 1: Voting Contract
    // - Deposit: null.
    // - ExecuteProposal: Should request price.
    await bridgeMainnet.adminSetGenericResource(
      genericHandlerMainnet.address,
      votingResourceId,
      voting.address,
      Helpers.blankFunctionSig,
      votingRequestPriceFuncSig
    );
  });

  // Scenario: Sidechain contract needs a price from the sidechain oracle.
  it("Sidechain deposit: emits Deposit event", async function() {
    const depositData = Helpers.createGenericDepositData(null);
    const depositTxn = await bridgeSidechain.deposit(sidechainId, votingResourceSidechainId, depositData, {
      from: depositerAddress
    });

    // Bridge emits a Deposit event.
    TruffleAssert.eventEmitted(
      depositTxn,
      "Deposit",
      event =>
        event.destinationChainID.toString() === sidechainId.toString() &&
        event.resourceID.toLowerCase() === votingResourceSidechainId.toLowerCase() &&
        event.depositNonce.toString() === expectedDepositNonce.toString()
    );
  });

  // Scenario: Off-chain relayer sees that sidechain Bridge emitted a Deposit event, relayer should now
  // vote to execute a proposal on the mainnet Bridge, which should ultimately make a price request to the Mainnet
  // oracle.
  it("Mainnet executeProposal: Handler should call Voting.requestPrice", async function() {
    // Note: Deposit proposal data is needed to call requestPrice() on the Voting mainnet contract.
    const encodedMetaDataProposal = Helpers.abiEncode(
      ["bytes32", "uint256", "bytes"],
      [padRight(identifier, 64), requestTime, ancillaryData]
    );
    const proposalData = Helpers.createGenericDepositData(encodedMetaDataProposal);
    // Datahash must be the hash of (handlerAddress, proposalData)
    let proposalDataHash = Ethers.utils.keccak256(genericHandlerMainnet.address + proposalData.substr(2));
    TruffleAssert.passes(
      await bridgeMainnet.voteProposal(chainId, expectedDepositNonce, votingResourceId, proposalDataHash, {
        from: relayer1Address
      })
    );

    // relayer2 votes in favor of the deposit proposal because the relayerThreshold is 2, the deposit proposal will
    // go into a finalized state
    TruffleAssert.passes(
      await bridgeMainnet.voteProposal(chainId, expectedDepositNonce, votingResourceId, proposalDataHash, {
        from: relayer2Address
      })
    );

    // relayer1 will execute the deposit proposal
    const executeProposalTx = await bridgeMainnet.executeProposal(
      chainId,
      expectedDepositNonce,
      proposalData,
      votingResourceId,
      {
        from: relayer2Address
      }
    );
    // Verifying price was requested on Voting
    const internalTx = await TruffleAssert.createTransactionResult(voting, executeProposalTx.tx);
    TruffleAssert.eventEmitted(
      internalTx,
      "PriceRequestAdded",
      event =>
        event.requester.toLowerCase() === genericHandlerMainnet.address.toLowerCase() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase()
    );
  });

  // Scenario: Someone wants to make a price available from mainnet to sidechain.
  it("Mainnet deposit: emits Deposit event", async function() {
    const depositData = Helpers.createGenericDepositData(null);
    const depositTxn = await bridgeMainnet.deposit(chainId, votingResourceId, depositData, {
      from: depositerAddress
    });

    // Bridge emits a Deposit event.
    TruffleAssert.eventEmitted(
      depositTxn,
      "Deposit",
      event =>
        event.destinationChainID.toString() === chainId.toString() &&
        event.resourceID.toLowerCase() === votingResourceId.toLowerCase() &&
        event.depositNonce.toString() === expectedDepositNonce.toString()
    );
  });

  // Scenario: Off-chain relayer sees that mainnet Bridge emitted a Deposit event, relayer should now
  // vote to execute a proposal on the sidechain Bridge, which should ultimately push a price to the Voting contract.
  it("Sidechain execute proposal: Should push price to Voting", async function() {
    // Note: Deposit proposal data is needed to call pushPrice() on the Voting sidechain contract.
    const encodedMetaDataProposal = Helpers.abiEncode(
      ["bytes32", "uint256", "bytes", "uint256"],
      [padRight(identifier, 64), requestTime, ancillaryData, requestPrice]
    );
    const proposalData = Helpers.createGenericDepositData(encodedMetaDataProposal);
    // Datahash must be the hash of (handlerAddress, proposalData)
    let proposalDataHash = Ethers.utils.keccak256(genericHandlerSidechain.address + proposalData.substr(2));
    TruffleAssert.passes(
      await bridgeSidechain.voteProposal(
        sidechainId,
        expectedDepositNonce,
        votingResourceSidechainId,
        proposalDataHash,
        {
          from: relayer1Address
        }
      )
    );

    // relayer2 votes in favor of the deposit proposal because the relayerThreshold is 2, the deposit proposal will
    // go into a finalized state
    TruffleAssert.passes(
      await bridgeSidechain.voteProposal(
        sidechainId,
        expectedDepositNonce,
        votingResourceSidechainId,
        proposalDataHash,
        {
          from: relayer2Address
        }
      )
    );

    // relayer1 will execute the deposit proposal. Note: the internal pushPrice() method will revert unless
    // requestPrice() has been called first. We may want to remove this requirement from the bridged Voting
    // contract in case we want to push unrequested prices.
    assert(
      await didContractThrow(
        bridgeSidechain.executeProposal(sidechainId, expectedDepositNonce, proposalData, votingResourceSidechainId, {
          from: relayer2Address
        })
      )
    );
    await votingSidechain.requestPrice(identifier, requestTime, ancillaryData);
    const executeProposalTx = await bridgeSidechain.executeProposal(
      sidechainId,
      expectedDepositNonce,
      proposalData,
      votingResourceSidechainId,
      {
        from: relayer2Address
      }
    );
    // Verifying price was pushed on Voting
    const internalTx = await TruffleAssert.createTransactionResult(votingSidechain, executeProposalTx.tx);
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

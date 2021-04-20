// Test integrations between GenericHandler and UMA voting contracts.
// Inspired by tests from chainbridge-solidity repo's test folder:
// https://github.com/ChainSafe/chainbridge-solidity/tree/master/test/handlers/generic

const TruffleAssert = require("truffle-assertions");
const Ethers = require("ethers");

const Helpers = require("./helpers");
const { interfaceName } = require("@uma/common");

// Chainbridge Contracts:
const BridgeContract = artifacts.require("Bridge");
const GenericHandlerContract = artifacts.require("GenericHandler");

// UMA DVM Contracts:
const MockOracle = artifacts.require("MockOracleAncillary");
const OptimisticOracle = artifacts.require("OptimisticOracle");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const Token = artifacts.require("ExpandedERC20");
const CollateralWhitelist = artifacts.require("AddressWhitelist");

const { utf8ToHex, padRight, hexToUtf8 } = web3.utils;

contract("GenericHandler - [UMA Cross-chain Voting]", async accounts => {
  const relayerThreshold = 2;
  const chainId = 1;
  const sidechainId = 2;
  const expectedDepositNonce = 1;

  const identifier = utf8ToHex("Test Identifier");

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
  let optimisticOracle;
  let identifierWhitelist;
  let finder;
  let timer;
  let collateralToken;
  let collateralWhitelist;

  // Test variables
  let requestTime; // Time that will be used as the price request timestamp
  let ancillaryData;

  // These are the functions that the GenericHandler will be calling.
  let votingGetPriceFuncSig;
  let votingPushPriceFuncSig;
  let votingRequestPriceFuncSig;
  let optimisticOracleRequestPriceFuncSig;

  // Resource ID's are unique for each contract address.
  let votingResourceId;
  let votingResourceSidechainId;
  let optimisticOracleResourceId;

  beforeEach(async () => {
    // Duplicate contracts on both chain (represented for convenience in this test as a singleton contract).
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    collateralWhitelist = await CollateralWhitelist.deployed();
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18);

    // Mainnet bridge variables:
    bridgeMainnet = await BridgeContract.new(chainId, initialRelayers, relayerThreshold, 0, 100);
    voting = await MockOracle.new(finder.address, timer.address);
    votingResourceId = Helpers.createResourceID(voting.address, chainId);
    votingGetPriceFuncSig = Helpers.getFunctionSignature(voting, "getPrice");
    optimisticOracle = await OptimisticOracle.new(7200, finder.address, timer.address);
    optimisticOracleRequestPriceFuncSig = Helpers.getFunctionSignature(optimisticOracle, "requestPrice");
    optimisticOracleResourceId = Helpers.createResourceID(optimisticOracle.address, chainId);

    // Sidechain bridge variables:
    bridgeSidechain = await BridgeContract.new(sidechainId, initialRelayers, relayerThreshold, 0, 100);
    votingSidechain = await MockOracle.new(finder.address, timer.address);
    votingResourceSidechainId = Helpers.createResourceID(votingSidechain.address, sidechainId);
    votingPushPriceFuncSig = Helpers.getFunctionSignature(votingSidechain, "pushPrice");
    votingRequestPriceFuncSig = Helpers.getFunctionSignature(votingSidechain, "requestPrice");

    // Configure contracts such that price requests will succeed:
    await identifierWhitelist.addSupportedIdentifier(identifier);
    await collateralWhitelist.addToWhitelist(collateralToken.address);
    // Note: Need to point Finder to Voting for any network that the OptimisticOracle runs on.
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), voting.address);
    requestTime = (await optimisticOracle.getCurrentTime()).toNumber() - 10;
    ancillaryData = collateralToken.address;

    // Set up Handlers: Should specify a contract address and function to call for each resource ID:
    // - Mainnet handler maps functions to Voting and OptimisticOracle contracts.
    // - Sidechain handler maps functions to Voting contract.
    genericHandlerMainnet = await GenericHandlerContract.new(
      bridgeMainnet.address,
      [votingResourceId, optimisticOracleResourceId],
      [voting.address, optimisticOracle.address],
      [votingGetPriceFuncSig, Helpers.blankFunctionSig],
      [Helpers.blankFunctionSig, optimisticOracleRequestPriceFuncSig]
    );
    genericHandlerSidechain = await GenericHandlerContract.new(
      bridgeSidechain.address,
      [votingResourceSidechainId],
      [votingSidechain.address],
      [votingRequestPriceFuncSig],
      [votingPushPriceFuncSig]
    );

    // Sidechain resource ID 1: Voting Contract
    // - Deposit: Should check if requestPrice() reverts.
    // - ExecuteProposal: Should push price.
    await bridgeSidechain.adminSetGenericResource(
      genericHandlerSidechain.address,
      votingResourceSidechainId,
      votingSidechain.address,
      // Note: Its conceivable that we don't even need to call `requestPrice` on the Voting contract for the sidechain
      // deposit. Instead, we can just treat the sidechain's `deposit` method as a way to trigger the off-chain
      // relayer to begin the process of requesting a price from the Mainnet Voting contract.
      votingRequestPriceFuncSig,
      votingPushPriceFuncSig
    );
    // Mainnet resource ID 1: Optimistic Oracle Contract
    // - Deposit: null
    // - ExecuteProposal: Should requestPrice() to OptimisticOracle contract.
    await bridgeMainnet.adminSetGenericResource(
      genericHandlerMainnet.address,
      optimisticOracleResourceId,
      optimisticOracle.address,
      Helpers.blankFunctionSig,
      optimisticOracleRequestPriceFuncSig
    );
    // Mainnet resource ID 2: Voting Contract
    // - Deposit: Should check if getPrice() reverts.
    // - ExecuteProposal: null
    await bridgeMainnet.adminSetGenericResource(
      genericHandlerMainnet.address,
      votingResourceId,
      voting.address,
      votingGetPriceFuncSig,
      Helpers.blankFunctionSig
    );
  });

  // Scenario: Sidechain contract needs a price from the sidechain oracle:
  it("Sidechain deposit: Handler should check if Voting.requestPrice reverts", async function() {
    // Deposit succeeds on Sidechain, meaning that the identifier is whitelisted.
    // Note: Deposit data is needed to call requestPrice() on the Voting contract.
    const encodedMetaDataDeposit = Helpers.abiEncode(
      ["bytes32", "uint256", "bytes"],
      [padRight(identifier, 64), requestTime, ancillaryData]
    );
    const depositData = Helpers.createGenericDepositData(encodedMetaDataDeposit);
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

    // Handler on sidechain correctly requested a price to the Voting contract.
    const internalDepositTx = await TruffleAssert.createTransactionResult(votingSidechain, depositTxn.tx);
    TruffleAssert.eventEmitted(
      internalDepositTx,
      "PriceRequestAdded",
      event =>
        event.roundId.toString() === requestTime.toString() &&
        // MockOracle emits this event with roundId arbitrarily = time
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.time.toString() === requestTime.toString()
    );
  });

  // Scenario: Off-chain relayer sees that sidechain Bridge emitted a Deposit event, relayer should now
  // vote to execute a proposal on the mainnet Bridge, which should ultimately make a price request to the Optimistic
  // Oracle.
  it("Mainnet executeProposal: Handler should call OptimisticOracle.requestPrice", async function() {
    // Note: Deposit proposal data is needed to call requestPrice() on the OptimisticOracle mainnet contract.
    const encodedMetaDataProposal = Helpers.abiEncode(
      ["bytes32", "uint256", "bytes", "address", "uint256"],
      [padRight(identifier, 64), requestTime, ancillaryData, collateralToken.address, 0]
    );
    const proposalData = Helpers.createGenericDepositData(encodedMetaDataProposal);
    // Datahash must be the hash of (handlerAddress, proposalData)
    let proposalDataHash = Ethers.utils.keccak256(genericHandlerMainnet.address + proposalData.substr(2));
    TruffleAssert.passes(
      await bridgeMainnet.voteProposal(chainId, expectedDepositNonce, optimisticOracleResourceId, proposalDataHash, {
        from: relayer1Address
      })
    );

    // relayer2 votes in favor of the deposit proposal because the relayerThreshold is 2, the deposit proposal will
    // go into a finalized state
    TruffleAssert.passes(
      await bridgeMainnet.voteProposal(chainId, expectedDepositNonce, optimisticOracleResourceId, proposalDataHash, {
        from: relayer2Address
      })
    );

    // relayer1 will execute the deposit proposal
    const executeProposalTx = await bridgeMainnet.executeProposal(
      chainId,
      expectedDepositNonce,
      proposalData,
      optimisticOracleResourceId,
      {
        from: relayer2Address
      }
    );
    // Verifying price was requested on OptimisticOracle
    const internalTx = await TruffleAssert.createTransactionResult(optimisticOracle, executeProposalTx.tx);
    TruffleAssert.eventEmitted(internalTx, "RequestPrice", event => {
      return (
        event.requester.toLowerCase() === genericHandlerMainnet.address.toLowerCase() &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.timestamp.toString() === requestTime.toString() &&
        event.ancillaryData.toLowerCase() === ancillaryData.toLowerCase() &&
        event.currency.toLowerCase() === collateralToken.address.toLowerCase() &&
        event.reward.toString() === "0" &&
        event.finalFee.toString() === "0"
      );
    });
  });

  // Scenario: Someone wants to make a price available from mainnet to sidechain.
  it("Mainnet deposit: Should check if getPrice() reverts on Voting", async function() {
    // TODO:
  });

  // Scenario: Off-chain relayer sees that mainnet Bridge emitted a Deposit event, relayer should now
  // vote to execute a proposal on the sidechain Bridge, which should ultimately push a price to the Voting contract.
  it("Sidechain execute proposal: Should push price to Voting", async function() {
    // TODO:
  });
});

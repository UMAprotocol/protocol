const hre = require("hardhat");
const { web3 } = hre;
const { toWei, utf8ToHex, padRight } = web3.utils;
const { getContract } = hre;
const { assert } = require("chai");

const { ZERO_ADDRESS, didContractThrow, interfaceName } = require("@uma/common");

const { deployContractMock } = require("../../helpers/SmockitHelper");

// Tested Contract
const Optimism_ParentMessenger = getContract("Optimism_ParentMessenger");

// Other helper contracts
const OVM_L1CrossDomainMessengerMock = getContract("OVM_L1CrossDomainMessengerMock");
const OracleHubMock = getContract("OracleHubMock");
const GovernorHubMock = getContract("GovernorHubMock");
const ChildMessengerInterface = getContract("ChildMessengerInterface");
const Finder = getContract("Finder");

// Create some random accounts to to mimic key cross-chain oracle addresses.
const childMessengerAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const oracleSpokeAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const governorSpokeAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const l2FinderAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

const chainId = 42069;
const priceIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const ancillaryData = utf8ToHex("some-address-field:0x1234");
console.log({ priceIdentifier });
console.log({ ancillaryData });

describe("Optimism_ParentMessenger", function () {
  let optimism_ParentMessenger;
  let l1Owner;
  let controlledEOA;
  let rando;
  let oracleHub;
  let governorHub;
  let l1CrossDomainMessengerMock;

  beforeEach(async () => {
    const accounts = await hre.web3.eth.getAccounts();
    [l1Owner, controlledEOA, rando] = accounts;

    l1CrossDomainMessengerMock = await deployContractMock(
      "OVM_L1CrossDomainMessengerMock",
      {},
      OVM_L1CrossDomainMessengerMock
    );
    optimism_ParentMessenger = await Optimism_ParentMessenger.new(
      l1CrossDomainMessengerMock.options.address,
      chainId
    ).send({ from: l1Owner });

    oracleHub = await OracleHubMock.new().send({ from: l1Owner });
    await oracleHub.methods.setMessenger(optimism_ParentMessenger.options.address).send({ from: l1Owner });

    governorHub = await GovernorHubMock.new().send({ from: l1Owner });
    await governorHub.methods.setMessenger(optimism_ParentMessenger.options.address).send({ from: l1Owner });

    await optimism_ParentMessenger.methods.setChildMessenger(childMessengerAddress).send({ from: l1Owner });
    await optimism_ParentMessenger.methods.setOracleHub(oracleHub.options.address).send({ from: l1Owner });
    await optimism_ParentMessenger.methods.setGovernorHub(governorHub.options.address).send({ from: l1Owner });
    await optimism_ParentMessenger.methods.setOracleSpoke(oracleSpokeAddress).send({ from: l1Owner });
    await optimism_ParentMessenger.methods.setGovernorSpoke(governorSpokeAddress).send({ from: l1Owner });
  });
  describe("Sending messages to child on L2", () => {
    it("Blocks calls from non privileged callers", async () => {
      const relayMessageTxn = optimism_ParentMessenger.methods.sendMessageToChild("0x123");
      assert(await didContractThrow(relayMessageTxn.send({ from: rando })));

      await optimism_ParentMessenger.methods.setGovernorHub(controlledEOA).send({ from: l1Owner });
      assert.ok(await relayMessageTxn.send({ from: controlledEOA }));

      await optimism_ParentMessenger.methods.setOracleHub(controlledEOA).send({ from: l1Owner });
      assert.ok(await relayMessageTxn.send({ from: controlledEOA }));
    });
    it("Can correctly send messages to L2 child from Oracle Hub", async () => {
      // The oracle hub is used to push prices to the oracle Spoke. We can create a fake price, set it in the mock
      // oracle hub and then try send it to the oracle spoke via the publish price method. To validate the correctness
      // of this action we can check what data is sent to the l1CrossDomainMessengerMock, which passes messages between
      // L1 and L2.
      const pushedPrice = toWei("1234");
      const priceTime = 1234;
      await oracleHub.methods.setPrice(pushedPrice).send({ from: l1Owner });
      await await oracleHub.methods
        .publishPrice(chainId, priceIdentifier, priceTime, ancillaryData)
        .send({ from: l1Owner });

      // Validate that the l1CrossDomainMessengerMock received the expected cross-domain message, destine for the child.
      const publishPriceMessage = l1CrossDomainMessengerMock.smocked.sendMessage.calls;

      assert.equal(publishPriceMessage.length, 1); // there should be only one call to sendMessage.
      assert.equal(publishPriceMessage[0]._target, childMessengerAddress); // Target should be the child messenger.

      // Grab the data emitted from the mock Oracle hub. This contains the dataSentToChild.
      const emittedData = await oracleHub.getPastEvents("PricePublished", { fromBlock: 0, toBlock: "latest" });
      const targetDataSentFromOracleHub = emittedData[0].returnValues.dataSentToChild;

      // Generate the target message data that should have been forwarded to the Child messenger interface from the
      // Optimism Parent messenger within the sendMessageToChild function call.
      const childMessengerInterface = await ChildMessengerInterface.at(ZERO_ADDRESS);
      const expectedMessageFromEvent = await childMessengerInterface.methods
        .processMessageFromParent(targetDataSentFromOracleHub, oracleSpokeAddress) // note the oracleSpokeAddress for the target in the message
        .encodeABI();

      assert.equal(publishPriceMessage[0]._message, expectedMessageFromEvent);

      // Equally, we should be able to re-construct this same data without fetching events from the mock.
      const encodedData = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes", "int256"],
        [priceIdentifier, priceTime, ancillaryData, pushedPrice]
      );
      const expectedMessageFromManualEncoding = await await childMessengerInterface.methods
        .processMessageFromParent(encodedData, oracleSpokeAddress)
        .encodeABI();
      assert.equal(publishPriceMessage[0]._message, expectedMessageFromManualEncoding);
    });

    it("Can correctly send messages to L2 child from Oracle Hub", async () => {
      // The oracle hub is used to push prices to the oracle Spoke. We can create a fake price, set it in the mock
      // oracle hub and then try send it to the oracle spoke via the publish price method. To validate the correctness
      // of this action we can check what data is sent to the l1CrossDomainMessengerMock, which passes messages between
      // L1 and L2.
      const pushedPrice = toWei("1234");
      const priceTime = 1234;
      await oracleHub.methods.setPrice(pushedPrice).send({ from: l1Owner });
      await await oracleHub.methods
        .publishPrice(chainId, priceIdentifier, priceTime, ancillaryData)
        .send({ from: l1Owner });

      // Validate that the l1CrossDomainMessengerMock received the expected cross-domain message, destine for the child.
      const publishPriceMessage = l1CrossDomainMessengerMock.smocked.sendMessage.calls;

      assert.equal(publishPriceMessage.length, 1); // there should be only one call to sendMessage.
      assert.equal(publishPriceMessage[0]._target, childMessengerAddress); // Target should be the child messenger.

      // Grab the data emitted from the mock Oracle hub. This contains the dataSentToChild.
      const emittedData = await oracleHub.getPastEvents("PricePublished", { fromBlock: 0, toBlock: "latest" });
      const targetDataSentFromOracleHub = emittedData[0].returnValues.dataSentToChild;

      // Generate the target message data that should have been forwarded to the Child messenger interface from the
      // Optimism Parent messenger within the sendMessageToChild function call.
      const childMessengerInterface = await ChildMessengerInterface.at(ZERO_ADDRESS);
      const expectedMessageFromEvent = await childMessengerInterface.methods
        .processMessageFromParent(targetDataSentFromOracleHub, oracleSpokeAddress) // note the oracleSpokeAddress for the target in the message
        .encodeABI();

      assert.equal(publishPriceMessage[0]._message, expectedMessageFromEvent);

      // Equally, we should be able to re-construct this same data without fetching events from the mock.
      const encodedData = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes", "int256"],
        [priceIdentifier, priceTime, ancillaryData, pushedPrice]
      );
      const expectedMessageFromManualEncoding = await childMessengerInterface.methods
        .processMessageFromParent(encodedData, oracleSpokeAddress)
        .encodeABI();
      assert.equal(publishPriceMessage[0]._message, expectedMessageFromManualEncoding);
    });

    it("Can correctly send messages to L2 child from Governor Hub", async () => {
      // The governor hub is used to send governance actions from L1 to L2. For example, adding/modifying the addresses
      // in the whitelist. We can create a fake governance action, set it in the mock governor hub and then try send it
      // to the governor spoke via the publish governance action method.
      const sampleGovernanceAction = (await Finder.at(ZERO_ADDRESS)).methods
        .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), l1Owner)
        .encodeABI();

      await governorHub.methods
        .relayGovernance(chainId, l2FinderAddress, sampleGovernanceAction)
        .send({ from: l1Owner });

      // Validate that the l1CrossDomainMessengerMock received the expected cross-domain message, destine for the child.
      const publishPriceMessage = l1CrossDomainMessengerMock.smocked.sendMessage.calls;

      assert.equal(publishPriceMessage.length, 1); // there should be only one call to sendMessage.
      assert.equal(publishPriceMessage[0]._target, childMessengerAddress); // Target should be the child messenger.

      // Grab the data emitted from the mock Oracle hub. This contains the dataSentToChild.
      const emittedData = await governorHub.getPastEvents("RelayedGovernanceRequest", {
        fromBlock: 0,
        toBlock: "latest",
      });

      const targetDataSentFromGovernorHub = emittedData[0].returnValues.dataSentToChild;
      console.log({ targetDataSentFromGovernorHub });

      // Generate the target message data that should have been forwarded to the Child messenger interface from the
      // Optimism Parent messenger within the sendMessageToChild function call.
      const childMessengerInterface = await ChildMessengerInterface.at(ZERO_ADDRESS);
      const expectedMessageFromEvent = childMessengerInterface.methods
        .processMessageFromParent(targetDataSentFromGovernorHub, governorSpokeAddress) // note the oracleSpokeAddress for the target in the message
        .encodeABI();

      assert.equal(publishPriceMessage[0]._message, expectedMessageFromEvent);

      // Equally, we should be able to re-construct this same data without fetching events from the mock.
      const encodedData = web3.eth.abi.encodeParameters(
        ["address", "bytes"],
        [l2FinderAddress, sampleGovernanceAction]
      );
      const expectedMessageFromManualEncoding = childMessengerInterface.methods
        .processMessageFromParent(encodedData, governorSpokeAddress)
        .encodeABI();
      assert.equal(publishPriceMessage[0]._message, expectedMessageFromManualEncoding);
    });
  });
});

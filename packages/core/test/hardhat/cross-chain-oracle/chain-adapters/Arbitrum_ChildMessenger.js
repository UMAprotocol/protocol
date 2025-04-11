const hre = require("hardhat");
const { web3, assertEventEmitted } = hre;
const { toWei, utf8ToHex, padRight, toBN } = web3.utils;
const { getContract } = hre;
const { assert, expect } = require("chai");

const { ZERO_ADDRESS, interfaceName, RegistryRolesEnum, didContractThrow } = require("@uma/common");

const { deployContractMock } = require("../../helpers/SmockitHelper");

// Tested Contract
const Arbitrum_ChildMessenger = getContract("Arbitrum_ChildMessenger");
const Arbitrum_ParentMessenger = getContract("Arbitrum_ParentMessenger");

// Helper contracts
const OracleSpoke = getContract("OracleSpoke");
const Finder = getContract("Finder");
const Registry = getContract("Registry");

const priceIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const ancillaryData = utf8ToHex("some-address-field:0x1234");
const defaultTimestamp = 100;

// Helper methods that we will use to call cross-domain permissioned methods on the Messenger. These are neccesary
// because addresses are aliased in any contract that extends AVM_CrossDomainEnabled
function applyL1ToL2Alias(l1Address) {
  const offset = toBN("0x1111000000000000000000000000000000001111");
  const l1AddressAsNumber = toBN(l1Address);

  const l2AddressAsNumber = l1AddressAsNumber.add(offset);

  const mask = toBN("2").pow(toBN("160"));
  return "0x" + l2AddressAsNumber.mod(mask).toString(16); // convert back to hex string so that we return an address.
}

// Unlock alias `l1Signer` account that we can send transactions from.
async function getL2SignerFromL1(l1Signer) {
  const l2Address = applyL1ToL2Alias(l1Signer);

  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [l2Address] });

  return l2Address;
}

describe("Arbitrum_ChildMessenger", function () {
  let arbitrum_ChildMessenger, finder, oracleSpoke, arbsys, crossDomainOwner;
  let l1Owner, parentMessenger, controlledEOA, rando;

  beforeEach(async () => {
    const accounts = await hre.web3.eth.getAccounts();
    [l1Owner, controlledEOA, parentMessenger, rando] = accounts;

    arbsys = await deployContractMock(
      "ArbSys",
      { address: "0x0000000000000000000000000000000000000064" },
      getContract("ArbSys")
    );
    arbsys.sendTxToL1.returns(() => "9");

    arbitrum_ChildMessenger = await Arbitrum_ChildMessenger.new(parentMessenger).send({ from: l1Owner });

    // Deploy a finder & Registry. Add Registry to the Finder. add the controlledEOA to be registered.
    finder = await Finder.new().send({ from: l1Owner });

    const registry = await Registry.new().send({ from: l1Owner });
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, l1Owner).send({ from: l1Owner });
    await registry.methods.registerContract([], controlledEOA).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address)
      .send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.ChildMessenger), arbitrum_ChildMessenger.options.address)
      .send({ from: l1Owner });

    oracleSpoke = await OracleSpoke.new(finder.options.address).send({ from: l1Owner });

    crossDomainOwner = await getL2SignerFromL1(parentMessenger);
    await web3.eth.sendTransaction({ from: l1Owner, to: crossDomainOwner, value: toWei("1") });
    await arbitrum_ChildMessenger.methods.setOracleSpoke(oracleSpoke.options.address).send({ from: crossDomainOwner });
  });
  describe("Resetting contract state", () => {
    // Check that only cross-domain owner can call these methods, that events are emitted as expected, and that state
    // is modified.
    it("setOracleSpoke", async () => {
      const transactionToSend = arbitrum_ChildMessenger.methods.setOracleSpoke(rando);
      assert(await didContractThrow(transactionToSend.send({ from: rando })));
      const receipt = await transactionToSend.send({ from: crossDomainOwner });
      await assertEventEmitted(receipt, arbitrum_ChildMessenger, "SetOracleSpoke", (ev) => {
        return ev.newOracleSpoke == rando;
      });
      assert.equal(await arbitrum_ChildMessenger.methods.oracleSpoke().call(), rando);
    });
    it("setParentMessenger", async () => {
      const transactionToSend = arbitrum_ChildMessenger.methods.setParentMessenger(rando);
      assert(await didContractThrow(transactionToSend.send({ from: rando })));
      const receipt = await transactionToSend.send({ from: crossDomainOwner });
      await assertEventEmitted(receipt, arbitrum_ChildMessenger, "SetParentMessenger", (ev) => {
        return ev.newParentMessenger == rando;
      });
      assert.equal(await arbitrum_ChildMessenger.methods.parentMessenger().call(), rando);
    });
  });
  describe("Sending messages to parent on L1", () => {
    it("Blocks calls from non privileged callers", async () => {
      // Only the oracleSpoke should be able to call this function. All other accounts should be blocked.
      const relayMessageTxn = arbitrum_ChildMessenger.methods.sendMessageToParent("0x123");
      assert(await didContractThrow(relayMessageTxn.send({ from: rando })));

      // Change the oracle spoke to be some EOA that we control to check the function can be called.
      await arbitrum_ChildMessenger.methods.setOracleSpoke(controlledEOA).send({ from: crossDomainOwner });
      assert.ok(await relayMessageTxn.send({ from: controlledEOA }));
    });

    it("Correctly encodes and sends messages to parent on L1", async () => {
      // For this test we will call the `requestPrice` method on the OracleSpoke which will initiate the cross chain
      // function call. Note normally only a registered contract can call this function.
      const requestTime = 123456789;
      const txn = await oracleSpoke.methods
        .requestPrice(priceIdentifier, requestTime, ancillaryData)
        .send({ from: controlledEOA });

      // We should be able to construct the function call sent from the oracle spoke directly.
      const encodedData = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes"],
        [
          priceIdentifier,
          requestTime,
          await oracleSpoke.methods.compressAncillaryData(ancillaryData, controlledEOA, txn.blockNumber).call(),
        ]
      );

      // This data is then encoded within the ParentMessenger.processMessageFromCrossChainChild function.
      const parentMessengerInterface = await Arbitrum_ParentMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromManualEncoding = await parentMessengerInterface.methods
        .processMessageFromCrossChainChild(encodedData)
        .encodeABI();

      // Check the message was sent to the l2 cross domain messenger and was encoded correctly.
      expect(arbsys.sendTxToL1).to.be.calledOnce;
      expect(arbsys.sendTxToL1).to.have.been.calledOnceWith(parentMessenger, expectedMessageFromManualEncoding);

      await assertEventEmitted(txn, arbitrum_ChildMessenger, "MessageSentToParent", (ev) => {
        return (
          ev.data == expectedMessageFromManualEncoding && ev.parentAddress == parentMessenger && ev.id.toString() == "9"
        );
      });
    });
  });
  describe("Receiving messages from parent on L1", () => {
    it("Blocks calls from non privileged callers", async () => {
      // only the aliased parent messenger should be able to call this function. All other accounts should be blocked.
      const data = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes", "int256"],
        [priceIdentifier, defaultTimestamp, ancillaryData, toWei("1234")]
      );
      const relayMessageTxn = arbitrum_ChildMessenger.methods.processMessageFromCrossChainParent(
        data,
        oracleSpoke.options.address
      );
      assert(await didContractThrow(relayMessageTxn.send({ from: rando })));
      assert.ok(await relayMessageTxn.send({ from: crossDomainOwner }));
    });

    it("Correctly decodes and sends to target when sent from parent messenger on L1", async () => {
      // For this test request a price from a registered contract and then push the price. Validate the data is
      // requested and forwarded to the oracleSpoke correctly.
      const txn = await oracleSpoke.methods
        .requestPrice(priceIdentifier, defaultTimestamp, ancillaryData)
        .send({ from: controlledEOA });

      const priceRequestEvents = await oracleSpoke.getPastEvents("PriceRequestBridged", { fromBock: 0 });

      const requestAncillaryData = await oracleSpoke.methods
        .compressAncillaryData(ancillaryData, controlledEOA, txn.blockNumber)
        .call();
      const requestPrice = toWei("1234");

      const data = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes", "int256"],
        [priceIdentifier, defaultTimestamp, requestAncillaryData, requestPrice]
      );

      const tx = await arbitrum_ChildMessenger.methods
        .processMessageFromCrossChainParent(data, oracleSpoke.options.address)
        .send({ from: crossDomainOwner });

      await assertEventEmitted(tx, arbitrum_ChildMessenger, "MessageReceivedFromParent", (ev) => {
        return ev.data == data && ev.targetSpoke == oracleSpoke.options.address && ev.parentAddress == parentMessenger;
      });

      // Validate that the tx contains the correct message sent from L1.
      await assertEventEmitted(tx, oracleSpoke, "PushedPrice", (ev) => {
        return (
          ev.identifier == priceIdentifier &&
          ev.ancillaryData == requestAncillaryData &&
          ev.price == requestPrice &&
          ev.requestHash == priceRequestEvents[0].returnValues.childRequestId
        );
      });
    });
  });
});

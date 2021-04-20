/**
 * Copyright 2020 ChainSafe Systems
 * SPDX-License-Identifier: LGPL-3.0-only
 */

const TruffleAssert = require("truffle-assertions");
const Ethers = require("ethers");

const { didContractThrow } = require("@uma/common");
const Helpers = require("./helpers");

const BridgeContract = artifacts.require("Bridge");
const GenericHandlerContract = artifacts.require("GenericHandler");
const CentrifugeAssetContract = artifacts.require("CentrifugeAsset");

contract("GenericHandler - [constructor]", async () => {
  const relayerThreshold = 2;
  const chainID = 1;
  const centrifugeAssetMinCount = 1;
  const blankFunctionSig = "0x00000000";
  const centrifugeAssetStoreFuncSig = "store(bytes32)";

  let BridgeInstance;
  let CentrifugeAssetInstance1;
  let CentrifugeAssetInstance2;
  let CentrifugeAssetInstance3;
  let initialResourceIDs;
  let initialContractAddresses;
  let initialDepositFunctionSignatures;
  let initialExecuteFunctionSignatures;

  beforeEach(async () => {
    await Promise.all([
      BridgeContract.new(chainID, [], relayerThreshold, 0, 100).then(instance => (BridgeInstance = instance)),
      CentrifugeAssetContract.new(centrifugeAssetMinCount).then(instance => (CentrifugeAssetInstance1 = instance)),
      CentrifugeAssetContract.new(centrifugeAssetMinCount).then(instance => (CentrifugeAssetInstance2 = instance)),
      CentrifugeAssetContract.new(centrifugeAssetMinCount).then(instance => (CentrifugeAssetInstance3 = instance))
    ]);

    initialResourceIDs = [
      Helpers.createResourceID(CentrifugeAssetInstance1.address, chainID),
      Helpers.createResourceID(CentrifugeAssetInstance2.address, chainID),
      Helpers.createResourceID(CentrifugeAssetInstance3.address, chainID)
    ];
    initialContractAddresses = [
      CentrifugeAssetInstance1.address,
      CentrifugeAssetInstance2.address,
      CentrifugeAssetInstance3.address
    ];

    const executeProposalFuncSig = Ethers.utils
      .keccak256(Ethers.utils.hexlify(Ethers.utils.toUtf8Bytes(centrifugeAssetStoreFuncSig)))
      .substr(0, 10);

    initialDepositFunctionSignatures = [blankFunctionSig, blankFunctionSig, blankFunctionSig];
    initialExecuteFunctionSignatures = [executeProposalFuncSig, executeProposalFuncSig, executeProposalFuncSig];
  });

  it("[sanity] contract should be deployed successfully", async () => {
    TruffleAssert.passes(
      await GenericHandlerContract.new(
        BridgeInstance.address,
        initialResourceIDs,
        initialContractAddresses,
        initialDepositFunctionSignatures,
        initialExecuteFunctionSignatures
      )
    );
  });

  it("should revert because initialResourceIDs and initialContractAddresses len mismatch", async () => {
    await didContractThrow(
      GenericHandlerContract.new(
        BridgeInstance.address,
        [],
        initialContractAddresses,
        initialDepositFunctionSignatures,
        initialExecuteFunctionSignatures
      )
    );
  });

  it("should revert because provided contract addresses and function signatures len mismatch.", async () => {
    await didContractThrow(
      GenericHandlerContract.new(
        BridgeInstance.address,
        initialResourceIDs,
        initialContractAddresses,
        [],
        initialExecuteFunctionSignatures
      )
    );
  });

  it("should revert because provided deposit and execute function signatures len mismatch", async () => {
    await didContractThrow(
      GenericHandlerContract.new(
        BridgeInstance.address,
        initialResourceIDs,
        initialContractAddresses,
        initialDepositFunctionSignatures,
        []
      )
    );
  });

  it("contract mappings were set with expected values", async () => {
    const GenericHandlerInstance = await GenericHandlerContract.new(
      BridgeInstance.address,
      initialResourceIDs,
      initialContractAddresses,
      initialDepositFunctionSignatures,
      initialExecuteFunctionSignatures
    );

    for (let i = 0; i < initialResourceIDs.length; i++) {
      const retrievedTokenAddress = await GenericHandlerInstance._resourceIDToContractAddress.call(
        initialResourceIDs[i]
      );
      assert.strictEqual(initialContractAddresses[i].toLowerCase(), retrievedTokenAddress.toLowerCase());

      const retrievedResourceID = await GenericHandlerInstance._contractAddressToResourceID.call(
        initialContractAddresses[i]
      );
      assert.strictEqual(initialResourceIDs[i].toLowerCase(), retrievedResourceID.toLowerCase());

      const retrievedDepositFunctionSig = await GenericHandlerInstance._contractAddressToDepositFunctionSignature.call(
        initialContractAddresses[i]
      );
      assert.strictEqual(initialDepositFunctionSignatures[i].toLowerCase(), retrievedDepositFunctionSig.toLowerCase());

      const retrievedExecuteFunctionSig = await GenericHandlerInstance._contractAddressToExecuteFunctionSignature.call(
        initialContractAddresses[i]
      );
      assert.strictEqual(initialExecuteFunctionSignatures[i].toLowerCase(), retrievedExecuteFunctionSig.toLowerCase());
    }
  });
});

/**
 * Copyright 2020 ChainSafe Systems
 * SPDX-License-Identifier: LGPL-3.0-only
 */

const TruffleAssert = require("truffle-assertions");
const Ethers = require("ethers");

const Helpers = require("./helpers");

const BridgeContract = artifacts.require("Bridge");
const CentrifugeAssetContract = artifacts.require("CentrifugeAsset");
const GenericHandlerContract = artifacts.require("GenericHandler");

contract("GenericHandler - [Execute Proposal]", async accounts => {
  const relayerThreshold = 2;
  const chainID = 1;
  const expectedDepositNonce = 1;

  const depositerAddress = accounts[1];
  const relayer1Address = accounts[2];
  const relayer2Address = accounts[3];

  const initialRelayers = [relayer1Address, relayer2Address];

  const centrifugeAssetMinCount = 10;
  const hashOfCentrifugeAsset = Ethers.utils.keccak256("0xc0ffee");

  let BridgeInstance;
  let CentrifugeAssetInstance;
  let initialResourceIDs;
  let initialContractAddresses;
  let initialDepositFunctionSignatures;
  let initialExecuteFunctionSignatures;
  let GenericHandlerInstance;
  let resourceID;
  let depositData;
  let depositProposalDataHash;

  beforeEach(async () => {
    await Promise.all([
      BridgeContract.new(chainID, initialRelayers, relayerThreshold, 0, 100).then(
        instance => (BridgeInstance = instance)
      ),
      CentrifugeAssetContract.new(centrifugeAssetMinCount).then(instance => (CentrifugeAssetInstance = instance))
    ]);

    const centrifugeAssetFuncSig = Helpers.getFunctionSignature(CentrifugeAssetInstance, "store");

    resourceID = Helpers.createResourceID(CentrifugeAssetInstance.address, chainID);
    initialResourceIDs = [resourceID];
    initialContractAddresses = [CentrifugeAssetInstance.address];
    initialDepositFunctionSignatures = [Helpers.blankFunctionSig];
    initialExecuteFunctionSignatures = [centrifugeAssetFuncSig];

    GenericHandlerInstance = await GenericHandlerContract.new(
      BridgeInstance.address,
      initialResourceIDs,
      initialContractAddresses,
      initialDepositFunctionSignatures,
      initialExecuteFunctionSignatures
    );

    await BridgeInstance.adminSetGenericResource(
      GenericHandlerInstance.address,
      resourceID,
      initialContractAddresses[0],
      initialDepositFunctionSignatures[0],
      initialExecuteFunctionSignatures[0]
    );

    depositData = Helpers.createGenericDepositData(hashOfCentrifugeAsset);
    depositProposalDataHash = Ethers.utils.keccak256(GenericHandlerInstance.address + depositData.substr(2));
  });

  it("deposit can be executed successfully", async () => {
    TruffleAssert.passes(await BridgeInstance.deposit(chainID, resourceID, depositData, { from: depositerAddress }));

    // relayer1 creates the deposit proposal
    TruffleAssert.passes(
      await BridgeInstance.voteProposal(chainID, expectedDepositNonce, resourceID, depositProposalDataHash, {
        from: relayer1Address
      })
    );

    // relayer2 votes in favor of the deposit proposal
    // because the relayerThreshold is 2, the deposit proposal will go
    // into a finalized state
    TruffleAssert.passes(
      await BridgeInstance.voteProposal(chainID, expectedDepositNonce, resourceID, depositProposalDataHash, {
        from: relayer2Address
      })
    );

    // relayer1 will execute the deposit proposal
    TruffleAssert.passes(
      await BridgeInstance.executeProposal(chainID, expectedDepositNonce, depositData, resourceID, {
        from: relayer2Address
      })
    );

    // Verifying asset was marked as stored in CentrifugeAssetInstance
    assert.isTrue(await CentrifugeAssetInstance._assetsStored.call(hashOfCentrifugeAsset));
  });

  it("AssetStored event should be emitted", async () => {
    TruffleAssert.passes(await BridgeInstance.deposit(chainID, resourceID, depositData, { from: depositerAddress }));

    // relayer1 creates the deposit proposal
    TruffleAssert.passes(
      await BridgeInstance.voteProposal(chainID, expectedDepositNonce, resourceID, depositProposalDataHash, {
        from: relayer1Address
      })
    );

    // relayer2 votes in favor of the deposit proposal
    // because the relayerThreshold is 2, the deposit proposal will go
    // into a finalized state
    TruffleAssert.passes(
      await BridgeInstance.voteProposal(chainID, expectedDepositNonce, resourceID, depositProposalDataHash, {
        from: relayer2Address
      })
    );

    // relayer1 will execute the deposit proposal
    const executeProposalTx = await BridgeInstance.executeProposal(
      chainID,
      expectedDepositNonce,
      depositData,
      resourceID,
      { from: relayer2Address }
    );

    const internalTx = await TruffleAssert.createTransactionResult(CentrifugeAssetInstance, executeProposalTx.tx);
    TruffleAssert.eventEmitted(internalTx, "AssetStored", event => {
      return event.asset === hashOfCentrifugeAsset;
    });

    assert.isTrue(
      await CentrifugeAssetInstance._assetsStored.call(hashOfCentrifugeAsset),
      "Centrifuge Asset was not successfully stored"
    );
  });
});

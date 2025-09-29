const { ethers } = require("hardhat");
const { assert } = require("chai");
const { getAbi, getBytecode } = require("@uma/contracts-node");
const { runEthersTransaction, runEthersContractTransaction } = require("../dist/EthersTransactionUtils");

describe("EthersTransactionUtils.js", function () {
  let signer;
  let erc20;

  beforeEach(async function () {
    [signer] = await ethers.getSigners();

    const erc20Abi = getAbi("BasicERC20");
    const erc20Bytecode = getBytecode("BasicERC20");
    const erc20Factory = new ethers.ContractFactory(erc20Abi, erc20Bytecode, signer);
    erc20 = await erc20Factory.deploy("0");
  });

  describe("runTransaction", function () {
    it("regular signer transaction", async function () {
      const approvalAmount = ethers.BigNumber.from(1);
      const populatedTx = await erc20.populateTransaction.approve(signer.address, approvalAmount);

      await (await runEthersTransaction(signer, populatedTx)).wait();

      assert.isTrue((await erc20.allowance(signer.address, signer.address)).eq(approvalAmount));
    });

    it("regular contract transaction", async function () {
      const approvalAmount = ethers.BigNumber.from(2);
      const populatedTx = await erc20.populateTransaction.approve(signer.address, approvalAmount);
      const txReceipt = await (await runEthersContractTransaction(erc20, populatedTx)).wait();
      const event = txReceipt.events?.find((e) => e.event === "Approval");

      assert.isTrue((await erc20.allowance(signer.address, signer.address)).eq(approvalAmount));
      assert.isDefined(event, "Approval event not found in transaction receipt");
      assert.isTrue(event.args?.owner === signer.address, "Event owner does not match signer address");
      assert.isTrue(event.args?.spender === signer.address, "Event spender does not match signer address");
      assert.isTrue(event.args?.value.eq(approvalAmount), "Event value does not match approval amount");
    });

    // Note: This does not cover revert tests as hardhat provider has different error behavior than JsonRpcProvider
    // from ethers.
  });
});

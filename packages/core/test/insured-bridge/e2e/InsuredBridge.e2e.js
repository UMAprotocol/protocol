const { ZERO_ADDRESS } = require("@uma/common");

const { assert } = require("chai");

const { ethers } = require("hardhat");
const { Watcher } = require("@eth-optimism/watcher");
const { getContractInterface, predeploys } = require("@eth-optimism/contracts");

const { createLocalEthersFactory, createOptimismEthersFactory, getProviders } = require("./helpers/ArtifactsHelper");

const { DEFAULT_ADMIN_KEY } = require("./helpers/OptimismConstants");

// Create contract factories using L1 and L2 artifacts
const factory__L1_ERC20 = createLocalEthersFactory("ExpandedERC20");
const factory__L2_ERC20 = createOptimismEthersFactory("L2StandardERC20", true);
const factory__L1StandardBridge = createOptimismEthersFactory("OVM_L1StandardBridge");
const factory__L2StandardBridge = createOptimismEthersFactory("OVM_L2StandardBridge", true);

describe("L1 <> L2 Deposit and Withdrawal", () => {
  // Set up our RPC provider connections.
  const { l1RpcProvider, l2RpcProvider } = getProviders();

  // Set up our wallets (using a default private key with 10k ETH allocated to it). Need two wallets objects, one for
  // interacting with L1 and one for interacting with L2. Both will use the same private key.
  const l1Wallet = new ethers.Wallet(DEFAULT_ADMIN_KEY, l1RpcProvider);
  const l2Wallet = new ethers.Wallet(DEFAULT_ADMIN_KEY, l2RpcProvider);

  let l2AddressManager, l1Messenger, L1_ERC20, L2_ERC20, L1StandardBridge, L2StandardBridge, watcher;

  before("deploy tokens and set up bridge contracts", async () => {
    l2AddressManager = new ethers.Contract(
      predeploys.Lib_AddressManager,
      getContractInterface("Lib_AddressManager"),
      l2RpcProvider
    );

    l1Messenger = new ethers.Contract(
      await l2AddressManager.getAddress("OVM_L1CrossDomainMessenger"),
      getContractInterface("OVM_L1CrossDomainMessenger"),
      l1RpcProvider
    );

    // Tool that helps watches and waits for messages to be relayed between L1 and L2.
    watcher = new Watcher({
      l1: { provider: l1RpcProvider, messengerAddress: l1Messenger.address },
      l2: { provider: l2RpcProvider, messengerAddress: predeploys.OVM_L2CrossDomainMessenger },
    });

    // Deploy an ERC20 token on L1. Add minting to the l1Wallet and mint some tokens.
    L1_ERC20 = await factory__L1_ERC20.connect(l1Wallet).deploy("L1 ERC20 Token", "L1Tkn", 18);
    await L1_ERC20.deployTransaction.wait();

    await L1_ERC20.addMember(1, l1Wallet.address);
    await L1_ERC20.mint(l1Wallet.address, 1234);

    // Deploy the paired ERC20 token to L2. This takes in the address of the L2 bridge and the associated L1 token.
    L2_ERC20 = await factory__L2_ERC20
      .connect(l2Wallet)
      .deploy(predeploys.OVM_L2StandardBridge, L1_ERC20.address, "L2 ERC20", "L2T");

    await L2_ERC20.deployTransaction.wait();

    // Connect to the L2 standard bridge from the predeploys.
    L2StandardBridge = factory__L2StandardBridge.connect(l2Wallet).attach(predeploys.OVM_L2StandardBridge);

    // Fetch the pre-deployed L1 standard bridge address from the predeploy.
    const L1StandardBridgeAddress = await L2StandardBridge.l1TokenBridge();
    L1StandardBridge = factory__L1StandardBridge.connect(l1Wallet).attach(L1StandardBridgeAddress);
  });

  describe("Basic bridging functionality", async () => {
    it("Can send tokens from L1 to L2", async () => {
      // Wallet should have to tokens on L1 from the mint action and no tokens on L2.
      assert.equal((await L1_ERC20.balanceOf(l1Wallet.address)).toString(), "1234");
      assert.equal((await L2_ERC20.balanceOf(l2Wallet.address)).toString(), "0");

      // Allow the gateway to lock up some of our tokens.
      await L1_ERC20.approve(L1StandardBridge.address, 1234);

      // Lock the tokens up inside the gateway and ask the L2 contract to mint new ones.
      const depositTx = await L1StandardBridge.depositERC20(L1_ERC20.address, L2_ERC20.address, 1234, 2000000, "0x");
      await depositTx.wait();

      // Wait for the message to be relayed to L2.
      const [msgHash1] = await watcher.getMessageHashesFromL1Tx(depositTx.hash);

      // Fetch the L2 transaction receipt. This also acts to block until the bridging transaction has been mined.
      const receipt = await watcher.getL2TransactionReceipt(msgHash1, true);
      // Deposit transaction should be sent to the OVM_L2CrossDomainMessenger on L2 and originate from 0x00 on L2.
      assert.equal(receipt.to, predeploys.OVM_L2CrossDomainMessenger);
      assert.equal(receipt.from, ZERO_ADDRESS);

      // The balances should have incremented on L2.
      assert.equal((await L1_ERC20.balanceOf(l1Wallet.address)).toString(), "0");
      assert.equal((await L2_ERC20.balanceOf(l2Wallet.address)).toString(), "1234");
    });
    it("Can send tokens back from L2 to L1", async () => {
      // Burn the tokens on L2 and ask the L1 contract to unlock on our behalf.
      const withdrawTx = await L2StandardBridge.withdraw(L2_ERC20.address, 1234, 0, "0x");
      await withdrawTx.wait();

      // Wait for the message to be relayed to L1. Check addresses in the logs match the L1 token and bridge.
      const [msgHash2] = await watcher.getMessageHashesFromL2Tx(withdrawTx.hash);
      const receipt = await watcher.getL1TransactionReceipt(msgHash2);
      assert.equal(receipt.logs[0].address, L1_ERC20.address);
      assert.equal(receipt.logs[1].address, L1StandardBridge.address);

      // Validate balances on L1 have been incremented accordingly.
      assert.equal((await L1_ERC20.balanceOf(l1Wallet.address)).toString(), "1234");
      assert.equal((await L2_ERC20.balanceOf(l2Wallet.address)).toString(), "0");
    });
  });
});

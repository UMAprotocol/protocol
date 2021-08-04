const { ZERO_ADDRESS } = require("@uma/common");

const { assert } = require("chai");

const { ethers } = require("hardhat");
const { Watcher } = require("@eth-optimism/watcher");
const { getContractInterface, predeploys } = require("@eth-optimism/contracts");

const { createLocalEthersFactory, createOptimismEthersFactory, getProviders } = require("./helpers/ArtifactsHelper");

const { setUpUmaEcosystemContracts } = require("./helpers/TestPreamble");

const {
  DEFAULT_ADMIN_KEY,
  OPTIMISM_GAS_OPTS,
  PROXY__OVM_L1_CROSS_DOMAIN_MESSENGER,
} = require("./helpers/OptimismConstants");

// Token and Optimism contracts factories
const factory__L1_ERC20 = createLocalEthersFactory("ExpandedERC20");
const factory__L2_ERC20 = createOptimismEthersFactory("L2StandardERC20", true);
const factory__L1StandardBridge = createOptimismEthersFactory("OVM_L1StandardBridge");
const factory__L2StandardBridge = createOptimismEthersFactory("OVM_L2StandardBridge", true);

// Insured bridge contract factories
const factory__L1_BridgePoolFactory = createLocalEthersFactory("BridgePoolFactory");
const factory__L2_BridgeDepositBox = createLocalEthersFactory("OVM_BridgeDepositBox", true);

describe("Insured bridge e2e tests", () => {
  // Set up our RPC provider connections.
  const { l1RpcProvider, l2RpcProvider } = getProviders();

  // Set up our wallets (using a default private key with 10k ETH allocated to it). Need two wallets objects, one for
  // interacting with L1 and one for interacting with L2. Both will use the same private key.
  const l1Wallet = new ethers.Wallet(DEFAULT_ADMIN_KEY, l1RpcProvider);
  const l2Wallet = new ethers.Wallet(DEFAULT_ADMIN_KEY, l2RpcProvider);

  // Contract objects
  let l2AddressManager, l1Messenger, l1Erc20, l2Erc20, l1StandardBridge, l2StandardBridge, watcher;

  before(async () => {
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
    l1Erc20 = await factory__L1_ERC20.connect(l1Wallet).deploy("L1 ERC20 Token", "L1Tkn", 18);

    await l1Erc20.deployTransaction.wait();

    await l1Erc20.addMember(1, l1Wallet.address);
    await l1Erc20.mint(l1Wallet.address, 1234);

    // Deploy the paired ERC20 token to L2. This takes in the address of the L2 bridge and the associated L1 token.
    l2Erc20 = await factory__L2_ERC20
      .connect(l2Wallet)
      .deploy(predeploys.OVM_L2StandardBridge, l1Erc20.address, "L2 ERC20", "L2T", OPTIMISM_GAS_OPTS);

    await l2Erc20.deployTransaction.wait();

    // Connect to the L2 standard bridge from the predeploys.
    l2StandardBridge = factory__L2StandardBridge.connect(l2Wallet).attach(predeploys.OVM_L2StandardBridge);

    // Fetch the pre-deployed L1 standard bridge address from the predeploy.
    const l1StandardBridgeAddress = await l2StandardBridge.l1TokenBridge();
    l1StandardBridge = factory__L1StandardBridge.connect(l1Wallet).attach(l1StandardBridgeAddress);
  });

  describe("Basic L1 <> L2 bridging functionality", async () => {
    it("Can send tokens from L1 to L2", async () => {
      // Wallet should have to tokens on L1 from the mint action and no tokens on L2.
      assert.equal((await l1Erc20.balanceOf(l1Wallet.address)).toString(), "1234");
      assert.equal((await l2Erc20.balanceOf(l2Wallet.address)).toString(), "0");

      // Allow the gateway to lock up some of our tokens.
      await l1Erc20.approve(l1StandardBridge.address, 1234);

      // Lock the tokens up inside the gateway and ask the L2 contract to mint new ones.
      const depositTx = await l1StandardBridge.depositERC20(l1Erc20.address, l2Erc20.address, 1234, 2000000, "0x");
      await depositTx.wait();

      // Wait for the message to be relayed to L2.
      const [msgHash] = await watcher.getMessageHashesFromL1Tx(depositTx.hash);

      // Fetch the L2 transaction receipt. This also acts to block until the bridging transaction has been mined.
      const receipt = await watcher.getL2TransactionReceipt(msgHash, true);
      // Deposit transaction should be sent to the OVM_L2CrossDomainMessenger on L2 and originate from 0x00 on L2.
      assert.equal(receipt.to, predeploys.OVM_L2CrossDomainMessenger);
      assert.equal(receipt.from, ZERO_ADDRESS);

      // The balances should have incremented on L2.
      assert.equal((await l1Erc20.balanceOf(l1Wallet.address)).toString(), "0");
      assert.equal((await l2Erc20.balanceOf(l2Wallet.address)).toString(), "1234");
    });
    it("Can send tokens back from L2 to L1", async () => {
      // Burn the tokens on L2 and ask the L1 contract to unlock on our behalf.
      const withdrawTx = await l2StandardBridge.withdraw(l2Erc20.address, 1234, 0, "0x");
      await withdrawTx.wait();

      // Wait for the message to be relayed to L1. Check addresses in the logs match the L1 token and bridge.
      const [msgHash] = await watcher.getMessageHashesFromL2Tx(withdrawTx.hash);
      const receipt = await watcher.getL1TransactionReceipt(msgHash);
      assert.equal(receipt.logs[0].address, l1Erc20.address);
      assert.equal(receipt.logs[1].address, l1StandardBridge.address);

      // Validate balances on L1 have been incremented accordingly.
      assert.equal((await l1Erc20.balanceOf(l1Wallet.address)).toString(), "1234");
      assert.equal((await l2Erc20.balanceOf(l2Wallet.address)).toString(), "0");
    });
  });
  describe("Insured bridge functionality", async () => {
    let optimisticOracleLiveness = 7200;
    let proposerBondPct = "0";
    let identifier = ethers.utils.formatBytes32String("BRIDGE_TRANSFER_TEST");
    let minimumBridgingDelay = 60;

    // End to end tested contracts
    let l1BridgePoolFactory, l2BridgeDepositBox;

    // UMA ecosystem objects.
    let l1Timer, l1Finder, l2Timer;

    beforeEach(async () => {
      // Set up required UMA L1 ecosystem contracts. Note that this also sets up collateralWhitelist, identifierWhitelist
      // and store which are not used in the tests. TODO: setup OO when we have more implementation cross-chain.
      ({ l1Timer, l1Finder, l2Timer } = await setUpUmaEcosystemContracts(l1Wallet, l2Wallet, l1Erc20, identifier));

      // Bridging infrastructure and initialization. Note we use the l1 proxy cross-domain messenger for the routers
      // _crossDomainMessenger. This is done to mimic the production setup which routes transactions through this proxy.
      l1BridgePoolFactory = await factory__L1_BridgePoolFactory
        .connect(l1Wallet)
        .deploy(
          l1Finder.address,
          PROXY__OVM_L1_CROSS_DOMAIN_MESSENGER,
          optimisticOracleLiveness,
          proposerBondPct,
          identifier,
          l1Timer.address
        );
      await l1BridgePoolFactory.deployTransaction.wait();

      l2BridgeDepositBox = await factory__L2_BridgeDepositBox
        .connect(l2Wallet)
        .deploy(l1BridgePoolFactory.address, minimumBridgingDelay, l2Timer.address, OPTIMISM_GAS_OPTS);
      await l2BridgeDepositBox.deployTransaction.wait();

      // Set deposit contract on deposit Admin.
      await l1BridgePoolFactory.setDepositContract(l2BridgeDepositBox.address);
    });
    describe("Cross-domain admin functionality", () => {
      it("Can whitelist token on L2 from L1", async () => {
        // Token is not whitelisted before
        assert.isFalse(await l2BridgeDepositBox.isWhitelistToken(l2Erc20.address));

        // Wallet should have to tokens on L1 from the mint action and no tokens on L2.
        const whitelistTx = await l1BridgePoolFactory.whitelistToken(
          l1Erc20.address, // L1 token.
          l2Erc20.address, // Associated L2 token.
          10000000 // L2Gas limit. set this to a large number, but less than gas limit, to ensure no L2 revert.
        );
        await whitelistTx.wait();

        // Wait for the message to be relayed to L2.
        const [msgHash] = await watcher.getMessageHashesFromL1Tx(whitelistTx.hash);

        // Fetch the L2 transaction receipt. This also acts to block until the bridging transaction has been mined on L2.
        const receipt = await watcher.getL2TransactionReceipt(msgHash, true);

        assert.equal(receipt.to, predeploys.OVM_L2CrossDomainMessenger);
        assert.equal(receipt.from, ZERO_ADDRESS);

        // The log emitted should be sent to the deposit box.
        assert.equal(receipt.logs[0].address, l2BridgeDepositBox.address);

        // Validate that on L2 the address has been whitelisted correctly.
        assert.isTrue(await l2BridgeDepositBox.isWhitelistToken(l2Erc20.address));
        assert.equal((await l2BridgeDepositBox.whitelistedTokens(l2Erc20.address)).l1Token, l1Erc20.address);
        assert.equal(
          (await l2BridgeDepositBox.whitelistedTokens(l2Erc20.address)).lastBridgeTime.toString(),
          (await l2Timer.getCurrentTime()).toString()
        );
      });
      it("Can change the bridge admin address", async () => {
        // Correct admin before the change.
        assert.equal(await l2BridgeDepositBox.bridgeAdmin(), l1BridgePoolFactory.address);
        const bridgeAdminChangeTx = await l1BridgePoolFactory.setBridgeAdmin(l1Wallet.address, 10000000);
        await bridgeAdminChangeTx.wait();

        const [msgHash] = await watcher.getMessageHashesFromL1Tx(bridgeAdminChangeTx.hash);
        const receipt = await watcher.getL2TransactionReceipt(msgHash, true);

        assert.equal(receipt.to, predeploys.OVM_L2CrossDomainMessenger);
        assert.equal(receipt.from, ZERO_ADDRESS);
        assert.equal(receipt.logs[0].address, l2BridgeDepositBox.address);

        // Validate that on L2 the bridge admin has been changed correctly.
        assert.equal(await l2BridgeDepositBox.bridgeAdmin(), l1Wallet.address);
      });
      it("Can enable/disable deposits on L2", async () => {
        // Is enabled before the change.
        assert.isTrue(await l2BridgeDepositBox.depositsEnabled());
        const bridgeAdminChangeTx = await l1BridgePoolFactory.setEnableDeposits(false, 10000000);
        await bridgeAdminChangeTx.wait();

        const [msgHash] = await watcher.getMessageHashesFromL1Tx(bridgeAdminChangeTx.hash);
        const receipt = await watcher.getL2TransactionReceipt(msgHash, true);

        assert.equal(receipt.to, predeploys.OVM_L2CrossDomainMessenger);
        assert.equal(receipt.from, ZERO_ADDRESS);
        assert.equal(receipt.logs[0].address, l2BridgeDepositBox.address);

        // Validate that on L2 the deposits have been disabled.
        assert.isFalse(await l2BridgeDepositBox.depositsEnabled());
      });
      it("Can update the L2 minimum bridging delay", async () => {
        // Correct min delay before the change.
        assert.equal(await l2BridgeDepositBox.minimumBridgingDelay(), minimumBridgingDelay);
        const bridgeAdminChangeTx = await l1BridgePoolFactory.setMinimumBridgingDelay(420, 10000000);
        await bridgeAdminChangeTx.wait();

        const [msgHash] = await watcher.getMessageHashesFromL1Tx(bridgeAdminChangeTx.hash);
        const receipt = await watcher.getL2TransactionReceipt(msgHash, true);

        assert.equal(receipt.to, predeploys.OVM_L2CrossDomainMessenger);
        assert.equal(receipt.from, ZERO_ADDRESS);
        assert.equal(receipt.logs[0].address, l2BridgeDepositBox.address);

        // Validate that on L2 the deposits have been disabled.
        assert.equal(await l2BridgeDepositBox.minimumBridgingDelay(), 420);
      });
    });
  });
});

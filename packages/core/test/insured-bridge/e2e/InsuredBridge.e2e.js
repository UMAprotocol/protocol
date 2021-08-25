const { ZERO_ADDRESS } = require("@uma/common");

const chai = require("chai");
const { solidity } = require("ethereum-waffle");
chai.use(solidity);
const { assert, expect } = require("chai");

const { ethers } = require("hardhat");
const { Watcher } = require("@eth-optimism/watcher");
const { getContractInterface, predeploys } = require("@eth-optimism/contracts");

const { createLocalEthersFactory, createOptimismEthersFactory, getProviders } = require("./helpers/ArtifactsHelper");

const { setUpUmaEcosystemContracts } = require("./helpers/TestPreamble");

const { waitForL1ToL2Transaction, waitForL2ToL1Transaction } = require("./helpers/WatcherHelpers");
const { delay } = require("@uma/financial-templates-lib");

const {
  DEFAULT_ADMIN_KEY,
  OTHER_WALLET_KEY,
  OPTIMISM_GAS_OPTS,
  PROXY__OVM_L1_CROSS_DOMAIN_MESSENGER,
} = require("./helpers/OptimismConstants");

// Token and Optimism contracts factories
const factory__L1_ERC20 = createLocalEthersFactory("ExpandedERC20");
const factory__L2_ERC20 = createOptimismEthersFactory("L2StandardERC20", true);
const factory__L1StandardBridge = createOptimismEthersFactory("OVM_L1StandardBridge");
const factory__L2StandardBridge = createOptimismEthersFactory("OVM_L2StandardBridge", true);

// Insured bridge contract factories
const factory__L1_BridgeAdmin = createLocalEthersFactory("BridgeAdmin");
const factory__L1_BridgePool = createLocalEthersFactory("BridgePool");
const factory__L2_BridgeDepositBox = createLocalEthersFactory("OVM_BridgeDepositBox", true);

describe("Insured bridge e2e tests", () => {
  // Set up our RPC provider connections.
  const { l1RpcProvider, l2RpcProvider } = getProviders();

  // Set up our wallets (using a default private key with 10k ETH allocated to it). Need two wallets objects, one for
  // interacting with L1 and one for interacting with L2. Both will use the same private key.
  const l1Wallet = new ethers.Wallet(DEFAULT_ADMIN_KEY, l1RpcProvider);
  const l2Wallet = new ethers.Wallet(DEFAULT_ADMIN_KEY, l2RpcProvider);

  // Contract objects
  let l2AddressManager, l1Messenger, l1Token, l2Token, l1StandardBridge, l2StandardBridge, watcher;

  beforeEach(async () => {
    // Ensure relayer is running before any of these tests start. This might not be the case if a previous test failed.

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
    l1Token = await factory__L1_ERC20.connect(l1Wallet).deploy("L1 ERC20 Token", "L1Tkn", 18);
    await l1Token.deployTransaction.wait();
    await l1Token.addMember(1, l1Wallet.address);

    // Deploy the paired ERC20 token to L2. This takes in the address of the L2 bridge and the associated L1 token.
    l2Token = await factory__L2_ERC20
      .connect(l2Wallet)
      .deploy(predeploys.OVM_L2StandardBridge, l1Token.address, "L2 ERC20", "L2T", OPTIMISM_GAS_OPTS);
    await l2Token.deployTransaction.wait();

    // Connect to the L2 standard bridge from the predeploys.
    l2StandardBridge = factory__L2StandardBridge.connect(l2Wallet).attach(predeploys.OVM_L2StandardBridge);

    // Fetch the pre-deployed L1 standard bridge address from the predeploy.
    const l1StandardBridgeAddress = await l2StandardBridge.l1TokenBridge();
    l1StandardBridge = factory__L1StandardBridge.connect(l1Wallet).attach(l1StandardBridgeAddress);
  });
  beforeEach(async () => {
    // Running these tests back to back can be extremely flaky. One solution is to add in a delay between tests. This
    // is really nasty but it works. Hopefully the optimism container stack will be more stable in the future.
    delay(10);
  });

  describe("Basic L1 <> L2 bridging functionality", async () => {
    it("Can send tokens from L1 to L2", async () => {
      // Wallet should have to tokens on L1 from the mint action and no tokens on L2.
      await l1Token.mint(l1Wallet.address, 1234);
      assert.equal((await l1Token.balanceOf(l1Wallet.address)).toString(), "1234");
      assert.equal((await l2Token.balanceOf(l2Wallet.address)).toString(), "0");

      // Allow the gateway to lock up some of our tokens.
      await l1Token.approve(l1StandardBridge.address, 1234);

      // Lock the tokens up inside the gateway and ask the L2 contract to mint new ones.
      const depositTx = await l1StandardBridge.depositERC20(l1Token.address, l2Token.address, 1234, 2000000, "0x");
      await depositTx.wait();

      // Wait for the message to be relayed to L2.
      const [msgHash] = await watcher.getMessageHashesFromL1Tx(depositTx.hash);

      // Fetch the L2 transaction receipt. This also acts to block until the bridging transaction has been mined.
      const receipt = await watcher.getL2TransactionReceipt(msgHash, true);
      // Deposit transaction should be sent to the OVM_L2CrossDomainMessenger on L2 and originate from 0x00 on L2.
      assert.equal(receipt.to, predeploys.OVM_L2CrossDomainMessenger);
      assert.equal(receipt.from, ZERO_ADDRESS);

      // The balances should have incremented on L2.
      assert.equal((await l1Token.balanceOf(l1Wallet.address)).toString(), "0");
      assert.equal((await l2Token.balanceOf(l2Wallet.address)).toString(), "1234");
    });
    it("Can send tokens back from L2 to L1", async () => {
      // Mint to send tokens to L2.
      await l1Token.mint(l1Wallet.address, 1234);
      await l1Token.approve(l1StandardBridge.address, 1234);
      const depositTx = await l1StandardBridge.depositERC20(l1Token.address, l2Token.address, 1234, 2000000, "0x");
      await waitForL1ToL2Transaction(depositTx, watcher);

      // Burn the tokens on L2 and ask the L1 contract to unlock on our behalf.
      const withdrawTx = await l2StandardBridge.withdraw(l2Token.address, 1234, 0, "0x");
      await withdrawTx.wait();

      // Wait for the message to be relayed to L1. Check addresses in the logs match the L1 token and bridge.
      const [msgHash] = await watcher.getMessageHashesFromL2Tx(withdrawTx.hash);
      const receipt = await watcher.getL1TransactionReceipt(msgHash);
      assert.equal(receipt.logs[0].address, l1Token.address);
      assert.equal(receipt.logs[1].address, l1StandardBridge.address);

      // Validate balances on L1 have been incremented accordingly.
      assert.equal((await l1Token.balanceOf(l1Wallet.address)).toString(), "1234");
      assert.equal((await l2Token.balanceOf(l2Wallet.address)).toString(), "0");
    });
  });

  describe("Insured bridge functionality", async () => {
    // Bridge variables
    let optimisticOracleLiveness = 7200;
    let proposerBondPct = ethers.utils.parseEther("0.10");
    let identifier = ethers.utils.formatBytes32String("BRIDGE_TRANSFER_TEST");
    let lpFeeRatePerSecond = ethers.utils.parseEther("0.0000015");
    let minimumBridgingDelay = 60;
    let slowRelayFeePct = ethers.utils.parseEther("0.01");
    let instantRelayFeePct = ethers.utils.parseEther("0.01");
    let realizedLpFee = ethers.utils.parseEther("0.1");
    let depositAmount = ethers.utils.parseEther("10");
    let liquidityProvided = ethers.utils.parseEther("100");
    let depositData;

    // End to end tested contracts
    let l1BridgeAdmin, l1BridgePool, l2BridgeDepositBox;

    // UMA ecosystem objects.
    let l1Timer, l1Finder, l1CollateralWhitelist, l2Timer;

    // Create another wallet to act as the LP.
    const l1LiquidityProvider = new ethers.Wallet(OTHER_WALLET_KEY, l1RpcProvider);

    beforeEach(async () => {
      // Set up required UMA L1 ecosystem contracts.
      ({ l1Timer, l1Finder, l1CollateralWhitelist, l2Timer } = await setUpUmaEcosystemContracts(
        l1Wallet,
        l2Wallet,
        l1Token,
        identifier
      ));

      // Bridging infrastructure and initialization. Note we use the l1 proxy cross-domain messenger for the routers
      // _crossDomainMessenger. This is done to mimic the production setup which routes transactions through this proxy.
      l1BridgeAdmin = await factory__L1_BridgeAdmin
        .connect(l1Wallet)
        .deploy(
          l1Finder.address,
          PROXY__OVM_L1_CROSS_DOMAIN_MESSENGER,
          optimisticOracleLiveness,
          proposerBondPct,
          identifier
        );
      await l1BridgeAdmin.deployTransaction.wait();

      l1BridgePool = await factory__L1_BridgePool
        .connect(l1Wallet)
        .deploy("LP Token", "LPT", l1BridgeAdmin.address, l1Token.address, lpFeeRatePerSecond, l1Timer.address);
      await l1BridgePool.deployTransaction.wait();

      l2BridgeDepositBox = await factory__L2_BridgeDepositBox
        .connect(l2Wallet)
        .deploy(l1BridgeAdmin.address, minimumBridgingDelay, l2Timer.address, OPTIMISM_GAS_OPTS);
      await l2BridgeDepositBox.deployTransaction.wait();

      // Set deposit contract on deposit Admin.
      await l1BridgeAdmin.setDepositContract(l2BridgeDepositBox.address);
    });
    describe("Cross-domain admin functionality", () => {
      it("Can whitelist token on L2 from L1", async () => {
        // Double check the UMA collateral whitelist has the L1 token whitelisted.
        assert.isTrue(await l1CollateralWhitelist.isOnWhitelist(l1Token.address));

        // Token is not whitelisted before changing via bridge
        assert.isFalse(await l2BridgeDepositBox.isWhitelistToken(l2Token.address));

        // Wallet should have to tokens on L1 from the mint action and no tokens on L2.
        const adminTx = await l1BridgeAdmin.whitelistToken(
          l1Token.address, // L1 token.
          l2Token.address, // Associated L2 token.
          l1BridgePool.address,
          OPTIMISM_GAS_OPTS.gasLimit // L2Gas limit. set this to a large number, but less than gas limit, to ensure no L2 revert.
        );
        await waitForL1ToL2Transaction(adminTx, watcher);

        // Validate that on L2 the address has been whitelisted correctly.
        assert.isTrue(await l2BridgeDepositBox.isWhitelistToken(l2Token.address));
        assert.equal((await l2BridgeDepositBox.whitelistedTokens(l2Token.address)).l1Token, l1Token.address);
        assert.equal((await l2BridgeDepositBox.whitelistedTokens(l2Token.address)).l1BridgePool, l1BridgePool.address);
        assert.equal((await l2BridgeDepositBox.whitelistedTokens(l2Token.address)).depositsEnabled, true);
        assert.equal(
          (await l2BridgeDepositBox.whitelistedTokens(l2Token.address)).lastBridgeTime.toString(),
          (await l2Timer.getCurrentTime()).toString()
        );
      });
      it("Can change the bridge admin address", async () => {
        // Correct admin before the change.

        assert.equal(await l2BridgeDepositBox.bridgeAdmin(), l1BridgeAdmin.address);
        const bridgeAdminChangeTx = await l1BridgeAdmin.setBridgeAdmin(l1Wallet.address, OPTIMISM_GAS_OPTS.gasLimit);
        await waitForL1ToL2Transaction(bridgeAdminChangeTx, watcher);

        // Validate that on L2 the bridge admin has been changed correctly.
        assert.equal(await l2BridgeDepositBox.bridgeAdmin(), l1Wallet.address);
      });
      it("Can enable/disable deposits on L2", async () => {
        // Is enabled before the change.

        assert.isFalse((await l2BridgeDepositBox.whitelistedTokens(l2Token.address)).depositsEnabled);
        const adminTx = await l1BridgeAdmin.setEnableDeposits(l2Token.address, true, OPTIMISM_GAS_OPTS.gasLimit);
        await waitForL1ToL2Transaction(adminTx, watcher);

        // Validate that on L2 the deposits have been disabled.
        assert.isTrue((await l2BridgeDepositBox.whitelistedTokens(l2Token.address)).depositsEnabled);
      });
      it("Can update the L2 minimum bridging delay", async () => {
        // Correct min delay before the change.
        assert.equal(await l2BridgeDepositBox.minimumBridgingDelay(), minimumBridgingDelay);
        const adminTx = await l1BridgeAdmin.setMinimumBridgingDelay(420, OPTIMISM_GAS_OPTS.gasLimit);
        await waitForL1ToL2Transaction(adminTx, watcher);

        // Validate that on L2 the deposits have been disabled.
        assert.equal(await l2BridgeDepositBox.minimumBridgingDelay(), 420);
      });
    });

    describe("Cross-domain token bridging functionality", () => {
      beforeEach(async () => {
        // Enable deposits on L2.
        const adminTx = await l1BridgeAdmin.setEnableDeposits(l2Token.address, true, OPTIMISM_GAS_OPTS.gasLimit);
        await waitForL1ToL2Transaction(adminTx, watcher);

        // Whitelist the token on L2.
        const whitelistTx = await l1BridgeAdmin.whitelistToken(
          l1Token.address,
          l2Token.address,
          l1BridgePool.address,
          OPTIMISM_GAS_OPTS.gasLimit
        );
        await waitForL1ToL2Transaction(whitelistTx, watcher);

        // Mint some L1 tokens and bridge them over to L2 to seed the L2 wallet.
        await l1Token.mint(l1Wallet.address, depositAmount);
        await l1Token.approve(l1StandardBridge.address, depositAmount);
        const depositTx = await l1StandardBridge.depositERC20(
          l1Token.address,
          l2Token.address,
          depositAmount,
          2000000,
          "0x"
        );
        await waitForL1ToL2Transaction(depositTx, watcher);
      });
      it("Bridge deposit box correctly submits L2->L1 token transfers over the canonical bridge", async () => {
        // Validate that tokens deposited on L2 can correctly be sent over the canonical Optimism bridge.

        // Check tokens are in the wallet from the bridging action. Approve deposit box to pull the tokens.
        assert.equal((await l2Token.balanceOf(l2Wallet.address)).toString(), depositAmount.toString());
        await l2Token.approve(l2BridgeDepositBox.address, depositAmount);

        // Deposit funds on L2 and check validate the `FundsDeposited` event params. These are critical as this is the
        // information relayed cross - chain and is used to verify deposit info.
        const depositL2Time = await l2Timer.getCurrentTime();
        await expect(
          l2BridgeDepositBox.deposit(
            l1Wallet.address,
            l2Token.address,
            depositAmount,
            slowRelayFeePct,
            instantRelayFeePct,
            depositL2Time
          )
        )
          .to.emit(l2BridgeDepositBox, "FundsDeposited")
          .withArgs(
            "0", // depositId
            depositL2Time, // timestamp
            l2Wallet.address, // sender
            l2Wallet.address, // recipient
            l1Token.address, // l1Token
            depositAmount, // amount
            slowRelayFeePct, // slowRelayFeePct
            instantRelayFeePct, // instantRelayFeePct
            depositL2Time // quoteTimestamp
          );
        assert.equal((await l2Token.balanceOf(l2Wallet.address)).toString(), "0"); // no tokens left in the wallet.
        assert.equal((await l2Token.balanceOf(l2BridgeDepositBox.address)).toString(), depositAmount); // all tokens in box.

        // Cant bridge tokens until enough time has passed.
        await expect(l2BridgeDepositBox.bridgeTokens(l2Token.address, OPTIMISM_GAS_OPTS.gasLimit)).to.be.revertedWith(
          "not enough time has elapsed from previous bridge"
        );

        // Advance time to enable the bridging action.
        await l2Timer.setCurrentTime(Number(depositL2Time) + minimumBridgingDelay + 1);
        const bridgeDepositTx = await l2BridgeDepositBox.bridgeTokens(l2Token.address, OPTIMISM_GAS_OPTS.gasLimit);
        await waitForL2ToL1Transaction(bridgeDepositTx, watcher);

        // There should be no tokens left in the deposit box as they've been pulled by the bridge on the withdraw call.
        assert.equal((await l2Token.balanceOf(l2BridgeDepositBox.address)).toString(), "0");

        // The L1 pool should contain all of the bridged tokens.
        assert.equal((await l1Token.balanceOf(l1BridgePool.address)).toString(), depositAmount);
      });
      describe("Full lifecycle e2e test", () => {
        // This test takes the UMA bridging contracts through a full lifecycle including all key interactions. The
        // life cycle tests work for both slow and fast withdraw cases.Both of these have the same initial
        // setup: 1) add L1 liquidity. 2) user deposits on L2 3) relayer bridges action 4) finalization of bridge
        // Step 3 will either be just a slow relay or a sped up relay depending on the context of the test.

        beforeEach(async () => {
          // This test takes the UMA bridging contracts through a full lifecycle including all key interactions. To Run
          // these tests in a way that correctly mocks mainnet we stop the Optimism relayer to stop auto L2->L1
          // transaction. On L1 this relaying action will be done by one of the relayer bots, which are mocked here.

          // Step 1: Add liquidity on L1 and check the liquidity provider gets the expected number of LP tokens.
          await l1Token.mint(l1LiquidityProvider.address, liquidityProvided);
          await (await l1Token.deployed())
            .connect(l1LiquidityProvider)
            .approve(l1BridgePool.address, liquidityProvided);
          await (await l1BridgePool.deployed()).connect(l1LiquidityProvider).addLiquidity(liquidityProvided);

          // Pool should contain the full l1LiquidityProvider amount. LP should be credited with expected num of tokens.
          assert.equal((await l1Token.balanceOf(l1BridgePool.address)).toString(), liquidityProvided);
          assert.equal((await l1Token.balanceOf(l1LiquidityProvider.address)).toString(), "0");
          assert.equal((await l1BridgePool.balanceOf(l1LiquidityProvider.address)).toString(), liquidityProvided);

          // Step 2: L2 User deposits funds into the deposit box.
          assert.equal((await l2Token.balanceOf(l2Wallet.address)).toString(), depositAmount.toString()); // Balance before is expected size.
          await l2Token.approve(l2BridgeDepositBox.address, depositAmount);

          const depositL2Time = await l2Timer.getCurrentTime();
          const depositTx = await l2BridgeDepositBox.deposit(
            l1Wallet.address,
            l2Token.address,
            depositAmount,
            slowRelayFeePct,
            instantRelayFeePct,
            depositL2Time
          );

          const depositReceipt = await depositTx.wait();
          // Check all tokens sent from L2Wallet and are in the deposit Box.
          assert.equal((await l2Token.balanceOf(l2Wallet.address)).toString(), "0");
          assert.equal((await l2Token.balanceOf(l2BridgeDepositBox.address)).toString(), depositAmount);

          // Step 3: Relayer makes a claim to the bridge pool for the deposit information from the deposit event. For this
          // the liquidityProvider will be acting as the relayer. Mint and approve enough for the proposer bond. Propose
          // bond is 10%. Deposit amount is 10 so deposit bond should be 1 l1Token. As this call both requests a price
          // and proposes one we will need to set mint and approve 2 tokens for the reward and bond.
          // TODO: consider if we should change this behaviour. perhaps the reward should be 0 to make the cost of this
          // call equal to the bond.

          const bondAmount = ethers.utils.parseEther("2");
          await l1Token.mint(l1LiquidityProvider.address, bondAmount);
          await (await l1Token.deployed()).connect(l1LiquidityProvider).approve(l1BridgePool.address, bondAmount);

          const relayTx = await (await l1BridgePool.deployed())
            .connect(l1LiquidityProvider)
            .relayDeposit(
              depositReceipt.events[1].args.depositId.toString(),
              depositReceipt.events[1].args.timestamp.toString(),
              depositReceipt.events[1].args.recipient,
              depositReceipt.events[1].args.sender,
              depositReceipt.events[1].args.amount.toString(),
              depositReceipt.events[1].args.slowRelayFeePct.toString(),
              depositReceipt.events[1].args.instantRelayFeePct.toString(),
              depositReceipt.events[1].args.quoteTimestamp.toString(),
              realizedLpFee.toString()
            );
          await relayTx.wait();

          // Step 4: finalize the relay action. This should pay out all participants accordingly.
          assert.equal((await l1Token.balanceOf(l1Wallet.address)).toString(), "0"); // Should have no tokens before

          depositData = {
            depositId: depositReceipt.events[1].args.depositId.toString(),
            depositTimestamp: depositReceipt.events[1].args.timestamp.toString(),
            l2Sender: depositReceipt.events[1].args.sender,
            recipient: depositReceipt.events[1].args.recipient,
            l1Token: l1Token.address,
            amount: depositReceipt.events[1].args.amount.toString(),
            slowRelayFeePct: depositReceipt.events[1].args.slowRelayFeePct.toString(),
            instantRelayFeePct: depositReceipt.events[1].args.instantRelayFeePct.toString(),
            quoteTimestamp: depositReceipt.events[1].args.quoteTimestamp.toString(),
          };

          // Advance time a little bit (not past OO liveness). Should not be able to finalize the bridging action.
          await l1Timer.setCurrentTime(Number(await l1Timer.getCurrentTime()) + optimisticOracleLiveness / 2);
          await expect(l1BridgePool.settleRelay(depositData)).to.be.revertedWith("Price not yet resolved");
        });
        let relayerBalanceAfterTest;
        it("Slow relay", async () => {
          // Advance time until after the liveness and try settle again.
          await l1Timer.setCurrentTime(Number(await l1Timer.getCurrentTime()) + optimisticOracleLiveness / 2);
          await l1BridgePool.settleRelay(depositData);

          // l1Wallet should have 10 tokens - 10% LP fee - 1% relayer fee - 8.9 tokens.
          assert.equal((await l1Token.balanceOf(l1Wallet.address)).toString(), ethers.utils.parseEther("8.9"));

          // Bridge pool balance should be 100 minus bridge amount + LP fee 100-10+1=91
          assert.equal((await l1Token.balanceOf(l1BridgePool.address)).toString(), ethers.utils.parseEther("91"));

          // The relayer should receive the relay reward of 1% of 10 tokens or 0.1 tokens. Store this for later
          relayerBalanceAfterTest = ethers.utils.parseEther("0.1");
          assert.equal(
            (await l1Token.balanceOf(l1LiquidityProvider.address)).toString(),
            relayerBalanceAfterTest.toString()
          );
        });
        it("instant relay", async () => {
          // At the end of the before each block we advanced time half way through the OO liveness (1 hour). Now we will
          // try to speed up the relay then settle.Use the liquidity provider as fast relayer.
          // Mint the Liquidity provider enough for the speed up. this is equal to the exact amount the recipient will
          // get as the bridged amount - the LP fee, - slow relay fee, - instant relay fee equalling 10-1-0.1-0.1=8.8

          const instantRelayerAmount = ethers.utils.parseEther("8.8");
          await l1Token.mint(l1LiquidityProvider.address, instantRelayerAmount);
          await (await l1Token.deployed())
            .connect(l1LiquidityProvider)
            .approve(l1BridgePool.address, instantRelayerAmount);
          const relayTx = await (await l1BridgePool.deployed()).connect(l1LiquidityProvider).speedUpRelay(depositData);
          relayTx.wait();
          assert.equal((await l1Token.balanceOf(l1LiquidityProvider.address)).toString(), "0");

          // After the relay is sped up the recipient should be immediately paid out. The amount was calculated above.
          assert.equal((await l1Token.balanceOf(l1Wallet.address)).toString(), instantRelayerAmount);

          // As no time has advanced from the relay settlement time the exchange rate on the pool should still be 1.
          assert.equal((await l1BridgePool.callStatic.exchangeRateCurrent()).toString(), ethers.utils.parseEther("1"));

          // Advance the time until after liveness and settle.
          await l1Timer.setCurrentTime(Number(await l1Timer.getCurrentTime()) + optimisticOracleLiveness / 2);
          await l1BridgePool.settleRelay(depositData);

          // The recipients balance should not have changed (they were paid out when the relay was sped up).
          assert.equal(
            (await l1Token.balanceOf(l1Wallet.address)).toString(),
            ethers.utils.parseEther("8.8").toString()
          );

          // Bridge pool balance should be 100 minus bridge amount + LP fee 100-10+1=91
          assert.equal(
            (await l1Token.balanceOf(l1BridgePool.address)).toString(),
            ethers.utils.parseEther("91").toString()
          );

          // The relayer should receive the slow relay reward of 1%, instant relay reward of 1% full instantRelayerAmount
          // i.e this should be 8.8+0.1+0.1=9. Set this in a variable to use after the test.
          relayerBalanceAfterTest = ethers.utils.parseEther("9");
          assert.equal(
            (await l1Token.balanceOf(l1LiquidityProvider.address)).toString(),
            relayerBalanceAfterTest.toString()
          );
        });
        // After the instant and slow specific tests we can validate some common outputs between the two mode. In
        // particular, validate exchange rates and token bridging actions.
        afterEach(async () => {
          // Pending LP fees should be updated accordingly to 10% of 10.
          assert.equal((await l1BridgePool.undistributedLpFees()).toString(), ethers.utils.parseEther("1").toString());

          // As no time has advanced from the relay settlement time the exchange rate on the pool should still be 1.
          assert.equal(
            (await l1BridgePool.callStatic.exchangeRateCurrent()).toString(),
            ethers.utils.parseEther("1").toString()
          );

          // Advance some time and check that the exchange rate increments as expected. By adding 2 days (172800s) we
          // should expect 172800 * 0.0000015 * 1 = 0.2592 fees to accumulate resulting in an exchange rate of
          // (100 + 0.2592)/100 = 1.002592
          await l1Timer.setCurrentTime(Number(await l1Timer.getCurrentTime()) + 172800);
          assert.equal(
            (await l1BridgePool.callStatic.exchangeRateCurrent()).toString(),
            ethers.utils.parseEther("1.002592").toString()
          );

          // Advance time by a lot (say 100 days). After this, all fees should be accumulated in the exchange
          // rate as (100 + 1)/100 = 1.01
          await l1Timer.setCurrentTime(Number(await l1Timer.getCurrentTime()) + 8640000);
          assert.equal(
            (await l1BridgePool.callStatic.exchangeRateCurrent()).toString(),
            ethers.utils.parseEther("1.01").toString()
          );

          // Finally, settle the L2->L1 Token transfers.

          await l2Timer.setCurrentTime(await l1Timer.getCurrentTime()); // sync cross-chain timers

          const bridgeTokensTx = await l2BridgeDepositBox.bridgeTokens(l2Token.address, 1_000_000);
          await waitForL2ToL1Transaction(bridgeTokensTx, watcher);

          // There should be no tokens left in the deposit box (all bridged).
          assert.equal((await l2Token.balanceOf(l2BridgeDepositBox.address)).toString(), "0");

          // The pool balance should equal the initial liquidity of 100 + the 10% fee of 10 equalling 101 tokens.

          assert.equal(
            (await l1Token.balanceOf(l1BridgePool.address)).toString(),
            ethers.utils.parseEther("101").toString()
          );

          // Finally, if the LP redeems all their LP tokens they should get back their initial liquidity + LP fee + the
          // associated relayer fee. relayerBalanceAfterTest represents the relayer balance after the previous test
          // before any liquidity has been removed. in the slow case this is 0.1 (slow relay reward). in the fast
          // relay case this is 9 (slow relay reward + fast relay reward + instant bridged amount).
          await (await l1BridgePool.deployed()).connect(l1LiquidityProvider).removeLiquidity(liquidityProvided);
          assert.equal(
            (await l1Token.balanceOf(l1BridgePool.address)).toString(),
            ethers.utils.parseEther("0").toString()
          );

          assert.equal(
            (await l1Token.balanceOf(l1LiquidityProvider.address)).toString(),
            ethers.utils.parseEther("101").add(relayerBalanceAfterTest).toString()
          );
        });
      });
    });
  });
});

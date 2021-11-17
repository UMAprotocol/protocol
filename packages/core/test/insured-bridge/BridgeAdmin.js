const { assert } = require("chai");
const hre = require("hardhat");
const { web3 } = hre;
const { didContractThrow, interfaceName, ZERO_ADDRESS } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { hexToUtf8, utf8ToHex, toWei } = web3.utils;

// Tested contracts
const MessengerMock = getContract("MessengerMock");
const BridgeAdmin = getContract("BridgeAdmin");
const BridgePool = getContract("BridgePool");
const Timer = getContract("Timer");
const Store = getContract("Store");
const Finder = getContract("Finder");
const BridgeDepositBox = getContract("BridgeDepositBoxMock");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const ERC20 = getContract("ERC20");

// Contract objects
let messenger;
let bridgeAdmin;
let finder;
let store;
let depositBox;
let identifierWhitelist;
let collateralWhitelist;
let timer;

// Test function inputs
const defaultGasLimit = 1_000_000;
const defaultGasPrice = toWei("1", "gwei");
const defaultL1CallValue = 10_000_000_000;
const maxSubmissionCost = 10_000_000_000;
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 7200;
const defaultProposerBondPct = toWei("0.05");
const lpFeeRatePerSecond = toWei("0.0000015");
const defaultBridgingDelay = 60;
const chainId = "111";
let l1Token;
let l2Token;
let bridgePool;

describe("BridgeAdmin", () => {
  let accounts, owner, rando, rando2, depositBoxImpersonator;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando, rando2, depositBoxImpersonator] = accounts;
    l1Token = await ERC20.new("", "").send({ from: owner });
    l2Token = rando2;
    finder = await Finder.new().send({ from: owner });
    collateralWhitelist = await AddressWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: owner });

    identifierWhitelist = await IdentifierWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: owner });
    timer = await Timer.new().send({ from: owner });
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: owner });

    // The initialization of the bridge pool requires there to be an address of both the store and the SkinnyOptimisticOracle
    // set in the finder. These tests dont use these contracts but there are never the less needed for deployment.
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: owner });
    await store.methods.setFinalFee(l1Token.options.address, { rawValue: toWei("1") }).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.SkinnyOptimisticOracle), rando)
      .send({ from: owner });
  });
  beforeEach(async function () {
    messenger = await MessengerMock.new().send({ from: owner });

    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: owner });

    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      false,
      timer.options.address
    ).send({ from: owner });

    depositBox = await BridgeDepositBox.new(
      bridgeAdmin.options.address,
      defaultBridgingDelay,
      ZERO_ADDRESS, // weth address. Weth mode not used in these tests
      ZERO_ADDRESS // timer address
    ).send({ from: owner });
  });
  describe("Admin functions", () => {
    it("Set deposit contracts", async () => {
      const newDepositContract = rando;
      const newMessengerContract = rando2;
      assert(
        await didContractThrow(
          bridgeAdmin.methods
            .setDepositContract(chainId, newDepositContract, newMessengerContract)
            .send({ from: rando })
        ),
        "OnlyOwner modifier not enforced"
      );
      assert(
        await didContractThrow(
          bridgeAdmin.methods.setDepositContract(chainId, ZERO_ADDRESS, newMessengerContract).send({ from: owner })
        ),
        "Can't set deposit contract to 0x address"
      );
      assert(
        await didContractThrow(
          bridgeAdmin.methods.setDepositContract(chainId, newDepositContract, ZERO_ADDRESS).send({ from: owner })
        ),
        "Can't set messenger contract to 0x address"
      );
      const txn = await bridgeAdmin.methods
        .setDepositContract(chainId, newDepositContract, newMessengerContract)
        .send({ from: owner });
      await assertEventEmitted(txn, bridgeAdmin, "SetDepositContracts", (ev) => {
        return (
          ev.chainId === chainId &&
          ev.l2DepositContract === newDepositContract &&
          ev.l2MessengerContract === newMessengerContract
        );
      });
      const newlySetDepositContracts = await bridgeAdmin.methods.depositContracts(chainId).call();
      assert.equal(newlySetDepositContracts.depositContract, newDepositContract);
      assert.equal(newlySetDepositContracts.messengerContract, newMessengerContract);
    });
    it("Set relay identifier", async () => {
      const newIdentifier = utf8ToHex("NEW_IDENTIFIER");
      assert(
        await didContractThrow(bridgeAdmin.methods.setIdentifier(newIdentifier).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );
      assert(
        await didContractThrow(bridgeAdmin.methods.setIdentifier(newIdentifier).send({ from: owner })),
        "Identifier must be whitelisted"
      );
      await identifierWhitelist.methods.addSupportedIdentifier(newIdentifier).send({ from: owner });
      const txn = await bridgeAdmin.methods.setIdentifier(newIdentifier).send({ from: owner });
      await assertEventEmitted(txn, bridgeAdmin, "SetRelayIdentifier", (ev) => {
        return hexToUtf8(ev.identifier) === hexToUtf8(newIdentifier);
      });
      assert.equal(hexToUtf8(await bridgeAdmin.methods.identifier().call()), hexToUtf8(newIdentifier));
    });
    it("Set optimistic oracle liveness", async () => {
      const newLiveness = 100;
      assert(
        await didContractThrow(bridgeAdmin.methods.setOptimisticOracleLiveness(newLiveness).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );

      // Liveness too large, must be less than a 5200 weeks.
      assert(
        await didContractThrow(
          bridgeAdmin.methods.setOptimisticOracleLiveness(5200 * 7 * 24 * 60 * 60).send({ from: owner })
        )
      );

      // Liveness too small, must be positive.
      assert(await didContractThrow(bridgeAdmin.methods.setOptimisticOracleLiveness("0").send({ from: owner })));

      const txn = await bridgeAdmin.methods.setOptimisticOracleLiveness(newLiveness).send({ from: owner });
      await assertEventEmitted(txn, bridgeAdmin, "SetOptimisticOracleLiveness", (ev) => {
        return ev.liveness.toString() === newLiveness.toString();
      });
      assert.equal((await bridgeAdmin.methods.optimisticOracleLiveness().call()).toString(), newLiveness.toString());
    });
    it("Set proposer bond", async () => {
      const newBond = toWei("0.1");
      assert(
        await didContractThrow(bridgeAdmin.methods.setProposerBondPct(newBond).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );

      const txn = await bridgeAdmin.methods.setProposerBondPct(newBond).send({ from: owner });
      await assertEventEmitted(txn, bridgeAdmin, "SetProposerBondPct", (ev) => {
        return ev.proposerBondPct.toString() === newBond.toString();
      });
      assert.equal((await bridgeAdmin.methods.proposerBondPct().call()).toString(), newBond.toString());
    });
    it("Transfer ownership of pool admins", async () => {
      assert(
        await didContractThrow(
          bridgeAdmin.methods.transferBridgePoolAdmin([bridgePool.options.address], rando).send({ from: rando })
        ),
        "OnlyOwner modifier not enforced"
      );

      // Create a temp bridgePool.
      const bridgePool2 = await BridgePool.new(
        "LP Token2",
        "LPT2",
        bridgeAdmin.options.address,
        l1Token.options.address,
        lpFeeRatePerSecond,
        false,
        timer.options.address
      ).send({ from: owner });

      assert.equal(await bridgePool.methods.bridgeAdmin().call(), bridgeAdmin.options.address);

      const transferAdminTxn = await bridgeAdmin.methods
        .transferBridgePoolAdmin([bridgePool.options.address, bridgePool2.options.address], owner)
        .send({ from: owner });

      // Check for L1 logs and state change

      await assertEventEmitted(transferAdminTxn, bridgeAdmin, "BridgePoolsAdminTransferred", (ev) => {
        return (
          ev.bridgePools.length == 2 &&
          ev.bridgePools[0] == bridgePool.options.address &&
          ev.bridgePools[1] == bridgePool2.options.address &&
          ev.newAdmin == owner
        );
      });

      // Both bridge pools should now have the new owner.
      assert.equal(await bridgePool.methods.bridgeAdmin().call(), owner);
      assert.equal(await bridgePool2.methods.bridgeAdmin().call(), owner);
    });
    it("Set LP fee rate %/second", async () => {
      const newRate = toWei("0.0000025");
      assert(
        await didContractThrow(
          bridgeAdmin.methods.changeLpFeeRatePerSecond(bridgePool.options.address, newRate).send({ from: rando })
        ),
        "OnlyOwner modifier not enforced"
      );

      const txn = await bridgeAdmin.methods
        .changeLpFeeRatePerSecond(bridgePool.options.address, newRate)
        .send({ from: owner });

      // Check for L1 logs and state change

      await assertEventEmitted(txn, bridgeAdmin, "ChangedLpFeeRate", (ev) => {
        return ev.bridgePool == bridgePool.options.address && ev.newLpFeeRatePerSecond.toString() == newRate;
      });
      assert.equal(await bridgePool.methods.lpFeeRatePerSecond().call(), newRate);
    });
    describe("Cross domain Admin functions", () => {
      describe("Whitelist tokens", () => {
        it("Basic checks", async () => {
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .whitelistToken(
                  chainId,
                  l1Token.options.address,
                  l2Token,
                  bridgePool.options.address,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: rando, value: defaultL1CallValue })
            ),
            "OnlyOwner modifier not enforced"
          );

          // Fails if depositContracts not set in BridgeRouter
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .whitelistToken(
                  chainId,
                  l1Token.options.address,
                  l2Token,
                  bridgePool.options.address,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner, value: defaultL1CallValue })
            ),
            "Deposit contract not set"
          );
          await bridgeAdmin.methods
            .setDepositContract(chainId, depositBoxImpersonator, messenger.options.address)
            .send({ from: owner });

          // Fails if l1 token is not whitelisted
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .whitelistToken(
                  chainId,
                  l1Token.options.address,
                  l2Token,
                  bridgePool.options.address,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner, value: defaultL1CallValue })
            ),
            "L1 token is not whitelisted collateral"
          );
          await collateralWhitelist.methods.addToWhitelist(l1Token.options.address).send({ from: owner });

          // Fails if l2 token address is invalid
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .whitelistToken(
                  chainId,
                  l1Token.options.address,
                  ZERO_ADDRESS,
                  bridgePool.options.address,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner, value: defaultL1CallValue })
            ),
            "L2 token cannot be zero address"
          );

          // Fails if bridge pool is zero address.
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .whitelistToken(
                  chainId,
                  l1Token.options.address,
                  l2Token,
                  ZERO_ADDRESS,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner, value: defaultL1CallValue })
            ),
            "BridgePool cannot be zero address"
          );

          // Fails if msg.value != defaultL1CallValue.
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .whitelistToken(
                  chainId,
                  l1Token.options.address,
                  l2Token,
                  bridgePool.options.address,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner })
            ),
            "msg.value != defaultL1CallValue"
          );

          // Works if msg.value = 0 and defaultL1CallValue = 0
          assert.ok(
            await bridgeAdmin.methods
              .whitelistToken(
                chainId,
                l1Token.options.address,
                l2Token,
                bridgePool.options.address,
                0,
                defaultGasLimit,
                defaultGasPrice,
                maxSubmissionCost
              )
              .call({ from: owner })
          );

          // Successful call
          await bridgeAdmin.methods
            .whitelistToken(
              chainId,
              l1Token.options.address,
              l2Token,
              bridgePool.options.address,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });

          // Messenger should receive msg.value.
          assert.equal((await web3.eth.getBalance(messenger.options.address)).toString(), defaultL1CallValue);

          const tokenMapping = await bridgeAdmin.methods.whitelistedTokens(l1Token.options.address, chainId).call();
          assert.isTrue(
            tokenMapping.l2Token === l2Token && tokenMapping.bridgePool === bridgePool.options.address,
            "Token mapping not created correctly"
          );
        });
        it("Add token mapping on L1 and sends xchain message", async () => {
          await bridgeAdmin.methods
            .setDepositContract(chainId, depositBoxImpersonator, messenger.options.address)
            .send({ from: owner });
          await collateralWhitelist.methods.addToWhitelist(l1Token.options.address).send({ from: owner });
          const whitelistTxn = await bridgeAdmin.methods
            .whitelistToken(
              chainId,
              l1Token.options.address,
              l2Token,
              bridgePool.options.address,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });

          // Check for L1 logs and state change
          await assertEventEmitted(whitelistTxn, bridgeAdmin, "WhitelistToken", (ev) => {
            return (
              ev.chainId === chainId &&
              ev.l1Token === l1Token.options.address &&
              ev.l2Token === l2Token &&
              ev.bridgePool === bridgePool.options.address
            );
          });
          const tokenMapping = await bridgeAdmin.methods.whitelistedTokens(l1Token.options.address, chainId).call();
          assert.isTrue(
            tokenMapping.l2Token === l2Token && tokenMapping.bridgePool === bridgePool.options.address,
            "Token mapping not created correctly"
          );

          // Validate xchain message
          const expectedAbiData = depositBox.methods
            .whitelistToken(l1Token.options.address, l2Token, bridgePool.options.address)
            .encodeABI();
          await assertEventEmitted(whitelistTxn, messenger, "RelayedMessage", (ev) => {
            return (
              ev.target === depositBoxImpersonator &&
              ev.gasLimit === defaultGasLimit.toString() &&
              ev.gasPrice === defaultGasPrice &&
              ev.message === expectedAbiData
            );
          });
        });
        it("Can whitelist multiple L2 tokens for one L1 token and bridgePool pair", async () => {
          await bridgeAdmin.methods
            .setDepositContract(chainId, depositBoxImpersonator, messenger.options.address)
            .send({ from: owner });
          await collateralWhitelist.methods.addToWhitelist(l1Token.options.address).send({ from: owner });

          // Whitelist multiple L2 tokens for the one L1 tokens and bridge pool.
          await bridgeAdmin.methods
            .whitelistToken(
              chainId,
              l1Token.options.address,
              l2Token,
              bridgePool.options.address,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });
          // Create a new L2 token address to mock being having this pool serve multiple L2s. EG USDC on Arbitrum and
          // Optimism. This will have the same L1 bridge pool, multiple L2Tokens and bridge deposit boxes (for each L2).
          // use a fake address to pretend to be the depositBoxImpersonator for the second chainId
          const l2Token2 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
          const chainId2 = chainId + 1;
          const depositBoxImpersonator2 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

          await bridgeAdmin.methods
            .setDepositContract(chainId2, depositBoxImpersonator2, messenger.options.address)
            .send({ from: owner });

          await bridgeAdmin.methods
            .whitelistToken(
              chainId2,
              l1Token.options.address,
              l2Token2,
              bridgePool.options.address,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });
          const tokenMapping1 = await bridgeAdmin.methods.whitelistedTokens(l1Token.options.address, chainId).call();
          assert.isTrue(
            tokenMapping1.l2Token === l2Token && tokenMapping1.bridgePool === bridgePool.options.address,
            "Token mapping not created correctly"
          );

          const tokenMapping2 = await bridgeAdmin.methods.whitelistedTokens(l1Token.options.address, chainId2).call();
          assert.isTrue(
            tokenMapping2.l2Token === l2Token2 && tokenMapping2.bridgePool === bridgePool.options.address,
            "Token mapping not created correctly"
          );
        });
        it("Can use whitelist to update the address of the bridge pool on L2 for a given deposit box", async () => {
          // The whitelistToken method has a secondary function in providing the ability to update the address of the
          // bridge pool for a given L2 chain by re-whitelisting the same L2 token with a new bridge pool address.
          await bridgeAdmin.methods
            .setDepositContract(chainId, depositBoxImpersonator, messenger.options.address)
            .send({ from: owner });
          await collateralWhitelist.methods.addToWhitelist(l1Token.options.address).send({ from: owner });

          // Whitelist multiple L2 tokens for the one L1 tokens and bridge pool.
          await bridgeAdmin.methods
            .whitelistToken(
              chainId,
              l1Token.options.address,
              l2Token,
              bridgePool.options.address,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });

          // Now consider the case where we have change the address of the bridge pool on L1 due to an upgrade. We now
          // need to send messages to each L2 deposit box to update this address. Create a new fake bridgePool and re
          // whitelist the same l1Token/l2Token pair on the new pool address.
          const bridgePool2 = await BridgePool.new(
            "LP Token2",
            "LPT2",
            bridgeAdmin.options.address,
            l1Token.options.address,
            lpFeeRatePerSecond,
            false,
            timer.options.address
          ).send({ from: owner });
          const whitelistTxn = await bridgeAdmin.methods
            .whitelistToken(
              chainId,
              l1Token.options.address,
              l2Token,
              bridgePool2.options.address,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });

          // After this whitelist call the address in the bridge admin should have been updated as expected and the
          // messenger should have sent the call to update the latest bridgePool.
          const tokenMapping = await bridgeAdmin.methods.whitelistedTokens(l1Token.options.address, chainId).call();
          assert.isTrue(
            tokenMapping.l2Token === l2Token && tokenMapping.bridgePool === bridgePool2.options.address,
            "Token mapping not created correctly"
          );

          // Validate xchain message correctly updates to the new bridgePool2 address
          const expectedAbiData = depositBox.methods
            .whitelistToken(l1Token.options.address, l2Token, bridgePool2.options.address)
            .encodeABI();
          await assertEventEmitted(whitelistTxn, messenger, "RelayedMessage", (ev) => {
            return (
              ev.target === depositBoxImpersonator &&
              ev.gasLimit === defaultGasLimit.toString() &&
              ev.gasPrice === defaultGasPrice &&
              ev.message === expectedAbiData
            );
          });
        });
      });
      describe("Set bridge admin", () => {
        it("Basic checks", async () => {
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .setCrossDomainAdmin(
                  chainId,
                  rando,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: rando, value: defaultL1CallValue })
            ),
            "OnlyOwner modifier not enforced"
          );

          // Fails if depositContract not set in BridgeRouter
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .setCrossDomainAdmin(
                  chainId,
                  rando,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner, value: defaultL1CallValue })
            ),
            "Deposit contract not set"
          );
          await bridgeAdmin.methods
            .setDepositContract(chainId, depositBoxImpersonator, messenger.options.address)
            .send({ from: owner });

          // Admin cannot be 0x0
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .setCrossDomainAdmin(
                  chainId,
                  ZERO_ADDRESS,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner, value: defaultL1CallValue })
            ),
            "Cannot set to 0 address"
          );

          // Fails if msg.value != defaultL1CallValue.
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .setCrossDomainAdmin(
                  chainId,
                  rando,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner })
            ),
            "msg.value != defaultL1CallValue"
          );

          // Works if msg.value = 0 and defaultL1CallValue = 0
          assert.ok(
            await bridgeAdmin.methods
              .setCrossDomainAdmin(chainId, rando, 0, defaultGasLimit, defaultGasPrice, maxSubmissionCost)
              .call({ from: owner })
          );

          // Successful call
          await bridgeAdmin.methods
            .setCrossDomainAdmin(
              chainId,
              rando,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });

          // Messenger should receive msg.value.
          assert.equal((await web3.eth.getBalance(messenger.options.address)).toString(), defaultL1CallValue);
        });
        it("Changes admin address", async () => {
          await bridgeAdmin.methods
            .setDepositContract(chainId, depositBoxImpersonator, messenger.options.address)
            .send({ from: owner });
          const setAdminTxn = await bridgeAdmin.methods
            .setCrossDomainAdmin(
              chainId,
              rando,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });

          // Check for L1 logs and state change
          await assertEventEmitted(setAdminTxn, bridgeAdmin, "SetCrossDomainAdmin", (ev) => {
            return ev.newAdmin === rando && ev.chainId === chainId;
          });

          // Validate xchain message
          const expectedAbiData = depositBox.methods.setCrossDomainAdmin(rando).encodeABI();
          await assertEventEmitted(setAdminTxn, messenger, "RelayedMessage", (ev) => {
            return (
              ev.target === depositBoxImpersonator &&
              ev.gasLimit === defaultGasLimit.toString() &&
              ev.gasPrice === defaultGasPrice &&
              ev.message === expectedAbiData
            );
          });
        });
      });
      describe("Set minimum bridge delay", () => {
        it("Basic checks", async () => {
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .setMinimumBridgingDelay(
                  chainId,
                  defaultBridgingDelay,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: rando, value: defaultL1CallValue })
            ),
            "OnlyOwner modifier not enforced"
          );

          // Fails if depositContract not set in BridgeRouter
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .setMinimumBridgingDelay(
                  chainId,
                  defaultBridgingDelay,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner, value: defaultL1CallValue })
            ),
            "Deposit contract not set"
          );
          await bridgeAdmin.methods
            .setDepositContract(chainId, depositBoxImpersonator, messenger.options.address)
            .send({ from: owner });

          // Fails if msg.value != defaultL1CallValue.
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .setMinimumBridgingDelay(
                  chainId,
                  defaultBridgingDelay,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner })
            ),
            "msg.value != defaultL1CallValue"
          );

          // Works if msg.value = 0 and defaultL1CallValue = 0
          assert.ok(
            await bridgeAdmin.methods
              .setMinimumBridgingDelay(
                chainId,
                defaultBridgingDelay,
                0,
                defaultGasLimit,
                defaultGasPrice,
                maxSubmissionCost
              )
              .call({ from: owner })
          );

          // Successful call
          await bridgeAdmin.methods
            .setMinimumBridgingDelay(
              chainId,
              defaultBridgingDelay,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });

          // Messenger should receive msg.value.
          assert.equal((await web3.eth.getBalance(messenger.options.address)).toString(), defaultL1CallValue);
        });
        it("Sets delay", async () => {
          await bridgeAdmin.methods
            .setDepositContract(chainId, depositBoxImpersonator, messenger.options.address)
            .send({ from: owner });
          const setDelayTxn = await bridgeAdmin.methods
            .setMinimumBridgingDelay(
              chainId,
              defaultBridgingDelay,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });

          // Check for L1 logs and state change
          await assertEventEmitted(setDelayTxn, bridgeAdmin, "SetMinimumBridgingDelay", (ev) => {
            return ev.newMinimumBridgingDelay.toString() === defaultBridgingDelay.toString() && ev.chainId === chainId;
          });

          // Validate xchain message
          const expectedAbiData = depositBox.methods.setMinimumBridgingDelay(defaultBridgingDelay).encodeABI();
          await assertEventEmitted(setDelayTxn, messenger, "RelayedMessage", (ev) => {
            return (
              ev.target === depositBoxImpersonator &&
              ev.gasLimit === defaultGasLimit.toString() &&
              ev.gasPrice === defaultGasPrice &&
              ev.message === expectedAbiData
            );
          });
        });
      });
      describe("Pause deposits", () => {
        it("Basic checks", async () => {
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .setEnableDeposits(
                  chainId,
                  l2Token,
                  false,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: rando, value: defaultL1CallValue })
            ),
            "OnlyOwner modifier not enforced"
          );

          // Fails if depositContract not set in BridgeRouter
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .setEnableDeposits(
                  chainId,
                  l2Token,
                  false,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner, value: defaultL1CallValue })
            ),
            "Deposit contract not set"
          );
          await bridgeAdmin.methods
            .setDepositContract(chainId, depositBoxImpersonator, messenger.options.address)
            .send({ from: owner });

          // Fails if msg.value != defaultL1CallValue.
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .setEnableDeposits(
                  chainId,
                  l2Token,
                  false,
                  defaultL1CallValue,
                  defaultGasLimit,
                  defaultGasPrice,
                  maxSubmissionCost
                )
                .send({ from: owner })
            ),
            "msg.value != defaultL1CallValue"
          );

          // Works if msg.value = 0 and defaultL1CallValue = 0
          assert.ok(
            await bridgeAdmin.methods
              .setEnableDeposits(chainId, l2Token, false, 0, defaultGasLimit, defaultGasPrice, maxSubmissionCost)
              .call({ from: owner })
          );

          // Successful call
          await bridgeAdmin.methods
            .setEnableDeposits(
              chainId,
              l2Token,
              false,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });

          // Messenger should receive msg.value.
          assert.equal((await web3.eth.getBalance(messenger.options.address)).toString(), defaultL1CallValue);
        });
        it("Sets boolean value", async () => {
          await bridgeAdmin.methods
            .setDepositContract(chainId, depositBoxImpersonator, messenger.options.address)
            .send({ from: owner });
          const pauseTxn = await bridgeAdmin.methods
            .setEnableDeposits(
              chainId,
              l2Token,
              false,
              defaultL1CallValue,
              defaultGasLimit,
              defaultGasPrice,
              maxSubmissionCost
            )
            .send({ from: owner, value: defaultL1CallValue });

          // Check for L1 logs and state change
          await assertEventEmitted(pauseTxn, bridgeAdmin, "DepositsEnabled", (ev) => {
            return Boolean(ev.depositsEnabled) === false && ev.l2Token === l2Token && ev.chainId === chainId;
          });

          // Validate xchain message
          const expectedAbiData = depositBox.methods.setEnableDeposits(l2Token, false).encodeABI();
          await assertEventEmitted(pauseTxn, messenger, "RelayedMessage", (ev) => {
            return (
              ev.target === depositBoxImpersonator &&
              ev.gasLimit === defaultGasLimit.toString() &&
              ev.gasPrice === defaultGasPrice &&
              ev.message === expectedAbiData
            );
          });
        });
      });
    });
  });
});

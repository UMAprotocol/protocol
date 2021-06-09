const { assert } = require("chai");

const AncillaryDataTest = artifacts.require("AncillaryDataTest");
const { utf8ToHex } = web3.utils;

contract("AncillaryData", function () {
  let ancillaryDataTest;
  describe("nonReentrant and nonReentrant modifiers", function () {
    beforeEach(async function () {
      ancillaryDataTest = await AncillaryDataTest.new();
    });

    it("toUtf8Bytes", async function () {
      const utf8EncodedAddress = await ancillaryDataTest.toUtf8Bytes(ancillaryDataTest.address);
      assert.equal(
        utf8EncodedAddress,
        utf8ToHex(ancillaryDataTest.address.substr(2).toLowerCase()),
        "Should strip leading 0x and return in all lower case"
      );
    });

    it("toUtf8String", async function () {
      const utf8EncodedUint = await ancillaryDataTest.toUtf8String("31337");
      assert.equal(utf8EncodedUint, "31337");
    });

    it("appendAddressKey", async function () {
      let originalAncillaryData, appendedAncillaryData;
      const keyName = utf8ToHex("address");
      const value = ancillaryDataTest.address;
      const keyValueLengthBytes = 9 + 40; // "," + "address:" + <address> = 1 + 8 + 49 bytes.

      // Test 1: ancillary data is utf8 decodable:
      originalAncillaryData = utf8ToHex("key:value");
      assert.equal(
        await ancillaryDataTest.appendAddressKey(originalAncillaryData, keyName, value),
        utf8ToHex(`key:value,address:${value.substr(2).toLowerCase()}`),
        "Should append key:valueAddress to original ancillary data"
      );

      // Test 2: ancillary data is empty:
      originalAncillaryData = "0x";
      assert.equal(
        await ancillaryDataTest.appendAddressKey(originalAncillaryData, keyName, value),
        utf8ToHex(`address:${value.substr(2).toLowerCase()}`),
        "Should set key:valueAddress as ancillary data with no leading comma"
      );

      // Test 3: ancillary data is not utf8 decodeable:
      originalAncillaryData = "0xab";
      appendedAncillaryData = await ancillaryDataTest.appendAddressKey(originalAncillaryData, keyName, value);
      assert.equal(
        "0x" + appendedAncillaryData.substr(appendedAncillaryData.length - keyValueLengthBytes * 2),
        utf8ToHex(`,address:${value.substr(2).toLowerCase()}`),
        "Should be able to decode appended ancillary data after stripping out non-utf8 decodeable component"
      );

      // Test 4: ancillary data is utf8 decodeable but not key:value syntax:
      originalAncillaryData = utf8ToHex("ignore this syntax");
      assert.equal(
        await ancillaryDataTest.appendAddressKey(originalAncillaryData, keyName, value),
        utf8ToHex(`ignore this syntax,address:${value.substr(2).toLowerCase()}`),
        "Should be able to utf8-decode the entire ancillary data"
      );
    });
    it("appendChainId", async function () {
      // Test 1: Normal ancillary data
      let originalAncillaryData = utf8ToHex("key:value");
      assert.equal(
        await ancillaryDataTest.appendChainId(originalAncillaryData),
        utf8ToHex("key:value,chainId:31337"),
        "Should append chainId:<chainId> to original ancillary data"
      );

      // Test 2: Appended to address key
      let appendedAddressAncillaryData = await ancillaryDataTest.appendAddressKey(
        originalAncillaryData,
        utf8ToHex("address"),
        ancillaryDataTest.address
      );
      assert.equal(
        await ancillaryDataTest.appendChainId(appendedAddressAncillaryData),
        utf8ToHex(`key:value,address:${ancillaryDataTest.address.substr(2).toLowerCase()},chainId:31337`),
        "Should append chainId:<chainId> to address-appended ancillary data"
      );

      // Test 3: added after address key
      let appendedChainIdAncillaryData = await ancillaryDataTest.appendChainId(originalAncillaryData);
      assert.equal(
        await ancillaryDataTest.appendAddressKey(
          appendedChainIdAncillaryData,
          utf8ToHex("address"),
          ancillaryDataTest.address
        ),
        utf8ToHex(`key:value,chainId:31337,address:${ancillaryDataTest.address.substr(2).toLowerCase()}`),
        "Should append address key after chainId:<chainId>"
      );
    });
  });
});

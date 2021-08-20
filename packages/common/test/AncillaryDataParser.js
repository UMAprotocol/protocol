// Script to test
const AncillaryDataParser = require("../dist/AncillaryDataParser");

contract("AncillaryDataParser.js", function () {
  describe("parseAncillaryData", function () {
    it("parses SPACEXLAUNCH data correctly", async function () {
      // sample data
      const data = "0x6964303a537461726c696e6b2d31382c77303a312c6964313a537461726c696e6b2d31392c77313a31";
      const expectedObject = { id0: "Starlink-18", w0: 1, id1: "Starlink-19", w1: 1 };
      const parsedData = await AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData).toLowerCase(), JSON.stringify(expectedObject).toLowerCase());
    });
    it("parses KPI option example data correctly", async function () {
      // sample data
      const data =
        "0x4d65747269633a54564c20696e20554d412066696e616e6369616c20636f6e747261637473206d6561737572656420696e2062696c6c696f6e73206f66205553442c456e64706f696e743a2268747470733a2f2f6170692e756d6170726f6a6563742e6f72672f756d612d74766c222c4d6574686f643a2268747470733a2f2f6769746875622e636f6d2f554d4170726f746f636f6c2f554d4950732f626c6f622f6d61737465722f554d4950732f756d69702d36352e6d64222c4b65793a63757272656e7454766c2c496e74657276616c3a55706461746564206576657279203130206d696e757465732c526f756e64696e673a2d372c5363616c696e673a2d39";
      const expectedObject = {
        Metric: "TVL in UMA financial contracts measured in billions of USD",
        Endpoint: "https://api.umaproject.org/uma-tvl",
        Method: "https://github.com/UMAprotocol/UMIPs/blob/master/UMIPs/umip-65.md",
        Key: "currentTvl",
        Interval: "Updated every 10 minutes",
        Rounding: -7,
        Scaling: -9,
      };
      const parsedData = await AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData).toLowerCase(), JSON.stringify(expectedObject).toLowerCase());
    });
  });
});

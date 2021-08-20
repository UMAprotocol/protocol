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
  });
});

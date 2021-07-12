import assert from "assert";
import Client from "./zrx";

const baseUrl = "https://api.0x.org/";
describe("0x client", function () {
  let client: Client;
  it("should init", function () {
    client = new Client(baseUrl);
    assert.ok(client);
  });
  it("should get a price", async function () {
    const params = {
      sellToken: "WETH",
      // show we can use addresses as well
      buyToken: "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
      sellAmount: "1000000000000000000",
    };
    const result = await client.price(params);
    assert.ok(result.price);
  });
  it("should have a human readable error", async function () {
    const params = {
      sellToken: "WETH",
      buyToken: "DAI",
      // missing sellAmount or buyAmount
    };
    const errorMessage =
      "Bad Request(400): Validation Failed: should have required property 'sellAmount', should have required property 'buyAmount', should match exactly one schema in oneOf";
    assert.equal(await client.price(params).catch((e) => e.message), errorMessage);
  });
});

require("dotenv").config();
import * as uma from "@uma/sdk";
import assert from "assert";
import { ethers } from "ethers";
import Service from "./emp-state";
import type { AppState } from "../";
import { tables, Coingecko, utils, Multicall } from "@uma/sdk";
// this fixes usage of "this" as any
import type Mocha from "mocha";

type Dependencies = Pick<
  AppState,
  "registeredEmps" | "provider" | "emps" | "collateralAddresses" | "syntheticAddresses" | "multicall"
>;

const registeredEmps = [
  "0x592349F7DeDB2b75f9d4F194d4b7C16D82E507Dc",
  "0x3f2D9eDd9702909Cf1F8C4237B7c4c5931F9C944",
  "0x67DD35EaD67FcD184C8Ff6D0251DF4241F309ce1",
  "0x39450EB4f7DE57f2a25EeE548Ff392532cFB8759",
  "0xb56C5f1fB93b1Fbd7c473926c87B6B9c4d0e21d5",
  "0x4E3168Ea1082f3dda1694646B5EACdeb572009F1",
  "0xE1Ee8D4C5dBA1c221840c08f6Cf42154435B9D52",
  "0xc0b19570370478EDE5F2e922c5D31FAf1D5f90EA",
  "0xaBBee9fC7a882499162323EEB7BF6614193312e3",
  "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56",
  "0x306B19502c833C1522Fbc36C9dd7531Eda35862B",
  "0x1477C532A5054e0879EaFBD6004208c2065Bc21f",
  "0x3a93E863cb3adc5910E6cea4d51f132E8666654F",
  "0x516f595978D87B67401DaB7AfD8555c3d28a3Af4",
  "0xeFA41F506EAA5c24666d4eE40888bA18FA60a1c7",
  "0xC843538d70ee5d28C5A80A75bb94C28925bB1cf2",
  "0xf32219331A03D99C98Adf96D43cc312353003531",
  "0x4AA79c00240a2094Ff3fa6CF7c67f521f32D84a2",
  "0xECFE06574B4A23A6476AD1f2568166BD1857E7c5",
  "0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5",
  "0x1c3f1A342c8D9591D9759220d114C685FD1cF6b8",
  "0xEAA081a9fad4607CdF046fEA7D4BF3DfEf533282",
  "0x2E918f0F18A69CFda3333C146A81e8100C85D8B0",
  "0xfA3AA7EE08399A4cE0B4921c85AB7D645Ccac669",
  "0xCA44D9e1eB0b27A0B56CdbebF4198DE5C2e6F7D0",
  "0xa1005DB6516A097E562ad7506CF90ebb511f5604",
  "0x45c4DBD73294c5d8DDF6E5F949BE4C505E6E9495",
  "0xd6fc1A7327210b7Fe33Ef2514B44979719424A1d",
  "0xda0943251079eB9f517668fdB372fC6AE299D898",
  "0xf215778F3a5e7Ab6A832e71d87267Dd9a9aB0037",
  "0xeAddB6AD65dcA45aC3bB32f88324897270DA0387",
  "0x267D46e71764ABaa5a0dD45260f95D9c8d5b8195",
  "0xd81028a6fbAAaf604316F330b20D24bFbFd14478",
  "0x2862A798B3DeFc1C24b9c0d241BEaF044C45E585",
  "0x94C7cab26c04B76D9Ab6277a0960781b90f74294",
  "0x7c4090170aeADD54B1a0DbAC2C8D08719220A435",
  "0xaD3cceebeFfCdC3576dE56811d0A6D164BF9A5A1",
  "0xaB3Aa2768Ba6c5876B2552a6F9b70E54aa256175",
  "0x48546bDD57D34Cb110f011Cdd1CcaaE75Ee17a70",
  "0x182d5993106573A95a182AB3A77c892713fFDA56",
  "0xD50fbace72352C2e15E0986b8Ad2599627B5c340",
  "0x14a046c066266da6b8b8C4D2de4AfBEeCd53a262",
  "0x496B179D5821d1a8B6C875677e3B89a9229AAB77",
  "0x287a1bA52e030459F163f48b2Ae468a085003A07",
  "0x5A7f8F8B0E912BBF8525bc3fb2ae46E70Db9516B",
  "0x4F1424Cef6AcE40c0ae4fc64d74B734f1eAF153C",
  "0xb33E3b8f5a172776730B0945206D6f75a2491307",
  "0x4E2697b3deEc9Cac270Be97e254EC1a791588770",
  "0xCdf99b9acE35e6414d802E97ed75ecfEe99A6f62",
  "0xF796059731942aB6317E1bD5a8E98eF1f6D345b1",
  "0xdf739f0219fA1A9288fc4c790304c8a3E928544C",
  "0x9E929a85282fB0555C19Ed70942B952827Ca4B0B",
  "0x384e239a2B225865558774b005C3d6eC29f8cE70",
  "0x4E8d60A785c2636A63c5Bd47C7050d21266c8B43",
  "0x6618Ff5a7dcea49F1AADA3BaFde3e87fe28D1303",
  "0x964Be01cCe200e168c4ba960a764cBEBa8C01200",
  "0x9bB1f39b6DB45BD087046385a43EAb7b60C52e7D",
  "0x0388f65C185a7E7D857BB142185381d97a4bc747",
  "0x161fa1ac2D93832C3F77c8b5879Cb4dC56d958a7",
  "0x14A415Dd90B63c791C5dc544594605c8bC13Bc8D",
  "0x1066E9D2E372d01A0F57bB6f231D34Ce4CEd228e",
  "0xa24Ba528Be99024f7F7C227b55cBb265ecf0C078",
  "0xd60139B287De1408f8388f5f57fC114Fb4B03328",
  "0x8E51Ad4EeB19693751a9A3E36b8F098D891Ddc7f",
  "0x144A3290C9Db859939F085E3EC9A5C321FC713aF",
  "0xDB2E7F6655de37822c3020a8988351CC76caDAD5",
  "0x6DA66C15823cFf681DaD6963fBD325a520362958",
  "0xb82756f9853A148A2390a08AaD30BabCDc22f068",
  "0xdF68acF496Db55f4A882a0371c489D739173fbEc",
  "0x02bD62088A02668F29102B06E4925791Cd0fe4C5",
  "0x45788a369f3083c02b942aEa02DBa25C466a773F",
  "0x52f83ACA94904b3590669E3525d25ec75cDFf798",
  "0xfDF90C4104c1dE34979235e6AE080528266a14a3",
  "0xb40BA94747c59d076B3c189E3A031547492013da",
  "0x46f5E363e69798a74c8422BFb9EDB63e3FB0f08a",
  "0x8F92465991e1111F012F24A55AE2B0742F82dd7b",
  "0x885c5fCB4D3B574A39f6750F962a3b52600ad728",
  "0xd9af2d7E4cF86aAfBCf688a47Bd6b95Da9F7c838",
  "0x0f4e2a456aAfc0068a0718E3107B88d2e8f2bfEF",
  "0x312Ecf2854f73a3Ff616e3CDBC05E2Ff6A98d1f0",
  "0x0Ee5Bb3dEAe8a44FbDeB269941f735793F8312Ef",
  "0xCef85b352CCD7a446d94AEeeA02dD11622289954",
  "0x56BaBEcb3dCaC063697fE38AB745c10181c56fA6",
  "0x4F8d7bFFe8a2428A313b737001311Ad302a60dF4",
  "0x10E018C01792705BefB7A757628C2947E38B9426",
  "0xb2AEa0DE92Acff7e1146333F776db42E5d004128",
  "0x0D1bA751BaDe6d7BB54CF4F05D2dC0A9f45605e5",
  "0x0759883acF042A54fAb083378b0395F773A79767",
  "0x32F0405834C4b50be53199628C45603Cea3A28aA",
  "0xC9E6C106C65eDD67C83CC6e3bCd18bf8d2Ebf182",
  "0x9c9Ee67586FaF80aFE147306FB858AF4Ec2212a4",
  "0x12d21cb3E544de60Edb434A43ae7ef0715bee6cc",
  "0xeCFe987D8C103a3EC2041774E4514ED0614fB42C",
  "0x67F4deC415Ce95F8e66d63C926605d16f8d1b4e4",
  "0x7FBE19088B011A9dE0e3a327D7C681028F065616",
  "0xB1a3E5a8d642534840bFC50c6417F9566E716cc7",
  "0xC73a3831B4A91Ab05f9171c0ef0BEc9545cDeCf5",
  "0xbc044745F137D4693c2Aa823C760f855254faD42",
  "0xF8eF02C10C473CA5E48b10c62ba4d46115dd2288",
  "0x6F4DD6F2dD3aCb85e4903c3307e18A35D59537c0",
  "0x5917C41a355D16D3950FE12299Ce6DFc1b54cD54",
  "0x5fbD22d64A1bD27b77e0f9d6e8831510439e947A",
  "0xe79dd3BDfb7868DedD00108FecaF12F94eB113B8",
  "0xa1Da681EA4b03ab826D33B7a9774222Ae175322F",
  "0x77482A8488a1cA8EdFAc67277b0eB99591106f05",
  "0x73220345bD37C6897dA959AE6205254be5da4dD8",
  "0xdd0acE85FcdC46d6430C7F24d56A0A80277AD8D2",
  "0x7bc1476eeD521c083Ec84D2894a7B7f738c93b3b",
  "0xCbbA8c0645ffb8aA6ec868f6F5858F2b0eAe34DA",
  "0xeF4Db4AF6189aae295a680345e07E00d25ECBAAb",
  "0x10D00f5788C39a2Bf248ADfa2863Fa55d83dcE36",
  "0x8484381906425E3AFe30CDD48bFc4ed7CC1499D4",
  "0xeE44aE0cff6E9E62F26add74784E573bD671F144",
  "0xee7f8088d2e67C5b10EB94732F4bB6E26968AC82",
  "0xb9942AA8983d41e53b68209BeA596A6004321E77",
  "0x52B21a720D5eBeFc7EFA802c7DEAB7c08Eb10F39",
  "0x772665dce7b347A867F42bcA93587b5400Ae2576",
  "0x2dE7A5157693a895ae8E55b1e935e23451a77cB3",
  "0xcA9C3d3fA9419C49465e04C49dD38C054fD94712",
  "0xc07dE54Aa905A644Ab67F6E3b0d40150Bf825Ca3",
  "0x4e3Decbb3645551B8A19f0eA1678079FCB33fB4c",
  "0xbD1463F02f61676d53fd183C2B19282BFF93D099",
  "0x767058F11800FBA6A682E73A6e79ec5eB74Fac8c",
  "0x799c9518Ea434bBdA03d4C0EAa58d644b768d3aB",
];

type Instance = uma.clients.emp.Instance;
describe("emp-state service", function () {
  let appState: Dependencies;
  before(async function () {
    assert(process.env.CUSTOM_NODE_URL);
    assert(process.env.multicallAddress);
    const provider = new ethers.providers.WebSocketProvider(process.env.CUSTOM_NODE_URL);
    appState = {
      provider,
      multicall: new Multicall(process.env.multicallAddress, provider),
      registeredEmps: new Set<string>(registeredEmps),
      collateralAddresses: new Set<string>(),
      syntheticAddresses: new Set<string>(),
      emps: {
        active: tables.emps.JsMap("Active Emp"),
        expired: tables.emps.JsMap("Expired Emp"),
        errored: {},
      },
    };
  });
  it("init", async function () {
    const service = Service(undefined, appState);
    assert.ok(service);
  });
  it("readDynamicState", async function () {
    const address = "0xc07dE54Aa905A644Ab67F6E3b0d40150Bf825Ca3";
    const service = Service(undefined, appState);
    const instance = await uma.clients.emp.connect(address, appState.provider);
    const result = await service.utils.readEmpDynamicState(instance, address);
    assert.ok(result.address);
    assert.ok(result.updated);
    assert.ok(result.totalTokensOutstanding);
    assert.ok(result.totalPositionCollateral);
    assert.ok(result.expiryPrice);
  });
  it("readStaticState", async function () {
    const address = "0xc07dE54Aa905A644Ab67F6E3b0d40150Bf825Ca3";
    const service = Service(undefined, appState);
    const instance = await uma.clients.emp.connect(address, appState.provider);
    const result = await service.utils.readEmpStaticState(instance, address);
    assert.ok(result.address);
    assert.ok(result.updated);
    assert.ok(result.priceIdentifier);
    assert.ok(result.expirationTimestamp);
    assert.ok(result.withdrawalLiveness);
    assert.ok(result.tokenCurrency);
    assert.ok(result.collateralCurrency);
    assert.ok(result.finder);
    assert.ok(result.minSponsorTokens);
    assert.ok(result.liquidationLiveness);
    assert.ok(result.collateralRequirement);
    assert.ok(result.disputeBondPercentage);
    assert.ok(result.sponsorDisputeRewardPercentage);
    assert.ok(result.disputerDisputeRewardPercentage);
    assert.ok(result.cumulativeFeeMultiplier);
  });
  it("update", async function () {
    this.timeout(60000);
    const service = Service(undefined, appState);
    await service.update();
    assert.ok((await appState.emps.expired.values()).length);
    assert.ok((await appState.emps.active.values()).length);
    assert.ok(Object.keys(appState.emps.errored).length);
  });
});

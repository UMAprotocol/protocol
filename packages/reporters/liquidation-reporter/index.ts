const { fetchUmaEcosystemData } = require("./liquidation-reporter");
const { createExcelSheetFromLiquidationDrawDownData } = require("./excel-writer");

async function fetchDataAndWriteToExcelFile() {
  const ecosystemData = await fetchUmaEcosystemData();
  // const ecosystemData = {
  //   "0x6b175474e89094c44da98b954eedeac495271d0f": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0x0759883acF042A54fAb083378b0395F773A79767",
  //         collateralValueInUsd: "160642.214833460652655097",
  //         contractPriceIdentifier: "BTCDOM",
  //         collateralRequirement: 1.1,
  //         contractExpirationTime: "1625090400"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "1" },
  //       { priceDrop: "10", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.9" },
  //       { priceDrop: "20", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.8" },
  //       { priceDrop: "30", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.7" },
  //       { priceDrop: "40", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.6" },
  //       { priceDrop: "50", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.5" },
  //       { priceDrop: "60", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.4" },
  //       { priceDrop: "70", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.3" },
  //       { priceDrop: "80", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.2" },
  //       { priceDrop: "90", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.1" }
  //     ],
  //     collateralValueInUsd: "473675.244906128369955012",
  //     collateralPriceInUsd: "1",
  //     collateralSymbol: "DAI"
  //   },
  //   "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0xb56C5f1fB93b1Fbd7c473926c87B6B9c4d0e21d5",
  //         collateralValueInUsd: "225987.777549638354953766"
  //       },
  //       {
  //         contractAddress: "0x964Be01cCe200e168c4ba960a764cBEBa8C01200",
  //         collateralValueInUsd: "150163.259335445812289106",
  //         contractPriceIdentifier: "USDETH",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1648764000"
  //       },
  //       {
  //         contractAddress: "0x45788a369f3083c02b942aEa02DBa25C466a773F",
  //         collateralValueInUsd: "2200524.026448",
  //         contractPriceIdentifier: "USDETH",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1640908800"
  //       },
  //       {
  //         contractAddress: "0x0f4e2a456aAfc0068a0718E3107B88d2e8f2bfEF",
  //         collateralValueInUsd: "56980405.076919635048350249",
  //         contractPriceIdentifier: "USDETH",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1625090400"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "3511.16" },
  //       { priceDrop: "10", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "3160.044" },
  //       { priceDrop: "20", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "2808.928" },
  //       { priceDrop: "30", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "2457.812" },
  //       { priceDrop: "40", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "2106.696" },
  //       { priceDrop: "50", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "1755.58" },
  //       {
  //         collateralLiquidated: "1539.699",
  //         usdNeededToLiquidate: "5406129.54084",
  //         priceDrop: "60",
  //         effectiveCollateralPrice: "1404.464"
  //       },
  //       {
  //         collateralLiquidated: "2491.0401456318325316",
  //         usdNeededToLiquidate: "8746440.517736665111652656",
  //         priceDrop: "70",
  //         effectiveCollateralPrice: "1053.348"
  //       },
  //       {
  //         collateralLiquidated: "9659.7974456318325316",
  //         usdNeededToLiquidate: "33917094.399204665111652656",
  //         priceDrop: "80",
  //         effectiveCollateralPrice: "702.232"
  //       },
  //       {
  //         collateralLiquidated: "10137.248672156948945535",
  //         usdNeededToLiquidate: "35593502.04773059285960467",
  //         priceDrop: "90",
  //         effectiveCollateralPrice: "351.116"
  //       }
  //     ],
  //     collateralValueInUsd: "64889443.319512452665424927",
  //     collateralPriceInUsd: "3511.16",
  //     collateralSymbol: "WETH"
  //   },
  //   "0xeb4c2781e4eba804ce9a9803c67d0893436bb27d": {
  //     activeFinancialContracts: [
  //       { contractAddress: "0xaBBee9fC7a882499162323EEB7BF6614193312e3", collateralValueInUsd: "17192.5729964" },
  //       {
  //         contractAddress: "0x56BaBEcb3dCaC063697fE38AB745c10181c56fA6",
  //         collateralValueInUsd: "6888826.5373118",
  //         contractPriceIdentifier: "BCHNBTC_18DEC",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1640948400"
  //       },
  //       {
  //         contractAddress: "0x10E018C01792705BefB7A757628C2947E38B9426",
  //         collateralValueInUsd: "57332.53583228",
  //         contractPriceIdentifier: "USDBTC_18DEC",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1640948400"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       {
  //         collateralLiquidated: "60.15893074",
  //         usdNeededToLiquidate: "3479833.18972456",
  //         priceDrop: "0",
  //         effectiveCollateralPrice: "57844"
  //       },
  //       {
  //         collateralLiquidated: "60.15893074",
  //         usdNeededToLiquidate: "3479833.18972456",
  //         priceDrop: "10",
  //         effectiveCollateralPrice: "52059.6"
  //       },
  //       {
  //         collateralLiquidated: "60.18561074",
  //         usdNeededToLiquidate: "3481376.46764456",
  //         priceDrop: "20",
  //         effectiveCollateralPrice: "46275.2"
  //       },
  //       {
  //         collateralLiquidated: "60.18561074",
  //         usdNeededToLiquidate: "3481376.46764456",
  //         priceDrop: "30",
  //         effectiveCollateralPrice: "40490.8"
  //       },
  //       {
  //         collateralLiquidated: "60.73608861",
  //         usdNeededToLiquidate: "3513218.30955684",
  //         priceDrop: "40",
  //         effectiveCollateralPrice: "34706.4"
  //       },
  //       {
  //         collateralLiquidated: "60.62608861",
  //         usdNeededToLiquidate: "3506855.46955684",
  //         priceDrop: "50",
  //         effectiveCollateralPrice: "28922"
  //       },
  //       {
  //         collateralLiquidated: "0.57715787",
  //         usdNeededToLiquidate: "33385.11983228",
  //         priceDrop: "60",
  //         effectiveCollateralPrice: "23137.6"
  //       },
  //       {
  //         collateralLiquidated: "0.57715787",
  //         usdNeededToLiquidate: "33385.11983228",
  //         priceDrop: "70",
  //         effectiveCollateralPrice: "17353.2"
  //       },
  //       {
  //         collateralLiquidated: "0.57715787",
  //         usdNeededToLiquidate: "33385.11983228",
  //         priceDrop: "80",
  //         effectiveCollateralPrice: "11568.8"
  //       },
  //       {
  //         collateralLiquidated: "0.57715787",
  //         usdNeededToLiquidate: "33385.11983228",
  //         priceDrop: "90",
  //         effectiveCollateralPrice: "5784.4"
  //       }
  //     ],
  //     collateralValueInUsd: "29533471.14289584",
  //     collateralPriceInUsd: "57844",
  //     collateralSymbol: "renBTC"
  //   },
  //   "0xeca82185adce47f39c684352b0439f030f860318": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0xD50fbace72352C2e15E0986b8Ad2599627B5c340",
  //         collateralValueInUsd: "1900546.411691783030479538",
  //         contractPriceIdentifier: "XAUPERL",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1622473200"
  //       },
  //       {
  //         contractAddress: "0xfDF90C4104c1dE34979235e6AE080528266a14a3",
  //         collateralValueInUsd: "3480.889884252825417997",
  //         contractPriceIdentifier: "XAUPERL",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1648738800"
  //       },
  //       {
  //         contractAddress: "0xb40BA94747c59d076B3c189E3A031547492013da",
  //         collateralValueInUsd: "6010134.70248795231068",
  //         contractPriceIdentifier: "USDPERL",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1648738800"
  //       },
  //       {
  //         contractAddress: "0x46f5E363e69798a74c8422BFb9EDB63e3FB0f08a",
  //         collateralValueInUsd: "5348842.934493071404275527",
  //         contractPriceIdentifier: "XAUPERL",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1648738800"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.149618" },
  //       {
  //         priceDrop: "10",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.1346562"
  //       },
  //       {
  //         priceDrop: "20",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.1196944"
  //       },
  //       {
  //         priceDrop: "30",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.1047326"
  //       },
  //       {
  //         priceDrop: "40",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.0897708"
  //       },
  //       { priceDrop: "50", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.074809" },
  //       {
  //         priceDrop: "60",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.0598472"
  //       },
  //       {
  //         collateralLiquidated: "152301718.93674526",
  //         usdNeededToLiquidate: "22787078.58387795231068",
  //         priceDrop: "70",
  //         effectiveCollateralPrice: "0.0448854"
  //       },
  //       {
  //         collateralLiquidated: "152301718.93674526",
  //         usdNeededToLiquidate: "22787078.58387795231068",
  //         priceDrop: "80",
  //         effectiveCollateralPrice: "0.0299236"
  //       },
  //       {
  //         collateralLiquidated: "152301718.93674526",
  //         usdNeededToLiquidate: "22787078.58387795231068",
  //         priceDrop: "90",
  //         effectiveCollateralPrice: "0.0149618"
  //       }
  //     ],
  //     collateralValueInUsd: "13507244.587565684347836759",
  //     collateralPriceInUsd: "0.149618",
  //     collateralSymbol: "PERL"
  //   },
  //   "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0xf215778F3a5e7Ab6A832e71d87267Dd9a9aB0037",
  //         collateralValueInUsd: "6381470.188290261232",
  //         contractPriceIdentifier: "STABLESPREAD/USDC",
  //         collateralRequirement: 1.01,
  //         contractExpirationTime: "1624626000"
  //       },
  //       { contractAddress: "0x267D46e71764ABaa5a0dD45260f95D9c8d5b8195", collateralValueInUsd: "6481.669915393976" },
  //       {
  //         contractAddress: "0xaB3Aa2768Ba6c5876B2552a6F9b70E54aa256175",
  //         collateralValueInUsd: "10667.9932499028",
  //         contractPriceIdentifier: "AMPLUSD",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1625090400"
  //       },
  //       {
  //         contractAddress: "0x6DA66C15823cFf681DaD6963fBD325a520362958",
  //         collateralValueInUsd: "2888793.291215623712",
  //         contractPriceIdentifier: "ETH-BASIS-6M/USDC",
  //         collateralRequirement: 1.05,
  //         contractExpirationTime: "1623732110"
  //       },
  //       {
  //         contractAddress: "0xCef85b352CCD7a446d94AEeeA02dD11622289954",
  //         collateralValueInUsd: "4839875.597972664044",
  //         contractPriceIdentifier: "STABLESPREAD/USDC_18DEC",
  //         collateralRequirement: 1.05,
  //         contractExpirationTime: "1640948400"
  //       },
  //       {
  //         contractAddress: "0x4F8d7bFFe8a2428A313b737001311Ad302a60dF4",
  //         collateralValueInUsd: "249.703",
  //         contractPriceIdentifier: "SUSHIUNI_TVL",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1625112000"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.998812" },
  //       {
  //         priceDrop: "10",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.8989308"
  //       },
  //       {
  //         priceDrop: "20",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.7990496"
  //       },
  //       {
  //         priceDrop: "30",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.6991684"
  //       },
  //       {
  //         priceDrop: "40",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.5992872"
  //       },
  //       { priceDrop: "50", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.499406" },
  //       {
  //         priceDrop: "60",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.3995248"
  //       },
  //       {
  //         priceDrop: "70",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.2996436"
  //       },
  //       {
  //         priceDrop: "80",
  //         collateralLiquidated: "0",
  //         usdNeededToLiquidate: "0",
  //         effectiveCollateralPrice: "0.1997624"
  //       },
  //       { priceDrop: "90", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "0.0998812" }
  //     ],
  //     collateralValueInUsd: "19310982.81287179572",
  //     collateralPriceInUsd: "0.998812",
  //     collateralSymbol: "USDC"
  //   },
  //   "0x514910771af9ca656af840dff83e8264ecf986ca": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0x14A415Dd90B63c791C5dc544594605c8bC13Bc8D",
  //         collateralValueInUsd: "1528.001065263368383991",
  //         contractPriceIdentifier: "USDLINK",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1640988000"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "48.24" },
  //       { priceDrop: "10", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "43.416" },
  //       { priceDrop: "20", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "38.592" },
  //       { priceDrop: "30", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "33.768" },
  //       { priceDrop: "40", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "28.944" },
  //       { priceDrop: "50", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "24.12" },
  //       {
  //         collateralLiquidated: "31.674980623204153897",
  //         usdNeededToLiquidate: "1528.001065263368383991",
  //         priceDrop: "60",
  //         effectiveCollateralPrice: "19.296"
  //       },
  //       {
  //         collateralLiquidated: "227.674980623204153897",
  //         usdNeededToLiquidate: "10983.041065263368383991",
  //         priceDrop: "70",
  //         effectiveCollateralPrice: "14.472"
  //       },
  //       {
  //         collateralLiquidated: "227.674980623204153897",
  //         usdNeededToLiquidate: "10983.041065263368383991",
  //         priceDrop: "80",
  //         effectiveCollateralPrice: "9.648"
  //       },
  //       {
  //         collateralLiquidated: "227.674980623204153897",
  //         usdNeededToLiquidate: "10983.041065263368383991",
  //         priceDrop: "90",
  //         effectiveCollateralPrice: "4.824"
  //       }
  //     ],
  //     collateralValueInUsd: "1528.001065263368383991",
  //     collateralPriceInUsd: "48.24",
  //     collateralSymbol: "LINK"
  //   },
  //   "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0x1066E9D2E372d01A0F57bB6f231D34Ce4CEd228e",
  //         collateralValueInUsd: "1324.26111772941326208",
  //         contractPriceIdentifier: "USDUNI",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1640988000"
  //       },
  //       {
  //         contractAddress: "0x0D1bA751BaDe6d7BB54CF4F05D2dC0A9f45605e5",
  //         collateralValueInUsd: "1089.66000000000117348",
  //         contractPriceIdentifier: "UNIUSD",
  //         collateralRequirement: 1,
  //         contractExpirationTime: "1622498400"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       {
  //         collateralLiquidated: "36000",
  //         usdNeededToLiquidate: "1508760",
  //         priceDrop: "0",
  //         effectiveCollateralPrice: "41.91"
  //       },
  //       {
  //         collateralLiquidated: "36000",
  //         usdNeededToLiquidate: "1508760",
  //         priceDrop: "10",
  //         effectiveCollateralPrice: "37.719"
  //       },
  //       {
  //         collateralLiquidated: "36000",
  //         usdNeededToLiquidate: "1508760",
  //         priceDrop: "20",
  //         effectiveCollateralPrice: "33.528"
  //       },
  //       {
  //         collateralLiquidated: "36000",
  //         usdNeededToLiquidate: "1508760",
  //         priceDrop: "30",
  //         effectiveCollateralPrice: "29.337"
  //       },
  //       {
  //         collateralLiquidated: "36000",
  //         usdNeededToLiquidate: "1508760",
  //         priceDrop: "40",
  //         effectiveCollateralPrice: "25.146"
  //       },
  //       {
  //         collateralLiquidated: "36031.597736046991488",
  //         usdNeededToLiquidate: "1510084.26111772941326208",
  //         priceDrop: "50",
  //         effectiveCollateralPrice: "20.955"
  //       },
  //       {
  //         collateralLiquidated: "36031.597736046991488",
  //         usdNeededToLiquidate: "1510084.26111772941326208",
  //         priceDrop: "60",
  //         effectiveCollateralPrice: "16.764"
  //       },
  //       {
  //         collateralLiquidated: "36212.597736046991488",
  //         usdNeededToLiquidate: "1517669.97111772941326208",
  //         priceDrop: "70",
  //         effectiveCollateralPrice: "12.573"
  //       },
  //       {
  //         collateralLiquidated: "36212.597736046991488",
  //         usdNeededToLiquidate: "1517669.97111772941326208",
  //         priceDrop: "80",
  //         effectiveCollateralPrice: "8.382"
  //       },
  //       {
  //         collateralLiquidated: "36212.597736046991488",
  //         usdNeededToLiquidate: "1517669.97111772941326208",
  //         priceDrop: "90",
  //         effectiveCollateralPrice: "4.191"
  //       }
  //     ],
  //     collateralValueInUsd: "1365135.97063318218884976",
  //     collateralPriceInUsd: "41.91",
  //     collateralSymbol: "UNI"
  //   },
  //   "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0xa24Ba528Be99024f7F7C227b55cBb265ecf0C078",
  //         collateralValueInUsd: "1621.9262448",
  //         contractPriceIdentifier: "USDAAVE",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1640988000"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "466.32" },
  //       { priceDrop: "10", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "419.688" },
  //       { priceDrop: "20", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "373.056" },
  //       { priceDrop: "30", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "326.424" },
  //       { priceDrop: "40", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "279.792" },
  //       { priceDrop: "50", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "233.16" },
  //       {
  //         collateralLiquidated: "16",
  //         usdNeededToLiquidate: "7461.12",
  //         priceDrop: "60",
  //         effectiveCollateralPrice: "186.528"
  //       },
  //       {
  //         collateralLiquidated: "16",
  //         usdNeededToLiquidate: "7461.12",
  //         priceDrop: "70",
  //         effectiveCollateralPrice: "139.896"
  //       },
  //       {
  //         collateralLiquidated: "16",
  //         usdNeededToLiquidate: "7461.12",
  //         priceDrop: "80",
  //         effectiveCollateralPrice: "93.264"
  //       },
  //       {
  //         collateralLiquidated: "16",
  //         usdNeededToLiquidate: "7461.12",
  //         priceDrop: "90",
  //         effectiveCollateralPrice: "46.632"
  //       }
  //     ],
  //     collateralValueInUsd: "1621.9262448",
  //     collateralPriceInUsd: "466.32",
  //     collateralSymbol: "AAVE"
  //   },
  //   "0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0xd60139B287De1408f8388f5f57fC114Fb4B03328",
  //         collateralValueInUsd: "1479.575916320974115083",
  //         contractPriceIdentifier: "USDSNX",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1640988000"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "18.09" },
  //       { priceDrop: "10", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "16.281" },
  //       { priceDrop: "20", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "14.472" },
  //       {
  //         collateralLiquidated: "41.789713450578999735",
  //         usdNeededToLiquidate: "755.975916320974105206",
  //         priceDrop: "30",
  //         effectiveCollateralPrice: "12.663"
  //       },
  //       {
  //         collateralLiquidated: "41.789713450578999735",
  //         usdNeededToLiquidate: "755.975916320974105206",
  //         priceDrop: "40",
  //         effectiveCollateralPrice: "10.854"
  //       },
  //       {
  //         collateralLiquidated: "349.289713450578999735",
  //         usdNeededToLiquidate: "6318.650916320974105206",
  //         priceDrop: "50",
  //         effectiveCollateralPrice: "9.045"
  //       },
  //       {
  //         collateralLiquidated: "349.289713450578999735",
  //         usdNeededToLiquidate: "6318.650916320974105206",
  //         priceDrop: "60",
  //         effectiveCollateralPrice: "7.236"
  //       },
  //       {
  //         collateralLiquidated: "349.289713450578999735",
  //         usdNeededToLiquidate: "6318.650916320974105206",
  //         priceDrop: "70",
  //         effectiveCollateralPrice: "5.427"
  //       },
  //       {
  //         collateralLiquidated: "349.289713450578999735",
  //         usdNeededToLiquidate: "6318.650916320974105206",
  //         priceDrop: "80",
  //         effectiveCollateralPrice: "3.618"
  //       },
  //       {
  //         collateralLiquidated: "349.289713450578999735",
  //         usdNeededToLiquidate: "6318.650916320974105206",
  //         priceDrop: "90",
  //         effectiveCollateralPrice: "1.809"
  //       }
  //     ],
  //     collateralValueInUsd: "1479.575916320974115083",
  //     collateralPriceInUsd: "18.09",
  //     collateralSymbol: "SNX"
  //   },
  //   "0x04fa0d235c4abf4bcf4787af4cf447de572ef828": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0x8E51Ad4EeB19693751a9A3E36b8F098D891Ddc7f",
  //         collateralValueInUsd: "1105.126620370370370357",
  //         contractPriceIdentifier: "USDUMA",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1640988000"
  //       },
  //       {
  //         contractAddress: "0xDB2E7F6655de37822c3020a8988351CC76caDAD5",
  //         collateralValueInUsd: "612724.39634",
  //         contractPriceIdentifier: "USDUMA",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1640988000"
  //       },
  //       {
  //         contractAddress: "0x0Ee5Bb3dEAe8a44FbDeB269941f735793F8312Ef",
  //         collateralValueInUsd: "51800000",
  //         contractPriceIdentifier: "uTVL_KPI_UMA",
  //         collateralRequirement: 1,
  //         contractExpirationTime: "1625090400"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "25.9" },
  //       { priceDrop: "10", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "23.31" },
  //       { priceDrop: "20", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "20.72" },
  //       { priceDrop: "30", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "18.13" },
  //       {
  //         collateralLiquidated: "42.668981481481481481",
  //         usdNeededToLiquidate: "1105.126620370370370357",
  //         priceDrop: "40",
  //         effectiveCollateralPrice: "15.54"
  //       },
  //       {
  //         collateralLiquidated: "305.668981481481481481",
  //         usdNeededToLiquidate: "7916.826620370370370357",
  //         priceDrop: "50",
  //         effectiveCollateralPrice: "12.95"
  //       },
  //       {
  //         collateralLiquidated: "5164.199581481481481481",
  //         usdNeededToLiquidate: "133752.769160370370370357",
  //         priceDrop: "60",
  //         effectiveCollateralPrice: "10.36"
  //       },
  //       {
  //         collateralLiquidated: "5164.199581481481481481",
  //         usdNeededToLiquidate: "133752.769160370370370357",
  //         priceDrop: "70",
  //         effectiveCollateralPrice: "7.77"
  //       },
  //       {
  //         collateralLiquidated: "5164.199581481481481481",
  //         usdNeededToLiquidate: "133752.769160370370370357",
  //         priceDrop: "80",
  //         effectiveCollateralPrice: "5.18"
  //       },
  //       {
  //         collateralLiquidated: "5164.199581481481481481",
  //         usdNeededToLiquidate: "133752.769160370370370357",
  //         priceDrop: "90",
  //         effectiveCollateralPrice: "2.59"
  //       }
  //     ],
  //     collateralValueInUsd: "77116685.212936815893483413",
  //     collateralPriceInUsd: "25.9",
  //     collateralSymbol: "UMA"
  //   },
  //   "0x967da4048cd07ab37855c090aaf366e4ce1b9f48": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0x312Ecf2854f73a3Ff616e3CDBC05E2Ff6A98d1f0",
  //         collateralValueInUsd: "4046345.175159188367066746",
  //         contractPriceIdentifier: "USDOCEAN",
  //         collateralRequirement: 1.25,
  //         contractExpirationTime: "1648764000"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "1.42" },
  //       { priceDrop: "10", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "1.278" },
  //       { priceDrop: "20", collateralLiquidated: "0", usdNeededToLiquidate: "0", effectiveCollateralPrice: "1.136" },
  //       {
  //         collateralLiquidated: "122",
  //         usdNeededToLiquidate: "173.24",
  //         priceDrop: "30",
  //         effectiveCollateralPrice: "0.994"
  //       },
  //       {
  //         collateralLiquidated: "122",
  //         usdNeededToLiquidate: "173.24",
  //         priceDrop: "40",
  //         effectiveCollateralPrice: "0.852"
  //       },
  //       {
  //         collateralLiquidated: "20776.89605",
  //         usdNeededToLiquidate: "29503.192391",
  //         priceDrop: "50",
  //         effectiveCollateralPrice: "0.71"
  //       },
  //       {
  //         collateralLiquidated: "20776.89605",
  //         usdNeededToLiquidate: "29503.192391",
  //         priceDrop: "60",
  //         effectiveCollateralPrice: "0.568"
  //       },
  //       {
  //         collateralLiquidated: "20776.89605",
  //         usdNeededToLiquidate: "29503.192391",
  //         priceDrop: "70",
  //         effectiveCollateralPrice: "0.426"
  //       },
  //       {
  //         collateralLiquidated: "20776.89605",
  //         usdNeededToLiquidate: "29503.192391",
  //         priceDrop: "80",
  //         effectiveCollateralPrice: "0.284"
  //       },
  //       {
  //         collateralLiquidated: "20776.89605",
  //         usdNeededToLiquidate: "29503.192391",
  //         priceDrop: "90",
  //         effectiveCollateralPrice: "0.142"
  //       }
  //     ],
  //     collateralValueInUsd: "4046345.175159188367066746",
  //     collateralPriceInUsd: "1.42",
  //     collateralSymbol: "OCEAN"
  //   },
  //   "0x8798249c2e607446efb7ad49ec89dd1865ff4272": {
  //     activeFinancialContracts: [
  //       {
  //         contractAddress: "0xb2AEa0DE92Acff7e1146333F776db42E5d004128",
  //         collateralValueInUsd: "1423256.849768",
  //         contractPriceIdentifier: "XSUSHIUSD",
  //         collateralRequirement: 1,
  //         contractExpirationTime: "1622498400"
  //       }
  //     ],
  //     drawDownAmounts: [
  //       {
  //         collateralLiquidated: "100",
  //         usdNeededToLiquidate: "1807",
  //         priceDrop: "0",
  //         effectiveCollateralPrice: "18.07"
  //       },
  //       {
  //         collateralLiquidated: "100",
  //         usdNeededToLiquidate: "1807",
  //         priceDrop: "10",
  //         effectiveCollateralPrice: "16.263"
  //       },
  //       {
  //         collateralLiquidated: "100",
  //         usdNeededToLiquidate: "1807",
  //         priceDrop: "20",
  //         effectiveCollateralPrice: "14.456"
  //       },
  //       {
  //         collateralLiquidated: "100",
  //         usdNeededToLiquidate: "1807",
  //         priceDrop: "30",
  //         effectiveCollateralPrice: "12.649"
  //       },
  //       {
  //         collateralLiquidated: "100",
  //         usdNeededToLiquidate: "1807",
  //         priceDrop: "40",
  //         effectiveCollateralPrice: "10.842"
  //       },
  //       {
  //         collateralLiquidated: "100",
  //         usdNeededToLiquidate: "1807",
  //         priceDrop: "50",
  //         effectiveCollateralPrice: "9.035"
  //       },
  //       {
  //         collateralLiquidated: "100",
  //         usdNeededToLiquidate: "1807",
  //         priceDrop: "60",
  //         effectiveCollateralPrice: "7.228"
  //       },
  //       {
  //         collateralLiquidated: "100",
  //         usdNeededToLiquidate: "1807",
  //         priceDrop: "70",
  //         effectiveCollateralPrice: "5.421"
  //       },
  //       {
  //         collateralLiquidated: "100",
  //         usdNeededToLiquidate: "1807",
  //         priceDrop: "80",
  //         effectiveCollateralPrice: "3.614"
  //       },
  //       {
  //         collateralLiquidated: "100",
  //         usdNeededToLiquidate: "1807",
  //         priceDrop: "90",
  //         effectiveCollateralPrice: "1.807"
  //       }
  //     ],
  //     collateralValueInUsd: "1423256.849768",
  //     collateralPriceInUsd: "18.07",
  //     collateralSymbol: "xSUSHI"
  //   },
  //   "0xdac17f958d2ee523a2206206994597c13d831ec7": {
  //     activeFinancialContracts: [],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
  //     ],
  //     collateralValueInUsd: "127321.890512665097",
  //     collateralPriceInUsd: "0.999827",
  //     collateralSymbol: "USDT"
  //   },
  //   "0xba100000625a3754423978a60c9317c58a424e3d": {
  //     activeFinancialContracts: [
  //       { contractAddress: "0x12d21cb3E544de60Edb434A43ae7ef0715bee6cc", collateralValueInUsd: "3398.5" }
  //     ],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
  //     ],
  //     collateralValueInUsd: "754901.025542463654659",
  //     collateralPriceInUsd: "67.97",
  //     collateralSymbol: "BAL"
  //   },
  //   "0x261b45d85ccfeabb11f022eba346ee8d1cd488c0": {
  //     activeFinancialContracts: [],
  //     drawDownAmounts: [
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
  //       { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
  //     ],
  //     collateralValueInUsd: "143.027000000000014302",
  //     collateralPriceInUsd: "0.715135",
  //     collateralSymbol: "rDAI"
  //   }
  // };
  console.log("ecosystemData", JSON.stringify(ecosystemData));
  createExcelSheetFromLiquidationDrawDownData(ecosystemData);
}

fetchDataAndWriteToExcelFile()
  .then(() => {
    setTimeout(function() {
      process.exit(0);
    }, 2000);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });

const lol = {
  "0x6b175474e89094c44da98b954eedeac495271d0f": {
    activeFinancialContracts: [
      {
        contractAddress: "0x3f2D9eDd9702909Cf1F8C4237B7c4c5931F9C944",
        collateralValueInUsd: "5652.339349709484608746"
      },
      { contractAddress: "0x67DD35EaD67FcD184C8Ff6D0251DF4241F309ce1", collateralValueInUsd: "519.3114673832283621" },
      {
        contractAddress: "0xeFA41F506EAA5c24666d4eE40888bA18FA60a1c7",
        collateralValueInUsd: "20487.966712941578553871"
      },
      {
        contractAddress: "0xC843538d70ee5d28C5A80A75bb94C28925bB1cf2",
        collateralValueInUsd: "13472.966438207473388892"
      },
      {
        contractAddress: "0x0759883acF042A54fAb083378b0395F773A79767",
        collateralValueInUsd: "160642.214833460652655097"
      },
      {
        contractAddress: "0x32F0405834C4b50be53199628C45603Cea3A28aA",
        collateralValueInUsd: "272900.446104425952386306"
      }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "473675.244906128369955012",
    collateralPriceInUsd: "1",
    collateralSymbol: "DAI"
  },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
    activeFinancialContracts: [
      { contractAddress: "0x39450EB4f7DE57f2a25EeE548Ff392532cFB8759", collateralValueInUsd: "0.000000000000003493" },
      {
        contractAddress: "0xb56C5f1fB93b1Fbd7c473926c87B6B9c4d0e21d5",
        collateralValueInUsd: "224852.419321595309185022"
      },
      { contractAddress: "0x4E3168Ea1082f3dda1694646B5EACdeb572009F1", collateralValueInUsd: "1659.422" },
      {
        contractAddress: "0xE1Ee8D4C5dBA1c221840c08f6Cf42154435B9D52",
        collateralValueInUsd: "716388.981266259424818829"
      },
      {
        contractAddress: "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56",
        collateralValueInUsd: "856635.261227396248901949"
      },
      {
        contractAddress: "0x516f595978D87B67401DaB7AfD8555c3d28a3Af4",
        collateralValueInUsd: "11915.513099214631974106"
      },
      {
        contractAddress: "0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5",
        collateralValueInUsd: "85653.889481740692095254"
      },
      {
        contractAddress: "0xEAA081a9fad4607CdF046fEA7D4BF3DfEf533282",
        collateralValueInUsd: "91709.609056316517284787"
      },
      {
        contractAddress: "0xfA3AA7EE08399A4cE0B4921c85AB7D645Ccac669",
        collateralValueInUsd: "132444.975012678138519642"
      },
      {
        contractAddress: "0x45c4DBD73294c5d8DDF6E5F949BE4C505E6E9495",
        collateralValueInUsd: "1924.721162072125631086"
      },
      {
        contractAddress: "0x2862A798B3DeFc1C24b9c0d241BEaF044C45E585",
        collateralValueInUsd: "10245.04610489352767558"
      },
      {
        contractAddress: "0x4E8d60A785c2636A63c5Bd47C7050d21266c8B43",
        collateralValueInUsd: "3396996.071264483091543765"
      },
      {
        contractAddress: "0x964Be01cCe200e168c4ba960a764cBEBa8C01200",
        collateralValueInUsd: "149408.842021886400548035"
      },
      { contractAddress: "0x45788a369f3083c02b942aEa02DBa25C466a773F", collateralValueInUsd: "2189468.636256" },
      {
        contractAddress: "0x0f4e2a456aAfc0068a0718E3107B88d2e8f2bfEF",
        collateralValueInUsd: "56694136.622745839960045274"
      }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "64563440.010020376068226822",
    collateralPriceInUsd: "3493.52",
    collateralSymbol: "WETH"
  },
  "0xeb4c2781e4eba804ce9a9803c67d0893436bb27d": {
    activeFinancialContracts: [
      { contractAddress: "0xc0b19570370478EDE5F2e922c5D31FAf1D5f90EA", collateralValueInUsd: "1326846.93222107" },
      { contractAddress: "0xaBBee9fC7a882499162323EEB7BF6614193312e3", collateralValueInUsd: "17113.2144287" },
      { contractAddress: "0xf32219331A03D99C98Adf96D43cc312353003531", collateralValueInUsd: "2098.89410913" },
      { contractAddress: "0x4AA79c00240a2094Ff3fa6CF7c67f521f32D84a2", collateralValueInUsd: "4165.39539806" },
      { contractAddress: "0x1c3f1A342c8D9591D9759220d114C685FD1cF6b8", collateralValueInUsd: "25836.46790569" },
      { contractAddress: "0xda0943251079eB9f517668fdB372fC6AE299D898", collateralValueInUsd: "222.70610869" },
      { contractAddress: "0xd81028a6fbAAaf604316F330b20D24bFbFd14478", collateralValueInUsd: "363.7426975" },
      { contractAddress: "0x7c4090170aeADD54B1a0DbAC2C8D08719220A435", collateralValueInUsd: "4748594.68158478" },
      { contractAddress: "0xaD3cceebeFfCdC3576dE56811d0A6D164BF9A5A1", collateralValueInUsd: "5408.87780628" },
      { contractAddress: "0xd9af2d7E4cF86aAfBCf688a47Bd6b95Da9F7c838", collateralValueInUsd: "16352401.21138468" },
      { contractAddress: "0x56BaBEcb3dCaC063697fE38AB745c10181c56fA6", collateralValueInUsd: "6857028.65532815" },
      { contractAddress: "0x10E018C01792705BefB7A757628C2947E38B9426", collateralValueInUsd: "57067.89668099" }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "29397148.67565372",
    collateralPriceInUsd: "57577",
    collateralSymbol: "renBTC"
  },
  "0xeca82185adce47f39c684352b0439f030f860318": {
    activeFinancialContracts: [
      {
        contractAddress: "0x306B19502c833C1522Fbc36C9dd7531Eda35862B",
        collateralValueInUsd: "5554.556713132966159143"
      },
      {
        contractAddress: "0x3a93E863cb3adc5910E6cea4d51f132E8666654F",
        collateralValueInUsd: "238285.149013218868595938"
      },
      {
        contractAddress: "0xD50fbace72352C2e15E0986b8Ad2599627B5c340",
        collateralValueInUsd: "1897434.260273741839964577"
      },
      {
        contractAddress: "0xfDF90C4104c1dE34979235e6AE080528266a14a3",
        collateralValueInUsd: "3475.189914853141274195"
      },
      { contractAddress: "0xb40BA94747c59d076B3c189E3A031547492013da", collateralValueInUsd: "6000293.08582344972198" },
      {
        contractAddress: "0x46f5E363e69798a74c8422BFb9EDB63e3FB0f08a",
        collateralValueInUsd: "5340084.185419090984178697"
      }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "13485126.42715748752215255",
    collateralPriceInUsd: "0.149373",
    collateralSymbol: "PERL"
  },
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
    activeFinancialContracts: [
      { contractAddress: "0xf215778F3a5e7Ab6A832e71d87267Dd9a9aB0037", collateralValueInUsd: "6424167.877077660604" },
      { contractAddress: "0xeAddB6AD65dcA45aC3bB32f88324897270DA0387", collateralValueInUsd: "1880.886306430489" },
      { contractAddress: "0x267D46e71764ABaa5a0dD45260f95D9c8d5b8195", collateralValueInUsd: "6484.440880354222" },
      { contractAddress: "0xaB3Aa2768Ba6c5876B2552a6F9b70E54aa256175", collateralValueInUsd: "10672.5539010741" },
      { contractAddress: "0x48546bDD57D34Cb110f011Cdd1CcaaE75Ee17a70", collateralValueInUsd: "526047.636610294621" },
      { contractAddress: "0x182d5993106573A95a182AB3A77c892713fFDA56", collateralValueInUsd: "216810.078257553298" },
      { contractAddress: "0x14a046c066266da6b8b8C4D2de4AfBEeCd53a262", collateralValueInUsd: "808.012085509789" },
      { contractAddress: "0x496B179D5821d1a8B6C875677e3B89a9229AAB77", collateralValueInUsd: "310324.247624401731" },
      { contractAddress: "0x4F1424Cef6AcE40c0ae4fc64d74B734f1eAF153C", collateralValueInUsd: "969967.071196718266" },
      { contractAddress: "0x9E929a85282fB0555C19Ed70942B952827Ca4B0B", collateralValueInUsd: "2593284.892351420636" },
      { contractAddress: "0x9bB1f39b6DB45BD087046385a43EAb7b60C52e7D", collateralValueInUsd: "0.001098163661" },
      { contractAddress: "0x0388f65C185a7E7D857BB142185381d97a4bc747", collateralValueInUsd: "0.000393700166" },
      { contractAddress: "0x6DA66C15823cFf681DaD6963fBD325a520362958", collateralValueInUsd: "2890028.273109462664" },
      { contractAddress: "0x52f83ACA94904b3590669E3525d25ec75cDFf798", collateralValueInUsd: "1306.005373" },
      { contractAddress: "0x8F92465991e1111F012F24A55AE2B0742F82dd7b", collateralValueInUsd: "164.874435" },
      { contractAddress: "0xCef85b352CCD7a446d94AEeeA02dD11622289954", collateralValueInUsd: "4841944.682925922843" },
      { contractAddress: "0x4F8d7bFFe8a2428A313b737001311Ad302a60dF4", collateralValueInUsd: "249.80975" },
      { contractAddress: "0xB1a3E5a8d642534840bFC50c6417F9566E716cc7", collateralValueInUsd: "565066.62680583" }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "19359207.97018249709",
    collateralPriceInUsd: "0.999239",
    collateralSymbol: "USDC"
  },
  "0x514910771af9ca656af840dff83e8264ecf986ca": {
    activeFinancialContracts: [
      { contractAddress: "0x14A415Dd90B63c791C5dc544594605c8bC13Bc8D", collateralValueInUsd: "1523.883317782351843984" }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "1523.883317782351843984",
    collateralPriceInUsd: "48.11",
    collateralSymbol: "LINK"
  },
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
    activeFinancialContracts: [
      { contractAddress: "0x1066E9D2E372d01A0F57bB6f231D34Ce4CEd228e", collateralValueInUsd: "1319.52145732236453888" },
      { contractAddress: "0x0D1bA751BaDe6d7BB54CF4F05D2dC0A9f45605e5", collateralValueInUsd: "1085.76000000000116928" },
      { contractAddress: "0x9c9Ee67586FaF80aFE147306FB858AF4Ec2212a4", collateralValueInUsd: "4176.0000000000008352" },
      { contractAddress: "0xeCFe987D8C103a3EC2041774E4514ED0614fB42C", collateralValueInUsd: "1353668.733661782577536" }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "1360250.01511910494407936",
    collateralPriceInUsd: "41.76",
    collateralSymbol: "UNI"
  },
  "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": {
    activeFinancialContracts: [
      { contractAddress: "0xa24Ba528Be99024f7F7C227b55cBb265ecf0C078", collateralValueInUsd: "1618.9350444" }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "1618.9350444",
    collateralPriceInUsd: "465.46",
    collateralSymbol: "AAVE"
  },
  "0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f": {
    activeFinancialContracts: [
      { contractAddress: "0xd60139B287De1408f8388f5f57fC114Fb4B03328", collateralValueInUsd: "1486.119093397020435105" }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "1486.119093397020435105",
    collateralPriceInUsd: "18.17",
    collateralSymbol: "SNX"
  },
  "0x04fa0d235c4abf4bcf4787af4cf447de572ef828": {
    activeFinancialContracts: [
      {
        contractAddress: "0x8E51Ad4EeB19693751a9A3E36b8F098D891Ddc7f",
        collateralValueInUsd: "1102.566481481481481469"
      },
      { contractAddress: "0xDB2E7F6655de37822c3020a8988351CC76caDAD5", collateralValueInUsd: "611304.957584" },
      {
        contractAddress: "0xb82756f9853A148A2390a08AaD30BabCDc22f068",
        collateralValueInUsd: "2102.513256955810147408"
      },
      {
        contractAddress: "0x02bD62088A02668F29102B06E4925791Cd0fe4C5",
        collateralValueInUsd: "607326.074592658181309853"
      },
      { contractAddress: "0x0Ee5Bb3dEAe8a44FbDeB269941f735793F8312Ef", collateralValueInUsd: "51680000" },
      {
        contractAddress: "0x7FBE19088B011A9dE0e3a327D7C681028F065616",
        collateralValueInUsd: "24036200.4094087393798648"
      }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "76938036.52132383485280353",
    collateralPriceInUsd: "25.84",
    collateralSymbol: "UMA"
  },
  "0x967da4048cd07ab37855c090aaf366e4ce1b9f48": {
    activeFinancialContracts: [
      {
        contractAddress: "0x312Ecf2854f73a3Ff616e3CDBC05E2Ff6A98d1f0",
        collateralValueInUsd: "4103335.952274106513081771"
      }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "4103335.952274106513081771",
    collateralPriceInUsd: "1.44",
    collateralSymbol: "OCEAN"
  },
  "0x8798249c2e607446efb7ad49ec89dd1865ff4272": {
    activeFinancialContracts: [
      { contractAddress: "0xb2AEa0DE92Acff7e1146333F776db42E5d004128", collateralValueInUsd: "1423256.849768" }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "1423256.849768",
    collateralPriceInUsd: "18.07",
    collateralSymbol: "xSUSHI"
  },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": {
    activeFinancialContracts: [
      { contractAddress: "0xC9E6C106C65eDD67C83CC6e3bCd18bf8d2Ebf182", collateralValueInUsd: "127321.890512665097" }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "127321.890512665097",
    collateralPriceInUsd: "0.999827",
    collateralSymbol: "USDT"
  },
  "0xba100000625a3754423978a60c9317c58a424e3d": {
    activeFinancialContracts: [
      { contractAddress: "0x12d21cb3E544de60Edb434A43ae7ef0715bee6cc", collateralValueInUsd: "3375.5" },
      { contractAddress: "0x67F4deC415Ce95F8e66d63C926605d16f8d1b4e4", collateralValueInUsd: "746416.588191433298897" }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "749792.088191433298897",
    collateralPriceInUsd: "67.51",
    collateralSymbol: "BAL"
  },
  "0x261b45d85ccfeabb11f022eba346ee8d1cd488c0": {
    activeFinancialContracts: [
      { contractAddress: "0xC73a3831B4A91Ab05f9171c0ef0BEc9545cDeCf5", collateralValueInUsd: "143.027000000000014302" }
    ],
    drawDownAmounts: [
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" },
      { priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }
    ],
    collateralValueInUsd: "143.027000000000014302",
    collateralPriceInUsd: "0.715135",
    collateralSymbol: "rDAI"
  }
};

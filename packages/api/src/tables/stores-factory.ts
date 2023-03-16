import { Datastore } from "@google-cloud/datastore";
import { tables, stores } from "@uma/sdk";
import { empStats, empStatsHistory, lsps, appStats, registeredContracts, addresses, priceSamples, tvl } from ".";

const { GoogleDatastore } = stores;

export default function StoresFactory(datastoreClient: Datastore) {
  return {
    empsActive: GoogleDatastore<string, tables.emps.Data>("Active Emp", datastoreClient),
    empsExpired: GoogleDatastore<string, tables.emps.Data>("Expired Emp", datastoreClient),
    empStatsHistory: GoogleDatastore<string, empStatsHistory.Data>("Market Price", datastoreClient),
    erc20: GoogleDatastore<string, tables.erc20s.Data>("Erc20", datastoreClient),
    empStatsTvm: GoogleDatastore<string, empStats.Data>("Emp Latest Tvm", datastoreClient),
    empStatsTvl: GoogleDatastore<string, empStats.Data>("Emp Latest Tvl", datastoreClient),
    empStatsTvmHistory: GoogleDatastore<string, empStatsHistory.Data>("Emp Tvm History", datastoreClient),
    empStatsTvlHistory: GoogleDatastore<string, empStatsHistory.Data>("Emp Tvl History", datastoreClient),
    lspStatsTvm: GoogleDatastore<string, empStats.Data>("Lsp Latest Tvm", datastoreClient),
    lspStatsTvl: GoogleDatastore<string, empStats.Data>("Lsp Latest Tvl", datastoreClient),
    lspStatsTvlHistory: GoogleDatastore<string, empStatsHistory.Data>("Lsp Tvl History", datastoreClient),
    lspsActive: GoogleDatastore<string, lsps.Data>("Active Lsp", datastoreClient, ["customAncillaryData"]),
    lspsExpired: GoogleDatastore<string, lsps.Data>("Expired Lsp", datastoreClient, ["customAncillaryData"]),
    appStats: GoogleDatastore<number, appStats.Data>("App Stats", datastoreClient),
    registeredEmps: GoogleDatastore<string, registeredContracts.Data>("Registered Emps", datastoreClient),
    registeredLsps: GoogleDatastore<string, registeredContracts.Data>("Registered Lsps", datastoreClient),
    collateralAddresses: GoogleDatastore<string, addresses.Data>("Collateral Addresses", datastoreClient),
    syntheticAddresses: GoogleDatastore<string, addresses.Data>("Synthetic Addresses", datastoreClient),
    longAddresses: GoogleDatastore<string, addresses.Data>("Long Addresses", datastoreClient),
    shortAddresses: GoogleDatastore<string, addresses.Data>("Short Addresses", datastoreClient),
    latestUsdPrices: GoogleDatastore<string, priceSamples.Data>("Latest Usd Prices", datastoreClient),
    latestSynthPrices: GoogleDatastore<string, priceSamples.Data>("Latest Synth Prices", datastoreClient),
    latestUsdcMarketPrices: GoogleDatastore<string, priceSamples.Data>("Latest USDC Market Prices", datastoreClient),
    globalUsdLatestTvl: GoogleDatastore<number, tvl.Data>("Latest Usd Global Tvl", datastoreClient),
  };
}

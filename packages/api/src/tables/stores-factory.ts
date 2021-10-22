import { Datastore } from "@google-cloud/datastore";
import { tables, stores } from "@uma/sdk";
import { empStats, empStatsHistory, lsps, appStats, registeredEmps } from ".";

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
    lspsActive: GoogleDatastore<string, lsps.Data>("Active Lsp", datastoreClient),
    lspsExpired: GoogleDatastore<string, lsps.Data>("Expired Lsp", datastoreClient),
    appStats: GoogleDatastore<number, appStats.Data>("App Stats", datastoreClient),
    registeredEmps: GoogleDatastore<string, registeredEmps.Data>("Registered Emps", datastoreClient),
  };
}

import { Datastore } from "@google-cloud/datastore";
import { tables, stores } from "@uma/sdk";
import { empStats, empStatsHistory, lsps } from ".";

const { GoogleDatastore } = stores;
const datastoreClient = new Datastore();

export const datastores = {
  empsActiveStore: GoogleDatastore<string, tables.emps.Data>("Active Emp", datastoreClient),
  empsExpiredStore: GoogleDatastore<string, tables.emps.Data>("Expired Emp", datastoreClient),
  blockStore: GoogleDatastore<number, tables.blocks.Data>("Block", datastoreClient),
  empStatsHistoryStore: GoogleDatastore<string, empStatsHistory.Data>("Market Price", datastoreClient),
  erc20Store: GoogleDatastore<string, tables.erc20s.Data>("Erc20", datastoreClient),
  empStatsTvmStore: GoogleDatastore<string, empStats.Data>("Emp Latest Tvm", datastoreClient),
  empStatsTvlStore: GoogleDatastore<string, empStats.Data>("Emp Latest Tvl", datastoreClient),
  empStatsTvmHistoryStore: GoogleDatastore<string, empStatsHistory.Data>("Emp Tvm History", datastoreClient),
  empStatsTvlHistoryStore: GoogleDatastore<string, empStatsHistory.Data>("Emp Tvl History", datastoreClient),
  lspStatsTvmStore: GoogleDatastore<string, empStats.Data>("Lsp Latest Tvm", datastoreClient),
  lspStatsTvlStore: GoogleDatastore<string, empStats.Data>("Lsp Latest Tvl", datastoreClient),
  lspStatsTvlHistoryStore: GoogleDatastore<string, empStatsHistory.Data>("Lsp Tvl History", datastoreClient),
  lspsActiveStore: GoogleDatastore<string, lsps.Data>("Active Lsp", datastoreClient),
  lspsExpiredStore: GoogleDatastore<string, lsps.Data>("Expired Lsp", datastoreClient),
};

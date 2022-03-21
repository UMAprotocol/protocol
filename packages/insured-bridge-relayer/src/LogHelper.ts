import fs from "fs";
import { Datastore } from "@google-cloud/datastore";
const datastore = new Datastore();

enum LogHelperMode {
  Gcp,
  Local,
}

const logHelperMode = process.env.LOG_SILENCER_MODE === "gcp" ? LogHelperMode.Gcp : LogHelperMode.Local;

const localSaveFilePath = `${__dirname}/relayer-unprofitable-logs`;

// Saves the provided depositHash to either a local file or a GCP data store database depending on the mode.
export async function saveUnprofitableLog(depositHash: string) {
  if (logHelperMode == LogHelperMode.Local) {
    // If the log file does not already contain the deposit hash, append it.
    if (!(await previouslySentUnprofitableLog(depositHash)))
      fs.writeFileSync(localSaveFilePath, `"${depositHash}"\n`, { flag: "a+" });
  } else if (logHelperMode == LogHelperMode.Gcp) {
    // Dont need to check if the GCP dataStore already has the deposit hash as this action replaces on write.
    const key = datastore.key(["RelayerUnprofitableLogs", depositHash]);
    await datastore.save({ key, data: { depositHash } });
  }
}

// Checks if the provided depositHash is present in either the local file or the GCP data store database.
export async function previouslySentUnprofitableLog(depositHash: string) {
  if (logHelperMode == LogHelperMode.Local) {
    // Try catch block to handel the case where the file does not exist.
    try {
      const logFile = fs.readFileSync(localSaveFilePath, "utf8");
      const pastLogs = JSON.parse("[" + logFile.replace(/\r?\n|\r/g, ",").substring(0, logFile.length - 1) + "]");
      return pastLogs.includes(depositHash);
    } catch (error) {
      return false;
    }
  } else if (logHelperMode == LogHelperMode.Gcp) {
    const key = datastore.key(["RelayerUnprofitableLogs", depositHash]);
    const [dataField] = await datastore.get(key);
    return !!dataField;
  }
}

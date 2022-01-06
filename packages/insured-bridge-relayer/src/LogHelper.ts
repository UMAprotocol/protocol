import fs from "fs";
import path from "path";

enum LogHelperMode {
  Gcp,
  Local,
}

const logHelperMode = process.env.LOG_SILENCER_MODE == "gcp" ? LogHelperMode.Gcp : LogHelperMode.Local;

const localSaveFilePath = `${path.resolve(__dirname)}/relayer-unprofitable-logs`;

export async function saveUnprofitableLog(depositHash: string) {
  if (logHelperMode == LogHelperMode.Local) {
    if (!(await previouslySentUnprofitableLog(depositHash)))
      fs.writeFileSync(localSaveFilePath, `"${depositHash}"\n`, { flag: "a+" });
  }
}

export async function previouslySentUnprofitableLog(depositHash: string) {
  if (logHelperMode == LogHelperMode.Local) {
    try {
      const logFile = fs.readFileSync(localSaveFilePath, "utf8");
      const pastLogs = JSON.parse("[" + logFile.replace(/\r?\n|\r/g, ",").substring(0, logFile.length - 1) + "]");
      return pastLogs.includes(depositHash);
    } catch (error) {
      return false;
    }
  }
}

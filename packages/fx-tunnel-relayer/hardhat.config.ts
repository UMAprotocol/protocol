import { getHardhatConfig } from "@uma/common";
import path from "path";

const coreWkdir = path.dirname(require.resolve("@uma/core/package.json"));
const packageWkdir = path.dirname(require.resolve("@uma/fx-tunnel-relayer/package.json"));

const configOverride = {
  paths: {
    root: coreWkdir,
    sources: `${coreWkdir}/contracts`,
    artifacts: `${coreWkdir}/artifacts`,
    cache: `${coreWkdir}/cache`,
    tests: `${packageWkdir}/test`,
  },
};

export default getHardhatConfig(configOverride, coreWkdir);

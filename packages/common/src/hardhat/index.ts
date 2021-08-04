import fs from "fs";
import path from "path";

["tasks"].forEach((folder) =>
  fs
    .readdirSync(path.join(__dirname, folder))
    .filter((path) => path.endsWith(".js"))
    .forEach((mod) => require(path.join(__dirname, folder, mod)))
);

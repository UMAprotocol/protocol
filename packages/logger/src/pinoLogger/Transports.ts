import { transport } from "pino";

export function createPinoTransports(): ReturnType<typeof transport> {
  const level = "error";
  return transport({
    targets: [
      // stdout (GCP Logging)
      { target: "pino/file", level, options: { destination: 1 } },
    ],
  });
}

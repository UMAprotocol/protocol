import { transport } from "pino";

export function createPinoTransports(): ReturnType<typeof transport> {
  return transport({
    targets: [
      // stdout (GCP Logging)
      { target: "pino/file", options: { destination: 1 } },
    ],
  });
}

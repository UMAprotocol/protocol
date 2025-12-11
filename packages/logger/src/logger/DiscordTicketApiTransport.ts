import Transport from "winston-transport";
import axios from "axios";
import type { AxiosInstance } from "axios";
import * as ss from "superstruct";
import { isDictionary } from "../helpers/typeGuards";
import { TransportError } from "./TransportError";

type TransportOptions = ConstructorParameters<typeof Transport>[0];

const Config = ss.object({
  apiUrl: ss.string(),
  timeoutMs: ss.optional(ss.number()),
});
// Config object becomes a type
// {
//   apiUrl: string;
//   timeoutMs?: number;
// }
export type Config = ss.Infer<typeof Config>;

// this turns an unknown ( like json parsed data) into a config, or throws an error
export function createConfig(config: unknown): Config {
  return ss.create(config, Config);
}

// Interface for log info object.
interface DiscordTicketApiInfo {
  message: string;
  mrkdwn: string;
  discordTicketApiParams: {
    submitTicket: boolean; // Indicates if the ticket should be submitted
  };
}

// Type guard for log info object.
const isDiscordTicketApiInfo = (info: unknown): info is DiscordTicketApiInfo => {
  if (!isDictionary(info)) return false;
  return (
    typeof info.message === "string" &&
    typeof info.mrkdwn === "string" &&
    isDictionary(info.discordTicketApiParams) &&
    typeof info.discordTicketApiParams.submitTicket === "boolean"
  );
};

export class DiscordTicketApiTransport extends Transport {
  private readonly apiUrl: string;
  private readonly axiosInstance: AxiosInstance;

  constructor(winstonOpts: TransportOptions, { apiUrl, timeoutMs }: Config) {
    super(winstonOpts);

    this.apiUrl = apiUrl;

    this.axiosInstance = axios.create({
      timeout: timeoutMs ?? 10000, // Default timeout of 10 seconds
      validateStatus: (status) => {
        return status == 202; // Discord Ticket API enqueues messages with 202 Accepted status
      },
    });
  }

  // Note: info must be any because that's what the base class uses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
  async log(info: any, callback: (error?: unknown) => void): Promise<void> {
    // We only try sending if the logging application has passed required parameters and explicitly requested ticket submission.
    if (isDiscordTicketApiInfo(info) && info.discordTicketApiParams.submitTicket) {
      const payload = { title: info.message, content: info.mrkdwn };

      try {
        await this.axiosInstance.post(this.apiUrl, payload);
      } catch (error) {
        return callback(new TransportError("Discord Ticket API", error, info));
      }
    }
    // Signal we're done here.
    callback();
  }
}

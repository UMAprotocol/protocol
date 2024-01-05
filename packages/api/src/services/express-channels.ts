import Express from "express";
import lodash from "lodash";
import cors from "cors";
import bodyParser from "body-parser";
import assert from "assert";
import type { Request, Response, NextFunction } from "express";
import { BaseConfig, ActionCall } from "../types";
import { Profile } from "../libs/utils";

interface Config extends BaseConfig {
  port: number;
  path?: string;
}
// represents the actions service, a single function which maps to different callable functions
type Channel = [string, ActionCall];
export type Channels = Channel[];
// This is very similar to the original express service, but takes in the idea of channels, basically
// will create paths to different action instances. In most cases each channel should be completely
// independent of other channels.
export default (config: Config, channels: Channels = []): (() => Promise<boolean>) => {
  assert(config.port, "requires express port");
  assert(channels.length, "requires a list of action channels");

  const profile = Profile(config.debug);
  const app = Express();

  app.use(cors());
  app.use(bodyParser.json({ limit: "1mb" }));
  app.use(bodyParser.urlencoded({ extended: true }));

  app.get("/", (req: Request, res: Response) => {
    return res.send("ok");
  });

  const ActionHandler = (actions: ActionCall) => (req: Request, res: Response, next: NextFunction) => {
    const action = req?.params?.action;
    const end = profile(`action: ${action}`);
    actions(action, ...lodash.castArray(req.body))
      .then(res.json.bind(res))
      .catch(next)
      .finally(end);
  };

  // loops over all channels and adds the channel name to the url path. If no name exists it will put it at the root.
  channels.forEach(([path, actions]) => {
    const actionPath = path && path.length ? `/${path}/:action` : "/:action";
    app.post(actionPath, ActionHandler(actions));

    // duplicate get calls
    app.get(actionPath, ActionHandler(actions));
  });

  app.use(cors());

  app.use(function (req: Request, res: Response, next: NextFunction) {
    next(new Error("Invalid Request"));
  });

  // this is an error handler, express knows this because the function has 4 parameters rather than 3
  // cant remove the "next" parameter, even though linting complains
  app.use(function (err: Error, req: Request, res: Response) {
    res.status(500).send(err.message || err);
  });

  return () => {
    return new Promise((res) => {
      app.listen(config.port, () => res(true));
    });
  };
};

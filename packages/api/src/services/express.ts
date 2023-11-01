import Express from "express";
import lodash from "lodash";
import cors from "cors";
import bodyParser from "body-parser";
import assert from "assert";
import type { Request, Response, NextFunction } from "express";
import { Json, BaseConfig } from "../types";
import { Profile } from "../libs/utils";

interface Config extends BaseConfig {
  port: number;
}
// represents the actions service, a single function which maps to different callable functions
type Actions = (action: string, ...args: Json[]) => Promise<Json>;

export default async (config: Config, actions: Actions) => {
  assert(config.port, "requires express port");

  const profile = Profile(config.debug);
  const app = Express();

  app.use(cors());
  app.use(bodyParser.json({ limit: "1mb" }));
  app.use(bodyParser.urlencoded({ extended: true }));

  app.get("/", (req: Request, res: Response) => {
    return res.send("ok");
  });

  function actionHandler(req: Request, res: Response, next: NextFunction) {
    const action = req?.params?.action;

    const end = profile(`action: ${action}`);
    actions(action, ...lodash.castArray(req.body))
      .then(res.json.bind(res))
      .catch(next)
      .finally(end);
  }

  app.post("/:action", actionHandler);

  // duplicate calls on get
  app.get("/:action", actionHandler);

  app.use(cors());

  app.use(function (req: Request, res: Response, next: NextFunction) {
    next(new Error("Invalid Request"));
  });

  // this is an error handler, express knows this because the function has 4 parameters rather than 3
  // cant remove the "next" parameter, even though linting complains
  app.use(function (err: Error, req: Request, res: Response) {
    res.status(500).send(err.message || err);
  });

  return new Promise((res) => {
    app.listen(config.port, () => res(true));
  });
};

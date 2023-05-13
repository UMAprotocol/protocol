# Running UMA Serverless Orchestration Locally With Docker

This document describes how to run the UMA Serverless Orchestration service locally using Docker. This is useful for
testing and debugging bots locally before deploying them to the cloud.

The instructions below assume you have [Docker](https://www.docker.com/) and its Compose plugin installed and its server
daemon is running on the local machine. Also make sure to add your user to `docker` group in order to avoid running
commands as root.

## Build UMA Protocol Docker Image

In order to build local UMA protocol docker image, run the build script:

```sh
yarn workspace @uma/serverless-orchestration local-build
```

This will build two docker images:

- `umaprotocol/protocol:local` for the UMA protocol
- `scheduler:local` for the cron scheduler that will trigger bots through local hub service

## Service configuration

In the `packages/serverless-orchestration/local-docker/` directory create the required `hub.env` and `spoke.env` files
using the provided templates in [`hub.env.template`](./hub.env.template) and [`spoke.env.template`](./spoke.env.template)
respectively.

Place all the tested bot configuration files under the `packages/serverless-orchestration/local-docker/bot-configs/serverless-bots`
directory. Configuration files must be formatted as JSON and have a `.json` extension.

In the [`./bot-configs`](./bot-configs) directory create the required `schedule.json` file using the provided template
in [`schedule.json.example`](./bot-configs/schedule.json.example). This configuration will be used by the cron scheduler
service to trigger bots through the local hub service.

## Start UMA Serverless Orchestration

To start the UMA Serverless Orchestration services run:

```sh
yarn workspace @uma/serverless-orchestration local-up
```

This will start the following services:

- `hub`: local hub service
- `spoke`: local spoke service
- `scheduler`: cron scheduler service

## Stop UMA Serverless Orchestration

To stop the UMA Serverless Orchestration services run:

```sh
yarn workspace @uma/serverless-orchestration local-down
```

## Limitations

Currently, the local UMA Serverless Orchestration does not support running bots that require access to GCP Datastore and
caching service.

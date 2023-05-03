# Running UMA Serverless Orchestration Locally With Docker

This document describes how to run the UMA Serverless Orchestration scripts locally using Docker. This is useful for
testing and debugging bots locally before deploying them to the cloud.

The instructions below assume you have [Docker](https://www.docker.com/) installed and its server daemon is running on
the local machine. Also make sure to add your user to `docker` group in order to avoid running commands as root.

Start by enabling swarm mode so that hub and spoke services can be configured in a single [compose file](./uma.yml):

```sh
docker swarm init
```

## Build UMA Protocol Docker Image

This step is only required if you are testing against a local development branch of the UMA protocol. If you are
testing bot configuration against the published protocol docker image, you can skip this step.

Start the `registry` service:

```sh
docker service create --name registry --publish published=5000,target=5000 registry:2
```

Start the docker build from the root of `protocol` repository:

```sh
docker build -t localhost:5000/protocol:dev .
```

Once build is complete, push it to the local registry service:

```sh
docker push localhost:5000/protocol:dev
```

## Service configuration

In the same directory where `uma.yml` compose file is located create the required `hub.env` and `spoke.env` files using
the provided templates in [hub.env.template](./hub.env.template) and [spoke.env.template](./spoke.env.template)
respectively.

Place all the tested bot configuration files under the [./bot-configs/serverless-bots](./bot-configs/serverless-bots)
directory. Configuration files must be formatted as JSON and have a `.json` extension.

## Start UMA Serverless Orchestration

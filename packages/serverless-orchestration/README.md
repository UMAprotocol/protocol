# @uma/serverless-orchestration

## Installing the package

## Importing the package

## Orchestration Scripts

The two serverless orchestration scripts are:

1. The `ServerlessHub` which reads in a global configuration file stored and executes parallel serverless instances for each configured bot. This enables one global config file to define all bot instances. This drastically simplifying the devops and management overhead for spinning up new instances as this can be done by simply updating a single config file.

1. The `ServerlessSpoke` which enables serverless functions to execute any arbitrary command from the UMA Docker container. This can be run on a local machine, within GCP cloud run or GCP cloud function environments.

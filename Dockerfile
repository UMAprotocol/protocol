# This docker container can be pulled from umaprotocol/protocol on dockerhub.
# To get the latest image, run: docker pull umaprotocol/protocol
# This docker container is used to access all components of the UMA ecosystem
# including liquidator, disputors and monitor bots. Settings for these bots are
# defined via enviroment variables. For example to run a liquidator bot run:
# docker run --env MNEMONIC="<mnemonic>" \
#     --env PAGERDUTY_API_KEY="<pagerduty api key>" \
#     --env PAGERDUTY_SERVICE_ID="<pagerduty service id>" \
#     --env PAGERDUTY_FROM_EMAIL="<from email>" \
#     --env SLACK_WEBHOOK="<slack webhook>" \
#     --env EMP_ADDRESS="<emp address>" \
#     --env POLLING_DELAY="<update delay in ms>" \
#     --env COMMAND="npx truffle exec ../liquidator/index.js --network mainnet_mnemonic" \
#     umaprotocol/protocol:latest
#
# To build the docker image locally, run the following command from the `protocol` directory:
#   docker build -t <username>/<imagename> .
#
# To `docker run` with your locally built image, replace `umaprotocol/protocol` with <username>/<imagename>.

# Fix node version due to high potential for incompatibilities.
FROM node:lts

# All source code and execution happens from the protocol directory.
WORKDIR /protocol

# Copy the latest state of the repo into the protocol directory.
COPY . ./

# Install dependencies and compile contracts.
RUN apt-get update
RUN apt-get install -y libudev-dev libusb-1.0-0-dev jq yarn
RUN npx lerna bootstrap

# Clean and run all package build steps, but exclude dapps (to save time).
RUN yarn lerna run clean --ignore '*/*dapp*'
RUN yarn lerna run build --ignore '*/*dapp*'

# Command to run any command provided by the COMMAND env variable.
ENTRYPOINT ["/bin/bash", "scripts/runCommand.sh"]

# This docker container can be pulled from umaprotocol/protocol on dockerhub. This docker container is used to access 
# all components of the UMA ecosystem. The entry point into the bot is defined using a COMMAND enviroment variable
# that defines what is executed in the root of the protocol package. This container also contains other UMA packages
# that are not in the protocol repo, such as the Across v2 relayer. To access these set a command 

# Fix node version due to high potential for incompatibilities.
FROM node:14

# All source code and execution happens from the protocol directory.
WORKDIR /protocol

# Copy the latest state of the repo into the protocol directory.
COPY . ./

# Install dependencies and compile contracts.
RUN apt-get update
RUN apt-get install -y libudev-dev libusb-1.0-0-dev jq yarn rsync
RUN yarn

# Clean and run all package build steps, but exclude dapps (to save time).
RUN yarn clean
RUN yarn qbuild

# Set up additional UMA packages installed in this docker container.
WORKDIR /across-relayer
RUN git https://github.com/across-protocol/relayer-v2.git
WORKDIR /across-relayer/relayer-v2
RUN mv * ..
WORKDIR /across-relayer
RUN rm -rf relayer-v2
RUN yarn && yarn build

# Set back the working directory to the protocol directory to default to that package.
WORKDIR / protocol

# Command to run any command provided by the COMMAND env variable.
ENTRYPOINT ["/bin/bash", "scripts/runCommand.sh"]

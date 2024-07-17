# This docker container can be pulled from umaprotocol/protocol on dockerhub. This docker container is used to access 
# all components of the UMA ecosystem. The entry point into the bot is defined using a COMMAND enviroment variable
# that defines what is executed in the root of the protocol package. This container also contains other UMA packages
# that are not in the protocol repo, such as the Across v2 relayer. To access these set a command 

# Fix node version due to high potential for incompatibilities.
FROM node:20

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
RUN yarn build

# Set up additional UMA packages installed in this docker container.
# Configuer the across v2 relayer as a "across-relayer" base package.
WORKDIR /across-relayer

# Clode the relayer code and copy it to the across-relayer directory. Remove the package directory.
RUN git clone https://github.com/across-protocol/relayer-v2.git .

# This command fix a concurrency issue when the package was not found.
RUN npx -y only-allow npm

# Install depdencies.
RUN yarn install --frozen-lockfile && yarn build

# Set back the working directory to the protocol directory to default to that package.
WORKDIR /protocol

# Command to run any command provided by the COMMAND env variable.
ENTRYPOINT ["/bin/bash", "scripts/runCommand.sh"]

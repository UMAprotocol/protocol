# This docker container can be pulled from umaprotocol/voting on dockerhub.
# To get the latest image, run:
#   docker pull umaprotocol/voting
#
# Execute the voting system with:
#   docker run
#     --env SENDGRID_API_KEY=<key>
#     --env NOTIFICATION_FROM_ADDRESS=<email address>
#     --env NOTIFICATION_TO_ADDRESS=<email address>
#     --env LOCALHOST=<ethereum host>
#     --env LOCALPORT=<ethereum port>
#     --env MNEMONIC=<mnemonic>
#     --env COMMAND="while true; do $(npm bin)/truffle exec ./scripts/Voting.js --network=<your_network>; sleep 60; done"
#     umaprotocol/voting
#
# To build the docker image locally, run the following command from the `protocol` directory:
#   docker build -t <username>/<imagename> .
#
# To `docker run` with your locally built image, replace `umaprotocol/voting` with <username>/<imagename>.

# Fix node version due to high potential for incompatibilities.
FROM node:11

# Pull down latest version of code from Github.
RUN git clone https://github.com/UMAprotocol/protocol.git
WORKDIR protocol

# Install dependencies and compile contracts.
RUN apt-get update
RUN apt-get install -y libudev-dev libusb-1.0-0-dev
RUN npm install
RUN scripts/buildContracts.sh

# The setup above could probably be extracted to a base Docker image, but that may require modifying the directory
# structure more.
WORKDIR core/

# Command to run any command provided by the COMMAND env variable.
# Use the command listed at the top to run the voting script repeatedly in a 60 second loop.
ENTRYPOINT ["/bin/bash", "scripts/runCommand.sh"]
CMD ["--network=test"]

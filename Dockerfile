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
#     umaprotocol/voting
#     --network=<network>
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
RUN npm install
RUN scripts/buildContracts.sh

# Command to run Voting system. The setup above could probably be extracted to a base Docker image, but that may require
# modifying the directory structure more.
WORKDIR core/
ENTRYPOINT ["/bin/bash", "scripts/runVoting.sh"]
CMD ["--network=test"]

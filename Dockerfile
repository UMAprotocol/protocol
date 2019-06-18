# Fix node version due to high potential for incompatibilities.
FROM node:11

# Pull down latest version of code from Github.
RUN git clone https://github.com/UMAprotocol/protocol.git
WORKDIR protocol

# Install dependencies and compile contracts.
RUN npm install
RUN /bin/bash scripts/buildContracts.sh

# Command to run Voting system. The setup above could probably be extracted to a base Docker image, but that may require
# modifying the directory structure more.
WORKDIR core/
ENTRYPOINT ["/bin/bash", "scripts/runVoting.sh"]
CMD ["--network=test"]

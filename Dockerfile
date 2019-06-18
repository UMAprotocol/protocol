# Fix node version due to high potential for incompatibilities.
FROM node:11

# Pull down latest version of code from Github.
RUN git clone https://github.com/UMAprotocol/protocol.git
WORKDIR protocol

# DO NOT SUBMIT. Remove these lines before/after submission.
COPY scripts/buildContracts.sh scripts/
COPY core/scripts/runVoting.sh core/scripts/
COPY core/scripts/Voting.js core/scripts/

# Install dependencies and compile contracts.
RUN npm install
RUN /bin/bash scripts/buildContracts.sh

# Command to run Voting system. The setup above could probably be extracted to a base Docker image, but that may require
# modifying the directory structure more.
WORKDIR core/
CMD ["/bin/bash", "scripts/runVoting.sh", "--network=ropsten"]

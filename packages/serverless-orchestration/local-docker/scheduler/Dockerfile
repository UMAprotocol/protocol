# Pulling Alpine image
FROM alpine:latest

# Setting up work directory
WORKDIR /scheduler

# Updating the packages
RUN apk update && \
apk upgrade --available && sync

# Installing curl and jq
RUN apk add curl
RUN apk add jq

# Copying bot runner and entrypoint script into container
COPY run-bots.sh .
COPY entrypoint.sh .

# Setting up permissions for the scripts
RUN chmod +x run-bots.sh
RUN chmod +x entrypoint.sh

# Creating entry point to the script that parses environment and starts crond
ENTRYPOINT ["/scheduler/entrypoint.sh"]
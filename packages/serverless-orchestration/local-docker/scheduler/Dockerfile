# Pulling Alpine image
FROM alpine:latest

# Setting up work directory
WORKDIR /scheduler

# Updating the packages
RUN apk update && \
apk upgrade --available && sync

# Installing curl
RUN apk add curl

# Copying bot runner script into container
#COPY scripts/run-bots.sh .

# Creating entry point for crond with crontab config
#ENTRYPOINT ["crond", "-f", "-c", "/scheduler/", "-l", "0", "-L", "/dev/stdout"]
ENTRYPOINT ["crond", "-f"]

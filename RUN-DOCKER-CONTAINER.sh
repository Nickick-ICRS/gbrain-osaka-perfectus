#!/bin/bash
# Brings the gbrain dev container up (terminator GUI) and drops you into a
# bash shell inside it.
#
# Usage: ./RUN-DOCKER-CONTAINER.sh <optional: project>
################################################################################

# Source the environment file if it exists
if [ -f "docker.env" ]; then
    source docker.env
fi

# Set the Docker container name from a project name (first argument).
# If no argument is given, use DOCKER_PROJECT_NAME from env file, or fall back to current user name
PROJECT=$1
if [ -z "${PROJECT}" ]; then
    if [ -n "${DOCKER_PROJECT_NAME}" ]; then
        PROJECT=${DOCKER_PROJECT_NAME}
    else
        PROJECT=${USER}
    fi
fi
CONTAINER="${PROJECT}-gbrain-1"
echo "$0: PROJECT=${PROJECT}"
echo "$0: CONTAINER=${CONTAINER}"

# Run the Docker container in the background.
# Any changes made to './docker/docker-compose.yml' will recreate and overwrite the container.
docker compose -p ${PROJECT} -f ./docker/docker-compose.yml up -d

################################################################################

# Display GUI through X Server by granting access to local clients.
xhost +local: 2>/dev/null || xhost +

################################################################################

# Enter the Docker container with a Bash shell.
docker exec -it ${CONTAINER} bash
# Or launch a fresh terminator window instead:
# docker exec -it ${CONTAINER} terminator &

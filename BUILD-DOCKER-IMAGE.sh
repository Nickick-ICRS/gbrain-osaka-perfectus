#!/bin/bash
# Builds the gbrain dev docker image (Bun toolchain + terminator).
#
# Usage: ./BUILD-DOCKER-IMAGE.sh <optional: project>
#
# @param <project> [optional] docker-compose project name (container naming).
#                  Default: DOCKER_PROJECT_NAME from docker.env, else $USER.
################################################################################

# Source the environment file if it exists
if [ -f "docker.env" ]; then
    source docker.env
fi

# Set the Docker container name from a project name (first argument).
# If no argument is given, use DOCKER_PROJECT_NAME from env file, or fall back to current user name
DOCKER_PROJECT=$1
if [ -z "${DOCKER_PROJECT}" ]; then
    if [ -n "${DOCKER_PROJECT_NAME}" ]; then
        DOCKER_PROJECT=${DOCKER_PROJECT_NAME}
    else
        DOCKER_PROJECT=${USER}
    fi
fi
DOCKER_CONTAINER="${DOCKER_PROJECT}-gbrain-1"
echo "$0: DOCKER_PROJECT=${DOCKER_PROJECT}"
echo "$0: DOCKER_CONTAINER=${DOCKER_CONTAINER}"

# Stop and remove the Docker container.
EXISTING_DOCKER_CONTAINER_ID=`docker ps -aq -f name=${DOCKER_CONTAINER}`
if [ ! -z "${EXISTING_DOCKER_CONTAINER_ID}" ]; then
  echo "Stop the container ${DOCKER_CONTAINER} with ID: ${EXISTING_DOCKER_CONTAINER_ID}."
  docker stop ${EXISTING_DOCKER_CONTAINER_ID}
  echo "Remove the container ${DOCKER_CONTAINER} with ID: ${EXISTING_DOCKER_CONTAINER_ID}."
  docker rm ${EXISTING_DOCKER_CONTAINER_ID}
fi

################################################################################

# Build the image via docker-compose.
docker compose -p ${DOCKER_PROJECT} -f ./docker/docker-compose.yml build

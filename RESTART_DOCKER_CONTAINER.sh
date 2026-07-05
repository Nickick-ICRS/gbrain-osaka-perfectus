#!/bin/bash
# Restarts the gbrain dev container.
#
# Usage: bash RESTART_DOCKER_CONTAINER.sh [project]
# [project]: selects the container to restart. Default: DOCKER_PROJECT_NAME / $USER.
#################################################################################

# Source the environment file if it exists
if [ -f "docker.env" ]; then
    source docker.env
fi

# Set the Docker container name from the [project] argument.
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

################################################################################

# Display the Docker container status.
DOCKER_STATUS=`docker ps -a -f "Name=${DOCKER_CONTAINER}" --format "{{.Status}}" | cut -d ' ' -f 1`
echo "$0: DOCKER_STATUS=${DOCKER_STATUS}"

################################################################################

# If the container is running, stop it.
if [ "$DOCKER_STATUS" == "Up" ]; then
  echo "Stopping ${DOCKER_CONTAINER}..."
  docker stop ${DOCKER_CONTAINER}
  echo "${DOCKER_CONTAINER} stopped."
fi

# Remove the container if it exited.
DOCKER_STATUS=`docker ps -a -f "Name=${DOCKER_CONTAINER}" --format "{{.Status}}" | cut -d ' ' -f 1`
echo "$0: DOCKER_STATUS=${DOCKER_STATUS}"
if [ "$DOCKER_STATUS" == "Exited" ]; then
  echo "Removing ${DOCKER_CONTAINER}..."
  docker rm ${DOCKER_CONTAINER}
  echo "${DOCKER_CONTAINER} removed."
fi

echo "Starting ${DOCKER_CONTAINER}..."
docker start ${DOCKER_CONTAINER}
echo "${DOCKER_CONTAINER} started."

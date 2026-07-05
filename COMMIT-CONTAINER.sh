#!/bin/bash
# Snapshots the running gbrain container into a dated image and rewires
# docker-compose.yml to use it.
#
# Usage: ./COMMIT-CONTAINER.sh <optional: project>
################################################################################

# Source the environment file if it exists
if [ -f "docker.env" ]; then
    source docker.env
fi

# Set the Docker container name from a project name (first argument).
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

# Get current date in day-month-year format.
DATE_TAG=$(date +%d-%m-%Y)
IMAGE_NAME="gbrain:${DATE_TAG}"

# Update the image name in docker-compose.yml.
sed -i "s#image: gbrain:.*#image: ${IMAGE_NAME}#" ./docker/docker-compose.yml

# Stop the current container.
echo "Stopping container ${CONTAINER}..."
docker stop ${CONTAINER}

# Commit the current container state to a new image.
echo "Committing container ${CONTAINER} to new image ${IMAGE_NAME}..."
docker commit -p ${CONTAINER} ${IMAGE_NAME}

# Remove the old container.
echo "Removing old container ${CONTAINER}..."
docker rm ${CONTAINER}

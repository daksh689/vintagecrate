#!/usr/bin/env bash
# Exit on error
set -e

echo "=== Starting Build ==="

# 1. Install python dependencies
pip install -r requirements.txt

# 2. Download portable Node.js binary for Linux x64 (Render environment)
NODE_VERSION="v20.11.0"
NODE_DIR="node-$NODE_VERSION-linux-x64"
NODE_TAR="$NODE_DIR.tar.xz"

if [ ! -d "$NODE_DIR" ]; then
    echo "Downloading portable Node.js $NODE_VERSION..."
    curl -O https://nodejs.org/dist/$NODE_VERSION/$NODE_TAR
    tar -xf $NODE_TAR
    rm -f $NODE_TAR
    echo "Node.js downloaded successfully."
else
    echo "Node.js already present."
fi

# 3. Create a symbolic link or add node to local bin path
mkdir -p bin
ln -sf "../$NODE_DIR/bin/node" bin/node

echo "=== Build Completed ==="

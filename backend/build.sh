#!/usr/bin/env bash
# Exit on error
set -e

echo "=== Starting Build ==="

# 1. Install python dependencies
pip install -r requirements.txt

# 2. Install ffmpeg (required by yt-dlp for audio conversion)
if ! command -v ffmpeg &> /dev/null; then
    echo "Installing ffmpeg..."
    apt-get update && apt-get install -y --no-install-recommends ffmpeg
    echo "ffmpeg installed successfully."
else
    echo "ffmpeg already available."
fi

# 3. Download portable Node.js binary for Linux x64 (Render environment)
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

# 4. Create a symbolic link or add node to local bin path
mkdir -p bin
ln -sf "../$NODE_DIR/bin/node" bin/node

# 5. Ensure music_vault directory exists
mkdir -p ../music_vault

echo "=== Build Completed ==="

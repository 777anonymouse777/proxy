#!/bin/bash

# Create distribution directory
mkdir -p dist

# Install dependencies
npm install

# Build executables
npm run build

# Create distribution package
cd dist
mkdir -p proxy-server-dist
cp proxy-server-macos proxy-server-dist/
cp proxy-server-linux proxy-server-dist/
cp proxy-server-win.exe proxy-server-dist/
cp -r ../public proxy-server-dist/
cp -r ../data proxy-server-dist/
cp ../.env proxy-server-dist/
cp ../README.md proxy-server-dist/

# Create zip file
zip -r proxy-server-dist.zip proxy-server-dist/

echo "Distribution package created: dist/proxy-server-dist.zip" 
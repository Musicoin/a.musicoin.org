#!/bin/bash

echo "Pulling changes from git..."
cd /musicoin.org
git pull

echo "Running npm install..."
npm install --production

echo "Compiling type script ..."
tsc

echo "Restarting forever processes..."
forever restartall

echo "Done."
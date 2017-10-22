#!/bin/bash

echo "Starting ipfs..."
cd /
/go-ipfs/ipfs daemon --init=true --migrate=true >> ipfs.log 2>&1 &

echo "Starting pm2 script..."
pm2 start /musicoin.org/src/server.js --max-restarts 10000000

echo "Setting up jenkins monitor.."
touch /home/jenkins/monitor
chown jenkins /home/jenkins/monitor
/musicoin.org/script/watch-file.sh /home/jenkins/monitor /musicoin.org/script/302_update.sh >> mc_watch.log 2>&1 &

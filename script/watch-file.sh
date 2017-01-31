#!/bin/bash

while [ true ]
do
    echo "Waiting for changes to $1..."
    if inotifywait $1
    then
      echo "Detected changes, running $2"
      eval $2
    fi
done
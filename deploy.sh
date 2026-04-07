#!/bin/sh
rsync -avz -e "ssh -p 4561" --delete --exclude '.git' --exclude '.venv' /home/lukas/Documents/Projects/tracking_helper/ root@212.132.68.199:~/projects/lukas-reindl/html/tracking/

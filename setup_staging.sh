#!/bin/bash
sudo addgroup msgsvc
sudo useradd --system --no-create-home --gid msgsvc -s /bin/false msgsvc
sudo mkdir -p /var/www/ccred-staging
sudo mkdir -p /opt/simple-message-backend-staging/message_db/journals
sudo chown -R msgsvc:msgsvc /opt/simple-message-backend-staging

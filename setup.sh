#!/bin/bash
sudo addgroup msgsvc
sudo useradd --system --no-create-home --gid msgsvc -s /bin/false msgsvc
sudo mkdir /opt/simple-message-backend
sudo mkdir /opt/simple-message-backend/message_db
sudo mkdir /opt/simple-message-backend/message_db/journals
sudo chown -R msgsvc:msgsvc /opt/simple-message-backend

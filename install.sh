#!/bin/bash
. "$HOME/.cargo/env"
cargo build --release
sudo systemctl stop simple-message-backend.service
sudo cp simple-message-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo cp target/release/simple-message-backend /opt/simple-message-backend/
sudo systemctl enable simple-message-backend.service
sudo systemctl start simple-message-backend.service
sudo rm -rf /var/www/ccred/*
sudo cp -r dist/* /var/www/ccred/
sudo gzip -9 -k /var/www/ccred/assets/*
sudo service nginx reload

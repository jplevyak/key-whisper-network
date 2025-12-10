#!/bin/bash
. "$HOME/.cargo/env"
cargo build --release
sudo systemctl stop simple-message-backend-staging.service
sudo cp target/release/simple-message-backend /opt/simple-message-backend-staging/
sudo systemctl start simple-message-backend-staging.service
sudo rm -rf /var/www/ccred-staging/*
sudo cp -r dist/* /var/www/ccred-staging/
sudo gzip -9 -k /var/www/ccred-staging/assets/*
sudo service nginx reload

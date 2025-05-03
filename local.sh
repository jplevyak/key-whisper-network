cargo build --release
sudo systemctl stop simple-message-backend.service
sudo cp target/release/simple-message-backend /opt/simple-message-backend/
sudo systemctl start simple-message-backend.service
npm i
npm run build
sudo rm -rf /var/www/ccred/*
sudo cp -r dist/* /var/www/ccred/
sudo gzip -9 -k /var/www/ccred/assets/*
sudo service nginx reload

npm i
npm run build
sudo cp -r dist/* /var/www/ccred/
cargo build --release
sudo systemctl stop simple-message-backend.service
sudo cp target/release/simple-message-backend /opt/simple-message-backend/
sudo systemctl start simple-message-backend.service

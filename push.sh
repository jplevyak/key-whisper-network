#!/bin/bash
rustup update
cargo build --release
npm i
npm run build
rsync -av --delete --exclude /.git . oracle1.dnsalias.org:key-whisper-network
ssh oracle1 "(cd key-whisper-network; ./install.sh)"

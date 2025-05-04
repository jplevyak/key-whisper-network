#!/bin/bash
npm i
npm run build
rsync -av --delete --exclude /.git --exclude target --exclude node_modules . oracle1:key-whisper-network
ssh oracle1 "(cd key-whisper-network; ./install.sh)"

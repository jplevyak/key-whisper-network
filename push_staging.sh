#!/bin/bash
npm i
npm run build
rsync -av --delete --exclude /.git --exclude target --exclude node_modules --exclude '.aider*' . oracle1:key-whisper-network-staging
ssh oracle1 "(cd key-whisper-network-staging; ./install_staging.sh)"

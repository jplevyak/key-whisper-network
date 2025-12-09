# CCred Network

CCred Network is a secure, end-to-end encrypted messaging application. It provides a secure way to exchange messages using quantum-safe AES end-to-end encryption to protect your communications.

## Features

- **Secure End-to-End Encryption**: All messages are encrypted using quantum-safe AES. Unique secret keys are established between contacts through a QR code exchange and remain exclusively on their respective devices. This ensures that only the intended recipients can decrypt and read messages.
- **Passkey PRF Enhanced Security**: For an added layer of security, when supported by the device and browser (e.g., modern mobile devices or systems with security keys), the unique message encryption keys are further protected. They are encrypted with a key derived via the user's passkey PRF (Pseudo-Random Function) extension, significantly strengthening key security.
- **QR Code Based Contact Management**: Easily add new contacts by either scanning their QR code or by generating your own QR code for them to scan.
- **Automatic Encryption/Decryption**: Messages are automatically encrypted before sending and decrypted upon receipt, providing a seamless secure communication experience.
- **Local Conversation Control**: Users can clear the conversation history for any contact on their own device using a dedicated trash icon in the chat interface.
- **Secure Message Forwarding**: Messages can be forwarded to other contacts securely, maintaining the end-to-end encryption.
- **Flexible Group Tagging**: Create "group" tags locally to categorize contacts. This allows sending the same message to multiple contacts by associating it with a group name. Recipients see the group name attached to the message and can choose to create their own local group with that name, managing their own contact associations for that group. Group memberships are not synchronized between users, maintaining privacy and local control.
- **Push Notifications**: Stay updated with new messages through push notifications (requires PWA installation and user permission on some platforms).
- **Progressive Web App (PWA)**: Installable as a PWA for a more native app-like experience on supported devices.

## Usage

### How to Use

-   Add contacts by scanning their QR code or generating your own for them to scan.
-   Select a contact to start a conversation.
-   Messages are automatically encrypted and decrypted.
-   Use the trash icon in the chat header to clear the conversation history on your device.
-   Forward messages securely using the forward icon on a message bubble.

### Understanding Groups

-   Groups in CCred are tags you create to easily send the same message to multiple existing contacts at once.
-   When you send a message "via" a group name to a contact, they receive the message with that group name attached.
-   The recipient can then choose to create their own local group with that name. They can associate messages tagged with this group name to their local group.
-   It's up to each recipient to decide which of their own contacts (if any) to add to their version of the group. Group memberships are not automatically synchronized between users.

### Creating a Passkey

CCred Network utilizes passkeys for user authentication, offering a more secure and user-friendly alternative to traditional passwords. Passkeys are a form of phishing-resistant credentials that are typically tied to your device (like a fingerprint or face scan) or a hardware security key.

**The Power of PRF (Pseudo-Random Function)**

A key security enhancement used by CCred Network is the passkey's PRF (Pseudo-Random Function) extension. When available, this allows the application to derive a unique, stable encryption key directly from your passkey. This derived key is then used to encrypt the local database where your contact-specific encryption keys are stored.

*   **Why is PRF important?** It means that even if someone gained access to your device's raw storage, they still couldn't decrypt your sensitive contact keys without authenticating via your passkey (and thus invoking the PRF). This significantly hardens the security of your encrypted communications. The key derived via PRF never leaves the authenticator (e.g., your phone's secure enclave or a hardware security key).

**PRF Support (as of May 2025 - based on general WebAuthn PRF adoption trends):**

The availability of the PRF extension depends on the operating system, browser, and the type of authenticator used:

*   **Supported (Generally Good Support for PRF):**
    *   **iOS/iPadOS (17.5+):** Passkeys synced via iCloud Keychain generally support PRF.
    *   **macOS (Sonoma 14.5+):** Passkeys synced via iCloud Keychain, and some hardware security keys, support PRF when used with Safari or Chrome.
    *   **Android (14+):** Passkeys managed by Google Password Manager generally support PRF when used with Chrome.
    *   **Hardware Security Keys:** Many modern FIDO2 hardware security keys (like YubiKey 5 series or newer) support the PRF extension when used with a compatible browser (Chrome, Safari) on a supportive OS.

*   **Limited or No PRF Support:**
    *   **Windows Hello:** As of April 2025, passkeys created and managed by Windows Hello (e.g., using fingerprint or PIN directly on a Windows machine) **do not** typically support the PRF extension.
        *   **Workaround for Windows Users:** To get the PRF-enhanced security on Windows, you should use a **hardware security key** that supports PRF (e.g., a YubiKey) with a compatible browser like Chrome. The passkey will be stored on the hardware key itself.
    *   **Firefox:**
        *   On **macOS**, Firefox does not currently support PRF for passkeys.
        *   On **Android**, Firefox's passkey implementation may also lack PRF support.
        *   On **Windows and Linux**, Firefox's PRF support can be variable and may depend on interactions with hardware keys.
    *   **Linux:** PRF support can vary depending on the browser, how passkeys are managed (e.g., browser-stored vs. hardware key), and the specific hardware key. Chrome with a PRF-capable hardware security key is the most likely combination to work.

When you register with CCred Network, the application will attempt to use the PRF extension if your browser and authenticator support it. If PRF is not available, your local data is still encrypted, but with a key managed by the browser's standard secure storage mechanisms, which might not offer the same level of binding to your passkey authentication. For maximum security, using a platform and authenticator that supports PRF is highly recommended.

## Security

CCred Network employs multiple layers of security to protect your communications and locally stored data:

-   **Non-Extractable Contact Keys**: When you establish a secure connection with a contact (e.g., by scanning a QR code), a unique shared secret key is generated. This key is stored on your device as a non-extractable `CryptoKey` using the Web Crypto API. This means the key material itself cannot be exported or read out by JavaScript or browser extensions, providing strong protection against exfiltration attempts. All messages exchanged with that contact are end-to-end encrypted using this non-extractable key.

-   **Layered Encryption with Passkey PRF**:
    -   The primary layer of message encryption uses the unique, non-extractable AES key established with each contact.
    -   If your device and browser support the Passkey PRF (Pseudo-Random Function) extension, an additional layer of security is applied to your *local data store*. The entire local database, which includes these contact-specific encryption keys and message metadata, is encrypted using a master key derived from your passkey via PRF.
    -   This means that even if an attacker could somehow bypass the non-extractable nature of the contact keys (e.g., through a compromised browser environment with elevated privileges), they would still need to overcome the PRF-derived encryption of the database itself to access the stored keys. This provides robust defense-in-depth, ensuring that your sensitive communication keys are exceptionally well-protected.

This multi-layered approach ensures that your messages are secure both in transit (via end-to-end encryption) and at rest on your device (via non-extractable keys and optional PRF-based database encryption).

## Installation

CCred Network is a Progressive Web App (PWA). For the best experience, including features like push notifications, it's recommended to install it to your device.

### PWA Installation and Enabling Notifications

-   **iOS (Safari):**
    -   To install as a PWA: Tap the Share icon in Safari, then select "Add to Home Screen".
    -   To enable notifications:
        -   First, ensure notifications are enabled for Safari in your device settings: Go to Settings > Safari > Advanced > Experimental Features, and ensure "Notifications" is toggled ON. (Note: iOS PWA notification support can vary).
        -   Open the installed app from your Home Screen. If prompted for notification permission, please accept.
        -   You may also need to enable notifications for the specific "web app" in Settings > Notifications.

-   **Android (Chrome):**
    -   To install as a PWA: Look for an "Install app" option in Chrome's menu (three dots) or an install prompt that may appear.
    -   To enable notifications:
        -   When prompted by the app or browser, tap "Allow".
        -   If you initially denied permission, you can change this by going to Chrome Settings > Site Settings > Notifications, find CCred, and allow notifications.

-   **Desktop (Chrome, Edge on Windows/macOS/Linux):**
    -   To install as a PWA: Look for an install icon (often a computer with a down arrow) in the address bar or in the browser's menu.
    -   To enable notifications:
        -   Click the lock icon in the address bar next to the CCred URL.
        -   Find "Notifications" in the permissions dropdown and set it to "Allow".
        -   You may need to refresh the page for changes to take effect.

*Note: The exact steps for PWA installation and enabling notifications can vary slightly depending on your operating system version and browser.*

## Backend Protocol

The CCred Network backend is designed with a strong emphasis on user anonymity and data privacy. It operates without any concept of user accounts, logins, or traditional authentication mechanisms. Communication channels are identified by 256-bit secure hashes, and the backend's role is primarily to store and forward end-to-end encrypted (E2EE) message blobs. The client applications are responsible for all encryption and decryption using 256-bit AES, ensuring that the backend never has access to plaintext message content.

The backend exposes a simple HTTP API for message handling:

### API Endpoints

All API endpoints are POST requests.

#### 1. `/api/put-message`

This endpoint is used to submit a new encrypted message to a specific channel.

*   **Request Body**:
    ```json
    {
      "message_id": "string", // The 256-bit secure hash identifying the communication channel
      "message": "string"     // The E2EE encrypted message content (opaque to the backend)
    }
    ```
*   **Functionality**:
    *   The backend stores the `message` associated with the `message_id` and a server-generated timestamp. This allows multiple messages to exist within the same channel, ordered by time.
    *   If any clients are currently long-polling the `/api/get-messages` endpoint for this `message_id`, they are notified of the new message.
    *   If a push notification subscription is associated with this `message_id`, a push notification is triggered.
*   **Response**:
    *   `201 Created`: If the message is successfully stored.

#### 2. `/api/get-messages`

This endpoint allows clients to retrieve encrypted messages for one or more channels. It supports long polling for near real-time message delivery and allows clients to register for push notifications.

*   **Request Body**:
    ```json
    {
      "message_ids": ["string"], // An array of 256-bit secure channel hashes
      "timeout_ms": "number (optional)", // Duration in milliseconds for long polling (e.g., 300000 for 5 minutes)
      "push_subscription": { // Optional: To register for push notifications
        "endpoint": "string",    // Push service URL
        "keys": {
          "p256dh": "string",  // Public key for P-256 ECDH
          "auth": "string"     // Authentication secret
        }
      }
    }
    ```
*   **Functionality**:
    *   If `push_subscription` is provided, the backend associates this subscription with all `message_ids` in the request. When new messages arrive for these channels (via `/api/put-message`), the backend will attempt to send a push notification to the registered `endpoint`.
    *   The backend checks for any stored messages matching the provided `message_ids`.
    *   **If messages are found**: They are returned immediately.
    *   **If no messages are found**: The request enters a long polling state. The server holds the connection open until:
        *   A new message arrives for one of the `message_ids`.
        *   The `timeout_ms` duration is reached.
        *   The server also periodically re-checks the database during the long poll.
*   **Response**:
    *   `200 OK` with a JSON body:
        ```json
        {
          "results": [
            {
              "message_id": "string", // The channel hash
              "message": "string",    // The E2EE encrypted message content
              "timestamp": "string"   // ISO 8601 timestamp (UTC) of when the message was stored
            }
            // ... more messages
          ]
        }
        ```
        The `results` array will be empty if the timeout is reached without new messages.

#### 3. `/api/ack-messages`

This endpoint is used by clients to acknowledge receipt of specific messages, which subsequently leads to their deletion from the backend. This helps manage storage and ensures messages are removed after being processed by the client.

*   **Request Body**:
    ```json
    {
      "acks": [
        {
          "message_id": "string", // The channel hash of the message to acknowledge
          "timestamp": "string"   // The ISO 8601 timestamp of the specific message to acknowledge
        }
        // ... more acknowledgements
      ]
    }
    ```
*   **Functionality**:
    *   The backend deletes each message identified by the combination of `message_id` and `timestamp` from its store.
    *   Operations are typically batched for efficiency.
*   **Response**:
    *   `200 OK`: If the acknowledgements are processed successfully.

This design ensures that the backend remains a simple, stateless (in terms of user identity) message broker, deferring all security and interpretation of data to the end-user clients.

## Running Tests

To run the automated tests for the application:

1.  **Install dependencies** (if not already done):
    ```sh
    npm install
    ```

2.  **Run tests only once**:
    ```sh
    npm test run
    ```

3.  **Run tests in watch mode**:
    ```sh
    npm test
    ```

## Editing and building

```sh
git clone git@github.com:jplevyak/ccred.git
npm i
cargo build
```

## Deplyment

### Setup

The initial server setup involves creating a dedicated user and group for the backend service, along with the necessary directories. This is typically done once.

Below is the content of the `simple-message-backend.service` file, which should be placed in a standard systemd service directory (e.g., `/etc/systemd/system/`). This service file configures how the backend application is run, managed, and secured. It ensures the backend runs as a non-privileged user (`msgsvc`) and includes various security hardening options.

```systemd
[Unit]
Description=Simple Message Backend Service
Documentation=https://example.com/docs
After=network-online.target
Wants=network-online.target

[Service]
# --- User and Permissions ---
# It's highly recommended to run as a non-privileged user.
# Create this user and group first if they don't exist:
#   sudo groupadd --system msgsvc
#   sudo useradd --system --no-create-home --gid msgsvc -s /bin/false msgsvc
User=msgsvc
Group=msgsvc

# Set the working directory for the service.
# This should typically be where your executable and database directory reside.
WorkingDirectory=/opt/simple-message-backend

# --- Execution Settings ---
# Set the full path to your compiled Rust binary.
ExecStart=/opt/simple-message-backend/simple-message-backend
#ExecStart=/usr/bin/strace -f -o /opt/simple-message-backend/service_startup_trace.txt /opt/simple-message-backend/simple-message-backend

# --- Process Management ---
# Restart the service automatically if it fails.
Restart=on-failure
# Wait 5 seconds before attempting a restart.
RestartSec=5s
# Set a reasonable timeout for stopping the service.
TimeoutStopSec=10s

# --- Environment Variables ---
# Set environment variables needed by your application.
# Example: Logging level (uses RUST_LOG standard).
Environment="RUST_LOG=info"
# Example: If you make the DB path configurable via env var:
# Environment="DATABASE_PATH=/opt/simple-message-backend/message_db"
# Example: If you make the listen address/port configurable:
# Environment="LISTEN_ADDR=0.0.0.0:3000"

# --- Security Hardening (Recommended) ---
# Prevent the service from writing to /usr, /boot, /etc.
#ProtectSystem=strict
# Provide a private /tmp directory.
PrivateTmp=true
# Prevent privilege escalation.
NoNewPrivileges=true
# Restrict access to physical devices.
PrivateDevices=true
# Protect kernel tuning parameters (/proc/sys, /sys).
ProtectKernelTunables=true
# Protect control groups (/sys/fs/cgroup).
ProtectControlGroups=true
# Protect the kernel modules system.
ProtectKernelModules=true
# Protect home directories (if not needed). Consider 'read-only' if needed.
ProtectHome=true
# Limit the capabilities the process retains (drop most).
CapabilityBoundingSet=~CAP_SYS_ADMIN CAP_NET_ADMIN CAP_NET_BIND_SERVICE # Adjust if specific caps needed, e.g. CAP_NET_BIND_SERVICE if binding to port < 1024 as non-root

# --- Standard Output/Error Logging ---
# Redirect stdout and stderr to the systemd journal. Use `journalctl` to view.
StandardOutput=journal
StandardError=journal

[Install]
# Enable the service to start automatically during multi-user system startup.
WantedBy=multi-user.target
```

After creating the service file (e.g., at `/etc/systemd/system/simple-message-backend.service`), you would typically enable and start it with commands like:
```sh
sudo systemctl daemon-reload
sudo systemctl enable simple-message-backend.service
sudo systemctl start simple-message-backend.service
```

To perform the initial user and directory setup required by the service, execute the following script as root or with `sudo`:

```sh
#!/bin/bash
sudo addgroup msgsvc
sudo useradd --system --no-create-home --gid msgsvc -s /bin/false msgsvc
sudo mkdir /opt/simple-message-backend
sudo mkdir /opt/simple-message-backend/message_db
sudo mkdir /opt/simple-message-backend/message_db/journals
sudo chown -R msgsvc:msgsvc /opt/simple-message-backend
```

### Install

To deploy or update the application, run the following script. It builds the Rust backend, copies the new backend executable, restarts the backend service, deploys the frontend static assets to the web server directory, compresses them, and reloads the web server (Nginx in this example).

```sh
#!/bin/bash
. "$HOME/.cargo/env"
cargo build --release
sudo systemctl stop simple-message-backend.service
sudo cp target/release/simple-message-backend /opt/simple-message-backend/
sudo systemctl start simple-message-backend.service
sudo rm -rf /var/www/ccred/*
sudo cp -r dist/* /var/www/ccred/
sudo gzip -9 -k /var/www/ccred/assets/*
sudo service nginx reload
```

### Nginx Configuration Example

Below is an example Nginx configuration for serving the CCred Network frontend and proxying API requests to the backend service. This configuration should typically be placed in `/etc/nginx/sites-available/yourdomain.com` and then symlinked to `/etc/nginx/sites-enabled/`.

Remember to replace `ccred.xyz` with your actual domain name and update paths to SSL certificates if necessary. This example assumes you are using Certbot for SSL certificate management.

```nginx
server {
  server_name ccred.xyz; # Replace with your domain

  # Serve static frontend files
  location /index.html {
    root /var/www/ccred; # Path to your frontend build output
  }

  location / {
    root /var/www/ccred; # Path to your frontend build output
    try_files $uri $uri/ /index.html; # Important for single-page applications

    # Gzip settings for frontend assets
    gzip on;
    gzip_comp_level 6;
    gzip_min_length 1000;
    gzip_proxied no-cache no-store private expired auth;
    gzip_vary on;
    gzip_http_version 1.1;
    gzip_static on; # Serve pre-gzipped files if available (e.g., .js.gz)
    gzip_types text/plain text/css application/javascript application/json text/xml image/svg+xml;
  }

  # Proxy API requests to the backend service
  location /api/ {
    proxy_pass http://localhost:3000; # Assuming backend runs on port 3000
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # For SSE or Long Poll (used by /api/get-messages)
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }

  # SSL Configuration (managed by Certbot)
  listen 443 ssl;
  ssl_certificate /etc/letsencrypt/live/ccred.xyz-0001/fullchain.pem; # Update with your cert path
  ssl_certificate_key /etc/letsencrypt/live/ccred.xyz-0001/privkey.pem; # Update with your key path
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

  # Optional: Redirect HTTP to HTTPS
  # listen 80;
  # return 301 https://$host$request_uri;
}
```

After saving this configuration, you would typically test it with `sudo nginx -t` and then reload Nginx with `sudo systemctl reload nginx`.

## This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
- Rust
- Tokio
- Tower
- Axum

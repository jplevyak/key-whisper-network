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

## How can I edit this code?

There are several ways of editing this application:

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

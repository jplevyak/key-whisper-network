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

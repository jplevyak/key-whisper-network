// Define the structure for the put-message request body
interface PutMessageRequestBody {
  message_id: string; // This is the encrypted request ID
  message: string; // Base64 encoded encrypted message content
}

/**
 * Sends a message to the /api/put-message endpoint.
 * @param requestId The encrypted request ID for the message.
 * @param encryptedMessageBase64 The base64 encoded encrypted message content.
 * @returns True if the message was successfully sent to the server, false otherwise.
 * @throws Error if the API response is not ok, allowing the caller to handle specific error statuses.
 */
export async function putMessage(
  requestId: string,
  encryptedMessageBase64: string,
): Promise<boolean> {
  const response = await fetch("/api/put-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message_id: requestId,
      message: encryptedMessageBase64,
    } as PutMessageRequestBody),
  });

  if (!response.ok) {
    // Throw an error with status and text to allow for more specific error handling by the caller
    throw new Error(
      `API error ${response.status}: ${await response.text()}`,
    );
  }
  return true; // Indicates success
}

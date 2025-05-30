/**
 * Updates the app badge with the given count.
 * If the count is 0, it clears the badge.
 * Requires the Badging API to be supported by the browser.
 *
 * @param count The number to display on the app badge.
 */
export const updateAppBadge = async (count: number): Promise<void> => {
  // Check if the Badging API is supported
  if ("setAppBadge" in navigator && "clearAppBadge" in navigator) {
    try {
      const currentBadge = await (navigator as any).getBadge?.(); // Optional: check current badge if needed
      if (count > 0) {
        if (typeof currentBadge === 'number' && currentBadge === count) {
          // console.log(`App badge already set to ${count}, no change needed.`);
          return;
        }
        await (navigator as any).setAppBadge(count);
        // console.log(`App badge set to ${count}`);
      } else {
        if (typeof currentBadge === 'number' && currentBadge === 0) {
            // console.log("App badge already cleared, no change needed.");
            return;
        }
        await (navigator as any).clearAppBadge();
        // console.log("App badge cleared.");
      }
    } catch (error) {
      console.error("Error updating app badge:", error);
    }
  } else {
    // console.log("App Badging API is not supported in this browser.");
  }
};

/**
 * Explicitly clears the app badge.
 * Useful for scenarios like application cleanup or logout.
 */
export const clearAppBadgeExplicitly = async (): Promise<void> => {
  if ("clearAppBadge" in navigator) {
    try {
      await (navigator as any).clearAppBadge();
      // console.log("App badge explicitly cleared.");
    } catch (error) {
      console.error("Error clearing app badge explicitly:", error);
    }
  } else {
    // console.log("App Badging API (clearAppBadge) is not supported.");
  }
};

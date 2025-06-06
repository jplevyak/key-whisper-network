import React, { createContext, useContext, useState, useEffect } from "react";
import {
  createPasskey,
  getPasskey,
  isPasskeySupported,
  isBiometricSupported,
  deriveEncryptionKeyFromPrf,
} from "@/utils/encryption";
import { useToast } from "@/components/ui/use-toast";
import { secureStorage } from "@/utils/secureStorage"; // Import secureStorage
import { db } from "@/utils/indexedDB"; // Import db

type AuthContextType = {
  isAuthenticated: boolean;
  isLoading: boolean;
  username: string | null;
  hasPasskey: boolean;
  supportsBiometric: boolean;
  supportsPasskeys: boolean;
  login: (username: string) => Promise<boolean>;
  logout: () => void;
  registerPasskey: (username: string) => Promise<boolean>;
  derivedKey: CryptoKey | null; // Changed from getDerivedKey and string to CryptoKey
  deleteEverything: () => Promise<void>;
  isSecurityContextEstablished: boolean; // New flag
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [username, setUsername] = useState<string | null>(null);
  const [hasPasskey, setHasPasskey] = useState<boolean>(false);
  const [supportsBiometric, setSupportsBiometric] = useState<boolean>(false);
  const [supportsPasskeys, setSupportsPasskeys] = useState<boolean>(false);
  const [derivedKey, setDerivedKey] = useState<CryptoKey | null>(null); // Changed type
  const [isSecurityContextEstablished, setIsSecurityContextEstablished] = useState<boolean>(false); // New state
  const { toast } = useToast();

  useEffect(() => {
    const checkSupport = async () => {
      const passkeysSupported = isPasskeySupported();
      setSupportsPasskeys(passkeysSupported);

      if (passkeysSupported) {
        const biometricSupported = await isBiometricSupported();
        setSupportsBiometric(biometricSupported);
      }

      // Check if user has a passkey
      const storedCredentialId = localStorage.getItem("passkey-credential-id");
      setHasPasskey(!!storedCredentialId);

      // Check if user has a stored username
      const storedUsername = localStorage.getItem("username");
      if (storedUsername) {
        setUsername(storedUsername);
      }

      // SecureStorage will be initialized during the login flow (either with a derived key
      // or by falling back to standard init if PRF fails).
      // We no longer call secureStorage.init() preemptively here.
      console.log("AuthContext: Initial check complete. SecureStorage init deferred to login flow.");
      // We do not set isSecurityContextEstablished here; that happens after active login.
      setIsLoading(false);
    };

    checkSupport();
  }, []);

  const setPrfStorageKeyIfAvailable = async (credential): Promise<boolean> => {
    try {
      const extensionResults = credential.getClientExtensionResults();
      if (extensionResults.prf && extensionResults.prf.results && extensionResults.prf.results.first) {
        const prfSecret = new Uint8Array(extensionResults.prf.results.first);
        const saltForKeyGenString = localStorage.getItem("passkey-saltForKeyGen");
        if (saltForKeyGenString) {
          const key = await deriveEncryptionKeyFromPrf(prfSecret, saltForKeyGenString);
          setDerivedKey(key); // Store for potential UI display or direct use if needed
          if (key) {
            await secureStorage.initializeWithKey(key, db); // Pass db instance
            toast({
              title: "Secure Storage Enhanced",
              description: "Database encryption upgraded with your passkey.",
            });
          } else {
            // This case should ideally not be reached if deriveEncryptionKeyFromPrf is robust
            console.error("Derived key is null despite PRF secret and salt. Falling back to standard key.");
            await secureStorage.init(); // Fallback to standard key
            toast({
              title: "Security Enhancement Issue",
              description: "Could not derive passkey-based key. Using standard protection.",
              variant: "warning",
            });
          }
        } else { // This else corresponds to if (saltForKeyGenString)
          console.warn("Salt for key generation not found. Cannot derive encryption key for DB. Attempting standard protection.");
          await secureStorage.init(); // Fallback to standard key
          if (secureStorage.getIsUsingDerivedKey()) { // init() was no-op, derived key still active
            toast({ title: "Derived Key Active", description: "Passkey security remains active." });
            return true;
          } else if (hasPasskey && !secureStorage.getStandardKeyWasRetrievedFromStorage()) {
            toast({ title: "Security Alert", description: "Passkey security could not be applied. Data might be inaccessible if previously using passkey security.", variant: "destructive" });
            return false; // Critical failure for passkey user if new standard key generated
          } else {
            toast({ title: "Standard Security Active", description: "Using standard database protection." });
            return true;
          }
        }
      } else { // This else corresponds to if (extensionResults.prf && ...)
        console.log("PRF extension data not available. Attempting standard database protection.");
        await secureStorage.init(); // Fallback to standard key
        if (secureStorage.getIsUsingDerivedKey()) { // init() was no-op, derived key still active
            toast({ title: "Derived Key Active", description: "Passkey security remains active." });
            return true;
        } else if (hasPasskey && !secureStorage.getStandardKeyWasRetrievedFromStorage()) {
            toast({ title: "Security Alert", description: "Passkey security could not be applied. Data might be inaccessible if previously using passkey security.", variant: "destructive" });
            return false; // Critical failure for passkey user if new standard key generated
        } else {
            toast({ title: "Standard Security Active", description: "Using standard database protection." });
            return true;
        }
      }
      // This path should ideally not be reached if all conditions above are handled.
      // However, if key was successfully derived and initializedWithKey called, it returns true.
      // If any of the fallbacks to init() happened, their return values dictate the outcome.
      // The original `return true` here was for the successful derived key path.
      return true; 
    } catch (error) {
      console.error("Critical error during setPrfStorageKeyIfAvailable:", error);
      toast({
        title: "Security Setup Failed",
        description: "A critical error occurred while setting up secure storage.",
        variant: "destructive",
      });
      return false; // Indicate critical failure
    }
  };

  const login = async (usernameInput: string) => {
    setIsLoading(true);
    let loginSuccessful = false; // Initialize
    try {
      if (hasPasskey) {
        const credential = await getPasskey();
        if (credential) {
          const securitySetupSuccess = await setPrfStorageKeyIfAvailable(credential);
          if (securitySetupSuccess) {
            setIsSecurityContextEstablished(true); // SecureStorage is now ready
            setIsAuthenticated(true);
            setUsername(usernameInput);
            localStorage.setItem("username", usernameInput);
            loginSuccessful = true;
          } else {
            // Error toast already shown by setPrfStorageKeyIfAvailable for critical failures
            // Stay unauthenticated if security context couldn't be established
            setIsAuthenticated(false);
            setIsSecurityContextEstablished(false);
            // loginSuccessful remains false
          }
        } else { // if (!credential)
          toast({
            title: "Authentication Failed",
            description: "Could not verify your passkey",
            variant: "destructive",
          });
          // loginSuccessful remains false
        }
      } else { // if (!hasPasskey)
        // If this is the first time, prompt to create a passkey
        toast({
          title: "Creating Account",
          description: "Please set up a passkey to continue",
        });
        // Registration itself doesn't mean login is successful for this attempt.
        // User needs to login after registering.
        await registerPasskey(usernameInput);
        // loginSuccessful remains false for this login attempt.
      }
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: "Authentication Error",
        description: "An error occurred during authentication.",
        variant: "destructive",
      });
      // loginSuccessful remains false
    }
    setIsLoading(false); // Consolidated
    return loginSuccessful;
  };

  const registerPasskey = async (usernameInput: string) => {
    setIsLoading(true);
    try {
      const credential = await createPasskey(usernameInput);
      if (credential) {
        setUsername(usernameInput);
        setHasPasskey(true);
        localStorage.setItem("username", usernameInput);
        toast({
          title: "Registration Successful",
          description: "Your secure passkey has been created. Please log in to continue.",
          variant: "default",
        });
        setIsLoading(false);
        return true; // Still return true to indicate successful registration
      } else {
        toast({
          title: "Registration Failed",
          description: "Could not create a passkey",
          variant: "destructive",
        });
        setIsLoading(false);
        return false;
      }
    } catch (error) {
      console.error("Registration error:", error);
      toast({
        title: "Registration Error",
        description: "An error occurred during registration",
        variant: "destructive",
      });
      setIsLoading(false);
      return false;
    }
  };

  const logout = () => {
    setIsAuthenticated(false);
    setIsSecurityContextEstablished(false); // Reset security context flag
    // Username and passkey credentials remain for next login attempt.
    // SecureStorage key (if derived) might still be in memory until next init/initializeWithKey.
    // Consider calling secureStorage.init() here if you want to revert to standard key immediately on logout,
    // or a new method like secureStorage.clearActiveKey(). For now, this is okay.
    toast({
      title: "Logged out",
      description: "You have been securely logged out.",
    });
  };

  const deleteEverything = async () => {
    setIsLoading(true);
    try {
      // 1. Delete the main application IndexedDB.
      // The deleteEntireDatabase method in IndexedDBManager now handles closing its own connection.
      await db.deleteEntireDatabase();

      // 2. Delete the SecureStorage IndexedDB and reset its state
      await secureStorage.deleteOwnDatabase();

      // 3. Clear specified localStorage items
      localStorage.removeItem("username");
      localStorage.removeItem("passkey-credential-id");
      localStorage.removeItem("passkey-saltForKeyGen");

      // 4. Reset auth state
      setIsAuthenticated(false);
      setUsername(null);
      setHasPasskey(false);
      setDerivedKey(null);
      setIsSecurityContextEstablished(false); // Reset security context flag

      toast({
        title: "All Data Deleted",
        description: "All your local data has been removed. The app will now reload.",
        variant: "default",
      });

      // 5. Reload the application
      setTimeout(() => {
        window.location.reload();
      }, 2000); // Delay for toast visibility

    } catch (error) {
      console.error("Error during deleteEverything:", error);
      toast({
        title: "Deletion Error",
        description: "Could not completely remove all data. Please try clearing site data from your browser settings.",
        variant: "destructive",
      });
      setIsLoading(false); // Stop loading indicator on error
    }
  };

  return (
    <AuthContext.Provider
    value={{
      isAuthenticated,
      isLoading,
      username,
      hasPasskey,
      supportsBiometric,
      supportsPasskeys,
      login,
      logout,
      registerPasskey,
      derivedKey, // Changed from getDerivedKey
      deleteEverything,
      isSecurityContextEstablished, // Expose new flag
    }}
    >
    {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

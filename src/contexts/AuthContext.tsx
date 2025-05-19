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

      // Check if secureStorage is using a derived key
      // Ensure secureStorage is initialized before checking this.
      // secureStorage.init() will run if initializeWithKey hasn't been called yet.
      // If initializeWithKey was called (e.g. during login), init() is a no-op.
      await secureStorage.init(); // Ensure SecureStorage's own key mechanism is primed.
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
        } else {
          console.warn("Salt for key generation not found. Cannot derive encryption key for DB. Using standard protection.");
          await secureStorage.init(); // Fallback to standard key
          toast({
            title: "Security Notice",
            description: "Could not enhance database security with passkey. Using standard protection.",
          });
        }
      } else {
        console.log("PRF extension data not available. Using standard database protection.");
        await secureStorage.init(); // Fallback to standard key
        toast({
          title: "Standard Security",
          description: "Passkey login successful. Using standard database protection.",
            variant: "default",
          });
        }
      } else {
        console.warn("Salt for key generation not found. Cannot derive encryption key for DB.");
        toast({
          title: "Security Notice",
          description: "Could not enhance database security with passkey. Using standard protection.",
          variant: "default", // Or "warning" if you have one
        });
      }
    } else {
      toast({
        title: "Standard Security",
        description: "Passkey login successful. Using standard database protection.",
        variant: "default",
      });
    }
  };

  const login = async (usernameInput: string) => {
    setIsLoading(true);
    try {
      if (hasPasskey) {
        const credential = await getPasskey();
        if (credential) {
          setIsAuthenticated(true);
          setUsername(usernameInput);
          localStorage.setItem("username", usernameInput);
          setIsLoading(false);
          await setPrfStorageKeyIfAvailable(credential);
          return true;
        } else {
          toast({
            title: "Authentication Failed",
            description: "Could not verify your passkey",
            variant: "destructive",
          });
          setIsLoading(false);
          return false;
        }
      } else {
        // If this is the first time, prompt to create a passkey
        toast({
          title: "Creating Account",
          description: "Please set up a passkey to continue",
        });
        const registered = await registerPasskey(usernameInput);
        // After registration, user still needs to login.
        // registerPasskey returns true on success, but login isn't complete yet.
        loginSuccessful = registered; // If registration is part of login, then it's "successful" if reg is.
                                     // However, the typical flow is reg -> then separate login.
                                     // For now, let's assume if registerPasskey is called, it's the end of this "login" attempt.
      }
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: "Authentication Error",
        description: "An error occurred during authentication.",
        variant: "destructive",
      });
    }
    setIsLoading(false);
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

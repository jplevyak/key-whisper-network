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
  isUsingDerivedKey: boolean; // Added to expose PRF key usage for DB encryption
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
  const [isUsingDerivedKey, setIsUsingDerivedKey] = useState<boolean>(false); // Added state for PRF key usage
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
      await secureStorage.init(); // Ensure it's initialized
      setIsUsingDerivedKey(secureStorage.getIsUsingDerivedKey());

      setIsLoading(false);
    };

    checkSupport();
  }, []);

  const setPrfStorageKeyIfAvailable = async (credential) => {
    const extensionResults = credential.getClientExtensionResults();
    if (extensionResults.prf && extensionResults.prf.results && extensionResults.prf.results.first) {
      const prfSecret = new Uint8Array(extensionResults.prf.results.first);
      const saltForKeyGenString = localStorage.getItem("passkey-saltForKeyGen");
      if (saltForKeyGenString) {
        const key = await deriveEncryptionKeyFromPrf(prfSecret, saltForKeyGenString);
        setDerivedKey(key);
        if (key) {
          await secureStorage.initializeWithKey(key);
          toast({
            title: "Secure Storage Enhanced",
            description: "Database encryption upgraded with your passkey.",
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
        return registered;
      }
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: "Authentication Error",
        description: "An error occurred during authentication",
        variant: "destructive",
      });
      setIsLoading(false);
      return false;
    }
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
    // We don't remove the username or passkey credentials on logout
    toast({
      title: "Logged out",
      description: "You have been securely logged out",
    });
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
      isUsingDerivedKey, // Added
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

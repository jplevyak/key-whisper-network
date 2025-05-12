import React, { createContext, useContext, useState, useEffect } from "react";
import {
  createPasskey,
  verifyPasskey,
  isPasskeySupported,
  isBiometricSupported,
} from "@/utils/encryption";
import { useToast } from "@/components/ui/use-toast";

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
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [username, setUsername] = useState<string | null>(null);
  const [hasPasskey, setHasPasskey] = useState<boolean>(false);
  const [supportsBiometric, setSupportsBiometric] = useState<boolean>(false);
  const [supportsPasskeys, setSupportsPasskeys] = useState<boolean>(false);
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

      setIsLoading(false);
    };

    checkSupport();
  }, []);

  const login = async (usernameInput: string) => {
    setIsLoading(true);
    try {
      if (hasPasskey) {
        const verified = await verifyPasskey();
        if (verified) {
          setIsAuthenticated(true);
          setUsername(usernameInput);
          localStorage.setItem("username", usernameInput);
          setIsLoading(false);
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
      const registered = await createPasskey(usernameInput);
      if (registered) {
        setIsAuthenticated(true);
        setUsername(usernameInput);
        setHasPasskey(true);
        localStorage.setItem("username", usernameInput);
        toast({
          title: "Registration Successful",
          description: "Your secure passkey has been created",
          variant: "default",
        });
        setIsLoading(false);
        return true;
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

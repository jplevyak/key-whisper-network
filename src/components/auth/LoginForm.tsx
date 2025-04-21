
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Fingerprint } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const LoginForm = () => {
  const [username, setUsername] = useState<string>(localStorage.getItem('username') || '');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const { login, hasPasskey, supportsBiometric, supportsPasskeys } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    await login(username);
    setIsLoggingIn(false);
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold">Key Whisper Network</CardTitle>
        <CardDescription>
          {hasPasskey
            ? 'Sign in with your secure passkey'
            : 'Create your secure account with a passkey'}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="bg-muted/50"
            />
          </div>
          
          {!supportsPasskeys && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              Your browser doesn't support passkeys. Please use a modern browser like Chrome, Edge, or Safari.
            </div>
          )}
          
          {supportsPasskeys && supportsBiometric && (
            <div className="p-3 bg-accent/10 text-accent-foreground rounded-md flex items-center gap-2 text-sm">
              <Fingerprint className="h-5 w-5" />
              <span>Biometric authentication is available on your device</span>
            </div>
          )}
        </CardContent>

        <CardFooter>
          <Button 
            type="submit" 
            className="w-full" 
            disabled={isLoggingIn || !username || !supportsPasskeys}
          >
            {isLoggingIn 
              ? 'Authenticating...' 
              : hasPasskey 
                ? 'Sign In with Passkey' 
                : 'Create Account with Passkey'
            }
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default LoginForm;


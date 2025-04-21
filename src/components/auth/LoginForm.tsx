
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
    <Card className="w-full max-w-md mx-auto shadow-2xl bg-white/10 backdrop-blur-lg border-white/20">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center mb-4">
          <Fingerprint className="h-12 w-12 text-primary" />
        </div>
        <CardTitle className="text-3xl font-bold text-center text-foreground">CCred</CardTitle>
        <CardDescription className="text-center text-muted-foreground">
          {hasPasskey
            ? 'Secure access to your encrypted communication'
            : 'Create a secure communication account'}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              placeholder="Enter your secure username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="bg-muted/30 border-white/20 focus:ring-primary focus:border-primary"
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
                ? 'Secure Sign In' 
                : 'Create Secure Account'
            }
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default LoginForm;

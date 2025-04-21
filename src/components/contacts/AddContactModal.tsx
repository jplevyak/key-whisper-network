import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useContacts } from '@/contexts/ContactsContext';
import { useToast } from '@/hooks/use-toast';
import { X } from 'lucide-react';
import QRCodeScanner from './QRCodeScanner';
import QRCodeGenerator from './QRCodeGenerator';
import ImageCapture from './ImageCapture';
import Haikunator from 'haikunator';

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AddContactModal = ({ isOpen, onClose }: AddContactModalProps) => {
  const haikunator = new Haikunator();
  const [name, setName] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [scannedKey, setScannedKey] = useState('');
  const [capturedImage, setCapturedImage] = useState<string>('');
  const { addContact, generateContactKey } = useContacts();
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && !name) {
      setName(haikunator.haikunate());
    }
  }, [isOpen]);

  const handleCreateContact = async () => {
    if (!name) {
      toast({
        title: 'Required Field',
        description: 'Please enter a label for your contact',
        variant: 'destructive',
      });
      return;
    }

    if (!scannedKey && !generatedKey) {
      toast({
        title: 'Missing Key',
        description: "Please scan your contact's QR code or generate a key",
        variant: 'destructive',
      });
      return;
    }

    if (!capturedImage) {
      toast({
        title: 'Missing Photo',
        description: 'Please take a photo for your contact',
        variant: 'destructive',
      });
      return;
    }

    const keyToUse = scannedKey || generatedKey;
    const success = await addContact(name, capturedImage, keyToUse);
    if (success) {
      resetForm();
      onClose();
    }
  };

  const handleGenerateKey = async () => {
    const key = await generateContactKey();
    setGeneratedKey(key);
    setShowQR(true);
  };

  const handleAcceptKey = (key: string) => {
    setGeneratedKey(key);
    setShowQR(false);
    toast({
      title: 'Key Generated',
      description: 'Encryption key has been generated and associated with the contact',
    });
  };

  const handleScanSuccess = (data: string) => {
    setScannedKey(data);
    setShowScanner(false);
    toast({
      title: 'QR Code Scanned',
      description: 'Encryption key successfully scanned',
    });
  };

  const resetForm = () => {
    setName('');
    setScannedKey('');
    setGeneratedKey('');
    setCapturedImage('');
    setShowScanner(false);
    setShowQR(false);
  };

  React.useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  if (showScanner) {
    return (
      <Dialog open={isOpen} onOpenChange={() => { onClose(); resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <QRCodeScanner 
            onScanSuccess={handleScanSuccess} 
            onClose={() => setShowScanner(false)} 
          />
        </DialogContent>
      </Dialog>
    );
  }

  if (showQR && generatedKey) {
    return (
      <Dialog open={isOpen} onOpenChange={() => { onClose(); resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <QRCodeGenerator 
            data={generatedKey}
            title="Your Encryption Key"
            description="Let your contact scan this QR code to add you"
            onClose={() => setShowQR(false)}
            onAccept={handleAcceptKey}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => { onClose(); resetForm(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Contact</DialogTitle>
          <DialogDescription>
            Exchange encryption keys securely via QR codes
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Contact Label</Label>
            <div className="relative">
              <Input
                id="name"
                placeholder="Enter a label for this contact"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="pr-8"
              />
              {name && (
                <button
                  type="button"
                  onClick={() => setName('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-sm"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
          
          <div className="space-y-2">
            <Label>Contact Photo</Label>
            <ImageCapture 
              onImageCapture={setCapturedImage}
              capturedImage={capturedImage}
            />
          </div>
          
          <div className="flex justify-center space-x-2">
            <Button 
              variant="outline" 
              onClick={handleGenerateKey} 
              className="flex-1"
            >
              Generate My Key
            </Button>
            <Button 
              onClick={() => setShowScanner(true)} 
              className="flex-1"
              disabled={!name}
            >
              Scan Their Key
            </Button>
          </div>
          
          {(scannedKey || generatedKey) && (
            <div className="p-3 bg-success/20 text-success rounded-md text-sm">
              Key successfully {scannedKey ? 'scanned' : 'generated'}! Ready to create contact.
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreateContact} 
            disabled={!name || (!scannedKey && !generatedKey) || !capturedImage}
          >
            Create Contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddContactModal;

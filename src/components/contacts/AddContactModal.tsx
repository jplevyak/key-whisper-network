
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useContacts } from '@/contexts/ContactsContext';
import { useToast } from '@/hooks/use-toast';
import ContactNameEdit from './shared/ContactNameEdit';
import ContactImageUpload from './shared/ContactImageUpload';
import QRCodeActions from './shared/QRCodeActions';
import Haikunator from 'haikunator';

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AddContactModal = ({ isOpen, onClose }: AddContactModalProps) => {
  const haikunator = new Haikunator();
  const [name, setName] = useState('');
  const [capturedImage, setCapturedImage] = useState<string>('');
  const [scannedKey, setScannedKey] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
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

  const resetForm = () => {
    setName('');
    setScannedKey('');
    setGeneratedKey('');
    setCapturedImage('');
  };

  React.useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

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
          <ContactNameEdit
            initialName={name}
            onUpdateName={setName}
          />
          
          <ContactImageUpload
            currentImage={capturedImage || '/placeholder.svg'}
            onImageCapture={setCapturedImage}
          />
          
          <QRCodeActions
            onScanSuccess={setScannedKey}
            onGenerateKey={async () => {
              const key = await generateContactKey();
              setGeneratedKey(key);
              return key;
            }}
          />
          
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

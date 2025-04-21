
import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useContacts } from '@/contexts/ContactsContext';
import { useToast } from '@/components/ui/use-toast';
import { Camera } from 'lucide-react';
import QRCodeScanner from './QRCodeScanner';
import QRCodeGenerator from './QRCodeGenerator';

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AddContactModal = ({ isOpen, onClose }: AddContactModalProps) => {
  const [name, setName] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [scannedKey, setScannedKey] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { addContact, generateContactKey } = useContacts();
  const { toast } = useToast();
  const [isCameraActive, setIsCameraActive] = useState(false);

  const captureImage = () => {
    if (!videoRef.current || !canvasRef.current) return '';
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const handleCreateContact = async () => {
    if (!name) {
      toast({
        title: 'Required Field',
        description: 'Please enter a label for your contact',
        variant: 'destructive',
      });
      return;
    }

    if (!scannedKey) {
      toast({
        title: 'Missing Key',
        description: "Please scan your contact's QR code first",
        variant: 'destructive',
      });
      return;
    }

    const avatar = captureImage();
    if (!avatar) {
      toast({
        title: 'Camera Issue',
        description: 'Could not capture an image. Please ensure camera access is allowed.',
        variant: 'destructive',
      });
      return;
    }

    const success = await addContact(name, avatar, scannedKey);
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
    setShowScanner(false);
    setShowQR(false);
    setIsCameraActive(false);
    stopCamera();
  };

  const startCamera = async () => {
    try {
      if (!videoRef.current) return;
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' },
        audio: false 
      });
      
      videoRef.current.srcObject = stream;
      setIsCameraActive(true);
    } catch (error) {
      console.error('Error accessing camera:', error);
      toast({
        title: 'Camera Error',
        description: 'Could not access your camera. Please check permissions.',
        variant: 'destructive',
      });
    }
  };

  const toggleCamera = () => {
    if (isCameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  const stopCamera = () => {
    if (!videoRef.current) return;
    
    const stream = videoRef.current.srcObject as MediaStream;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    videoRef.current.srcObject = null;
    setIsCameraActive(false);
  };

  React.useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
      resetForm();
    }
    return () => {
      stopCamera();
    };
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
            <Input
              id="name"
              placeholder="Enter a label for this contact"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label>Contact Photo</Label>
            <div 
              className="relative aspect-square max-w-[200px] mx-auto overflow-hidden rounded-full border border-border bg-muted/50 cursor-pointer group"
              onClick={toggleCamera}
            >
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="w-full h-full object-cover"
              />
              {!isCameraActive && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/50 group-hover:bg-muted/70 transition-colors">
                  <Camera className="w-8 h-8 text-muted-foreground" />
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
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
          
          {scannedKey && (
            <div className="p-3 bg-success/20 text-success rounded-md text-sm">
              Key successfully scanned! Ready to create contact.
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreateContact} disabled={!name || !scannedKey}>
            Create Contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddContactModal;

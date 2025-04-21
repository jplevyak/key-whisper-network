
import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useContacts } from '@/contexts/ContactsContext';
import { useToast } from '@/components/ui/use-toast';
import { Camera, CameraOff, X } from 'lucide-react';
import QRCodeScanner from './QRCodeScanner';
import QRCodeGenerator from './QRCodeGenerator';
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { addContact, generateContactKey } = useContacts();
  const { toast } = useToast();
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [hasEnvironmentCamera, setHasEnvironmentCamera] = useState<boolean | null>(null);

  useEffect(() => {
    if (isOpen && !name) {
      setName(haikunator.haikunate());
    }
  }, [isOpen]);

  // Check for available camera modes
  useEffect(() => {
    const checkCameraCapabilities = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        // We can't directly check if a camera supports "environment" mode
        // But if there are multiple cameras, we assume one is environment-facing
        setHasEnvironmentCamera(videoDevices.length > 1);
      } catch (error) {
        console.error('Error checking camera capabilities:', error);
        setHasEnvironmentCamera(false);
      }
    };

    if (isOpen) {
      checkCameraCapabilities();
    }
  }, [isOpen]);

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

  const handleCaptureOrRetake = () => {
    if (!isCameraActive) {
      startCamera();
    } else if (capturedImage) {
      setCapturedImage('');
    } else {
      const image = captureImage();
      if (image) {
        setCapturedImage(image);
        stopCamera();
      }
    }
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
    setIsCameraActive(false);
    stopCamera();
  };

  const startCamera = async () => {
    try {
      if (!videoRef.current) return;
      
      // If we don't know about camera capabilities yet, or we know there's no environment camera,
      // or we're on Windows (which often has issues with environment mode)
      const constraints = {
        video: hasEnvironmentCamera === true && !isWindowsOS() ? 
          { facingMode: "environment" } : 
          true,
        audio: false 
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      videoRef.current.srcObject = stream;
      setIsCameraActive(true);
    } catch (error) {
      console.error('Error accessing camera:', error);
      
      // If first attempt fails with environment mode, try again with default
      if (hasEnvironmentCamera === true && !isWindowsOS()) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: true,
            audio: false 
          });
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setIsCameraActive(true);
          }
        } catch (fallbackError) {
          console.error('Error accessing camera (fallback):', fallbackError);
          toast({
            title: 'Camera Error',
            description: 'Could not access your camera. Please check permissions.',
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: 'Camera Error',
          description: 'Could not access your camera. Please check permissions.',
          variant: 'destructive',
        });
      }
    }
  };

  // Helper to detect Windows OS
  const isWindowsOS = () => {
    return navigator.userAgent.indexOf("Win") !== -1;
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
    if (!isOpen) {
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
            <div 
              className="relative aspect-square max-w-[200px] mx-auto overflow-hidden rounded-full border border-border bg-muted/50 cursor-pointer group"
              onClick={handleCaptureOrRetake}
            >
              {capturedImage ? (
                <img 
                  src={capturedImage} 
                  alt="Contact" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                {capturedImage ? (
                  <CameraOff className="w-8 h-8 text-white" />
                ) : (
                  <Camera className="w-8 h-8 text-white" />
                )}
              </div>
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

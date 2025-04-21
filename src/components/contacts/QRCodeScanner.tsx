
import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

interface QRCodeScannerProps {
  onScanSuccess: (data: string) => void;
  onClose: () => void;
}

const QRCodeScanner = ({ onScanSuccess, onClose }: QRCodeScannerProps) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [cameraId, setCameraId] = useState<string>('');
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const { toast } = useToast();

  useEffect(() => {
    // Initialize the scanner
    scannerRef.current = new Html5Qrcode('qr-reader');

    // Get available cameras
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (devices && devices.length) {
          setCameras(devices);
          setCameraId(devices[0].id);
        } else {
          toast({
            title: 'No Camera Found',
            description: 'Please ensure your device has a camera and you've granted permission.',
            variant: 'destructive',
          });
        }
      })
      .catch((error) => {
        console.error('Error getting cameras', error);
        toast({
          title: 'Camera Error',
          description: 'Could not access your device camera',
          variant: 'destructive',
        });
      });

    // Cleanup on unmount
    return () => {
      if (scannerRef.current && isScanning) {
        scannerRef.current
          .stop()
          .catch((error) => console.error('Error stopping scanner', error));
      }
    };
  }, [toast]);

  const startScanning = () => {
    if (!scannerRef.current || !cameraId) return;

    setIsScanning(true);
    scannerRef.current
      .start(
        cameraId,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          // QR code scanned successfully
          scannerRef.current?.stop();
          setIsScanning(false);
          onScanSuccess(decodedText);
        },
        (errorMessage) => {
          // Error while scanning
          console.log(errorMessage);
        }
      )
      .catch((error) => {
        console.error('Error starting scanner', error);
        setIsScanning(false);
        toast({
          title: 'Scanner Error',
          description: 'Could not start the QR code scanner',
          variant: 'destructive',
        });
      });
  };

  const stopScanning = () => {
    if (scannerRef.current && isScanning) {
      scannerRef.current
        .stop()
        .then(() => {
          setIsScanning(false);
        })
        .catch((error) => {
          console.error('Error stopping scanner', error);
        });
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Scan QR Code</CardTitle>
        <CardDescription>
          Scan a QR code to import a contact's encryption key
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col space-y-4">
          <div id="qr-reader" className="w-full h-64 bg-muted/50 rounded-lg overflow-hidden" />

          {cameras.length > 0 && (
            <select
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              className="p-2 border rounded-md bg-background"
              disabled={isScanning}
            >
              {cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {isScanning ? (
          <Button variant="destructive" onClick={stopScanning}>
            Stop Scanning
          </Button>
        ) : (
          <Button onClick={startScanning} disabled={!cameraId}>
            Start Scanning
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

export default QRCodeScanner;

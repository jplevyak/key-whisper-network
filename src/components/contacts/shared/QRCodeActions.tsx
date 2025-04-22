
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogTitle,
  DialogHeader
} from '@/components/ui/dialog';
import { QrCode } from 'lucide-react';
import QRCodeScanner from '../QRCodeScanner';
import QRCodeGenerator from '../QRCodeGenerator';

interface QRCodeActionsProps {
  onScanSuccess: (keyData: string) => void;
  onGenerateKey: () => Promise<string>;
  variant?: 'stacked' | 'inline';
}

const QRCodeActions = ({ onScanSuccess, onGenerateKey, variant = 'inline' }: QRCodeActionsProps) => {
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showQRGenerator, setShowQRGenerator] = useState(false);
  const [qrData, setQrData] = useState('');

  const handleGenerateKey = async () => {
    const newKey = await onGenerateKey();
    setQrData(newKey);
    setShowQRGenerator(true);
  };

  const buttonClassName = variant === 'stacked' ? 'w-full justify-start' : 'flex-1';

  return (
    <>
      <div className={`flex ${variant === 'stacked' ? 'flex-col space-y-2' : 'space-x-2'}`}>
        <Button
          variant="outline"
          className={buttonClassName}
          onClick={() => setShowQRScanner(true)}
        >
          <QrCode className="mr-2 h-4 w-4" />
          {variant === 'stacked' ? 'Update Key via QR Code' : 'Scan QR'}
        </Button>
        <Button
          variant="outline"
          className={buttonClassName}
          onClick={handleGenerateKey}
        >
          <QrCode className="mr-2 h-4 w-4" />
          {variant === 'stacked' ? 'Generate New Key' : 'Generate Key'}
        </Button>
      </div>

      {showQRScanner && (
        <Dialog open={showQRScanner} onOpenChange={() => setShowQRScanner(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Scan QR Code</DialogTitle>
            </DialogHeader>
            <QRCodeScanner
              onScanSuccess={(keyData) => {
                onScanSuccess(keyData);
                setShowQRScanner(false);
              }}
              onClose={() => setShowQRScanner(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {showQRGenerator && (
        <Dialog open={showQRGenerator} onOpenChange={() => setShowQRGenerator(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Encryption Key</DialogTitle>
            </DialogHeader>
            <QRCodeGenerator
              data={qrData}
              title="New Encryption Key"
              description="Scan this QR code to update the encryption key on another device"
              onClose={() => setShowQRGenerator(false)}
              onAccept={() => setShowQRGenerator(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default QRCodeActions;

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QrCode } from "lucide-react";
import QRCodeScanner from "../QRCodeScanner";
import QRCodeGenerator from "../QRCodeGenerator";

interface QRCodeActionsProps {
  onScanAccept: (keyData: string) => void; // Called when a scanned key is accepted
  onGenerateKeyRequest: () => Promise<string>; // Called to request a new key string
  onGeneratedKeyAccept: (keyData: string) => void; // Called when a generated key is accepted
  variant?: "stacked" | "inline";
}

const QRCodeActions = ({
  onScanAccept,
  onGenerateKeyRequest,
  onGeneratedKeyAccept,
  variant = "inline",
}: QRCodeActionsProps) => {
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showQRGenerator, setShowQRGenerator] = useState(false);
  const [generatedKeyData, setGeneratedKeyData] = useState(""); // For QR Code Generator
  const [scannedKeyData, setScannedKeyData] = useState(""); // For scanned QR data confirmation
  const [showScanConfirmDialog, setShowScanConfirmDialog] = useState(false);

  const handleGenerateKeyAndShowDialog = async () => {
    const newKey = await onGenerateKeyRequest();
    if (newKey) {
      setGeneratedKeyData(newKey);
      setShowQRGenerator(true);
    }
    // If newKey is empty, onGenerateKeyRequest should have shown a toast.
  };

  const buttonClassName =
    variant === "stacked" ? "w-full justify-start" : "flex-1";

  return (
    <>
      <div
        className={`flex ${variant === "stacked" ? "flex-col space-y-2" : "space-x-2"}`}
      >
        <Button
          variant="outline"
          className={buttonClassName}
          onClick={() => setShowQRScanner(true)}
        >
          <QrCode className="mr-2 h-4 w-4" />
          {variant === "stacked" ? "Update Key via QR Code" : "Scan QR"}
        </Button>
        <Button
          variant="outline"
          className={buttonClassName}
          onClick={handleGenerateKeyAndShowDialog}
        >
          <QrCode className="mr-2 h-4 w-4" />
          {variant === "stacked" ? "Generate New Key" : "Generate Key"}
        </Button>
      </div>

      {showQRScanner && (
        <Dialog
          open={showQRScanner}
          onOpenChange={() => setShowQRScanner(false)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Scan QR Code</DialogTitle>
            </DialogHeader>
            <QRCodeScanner
              onScanSuccess={(keyData) => {
                setScannedKeyData(keyData);
                setShowQRScanner(false);
                setShowScanConfirmDialog(true); // Show confirmation dialog
              }}
              onClose={() => setShowQRScanner(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {showScanConfirmDialog && (
        <AlertDialog
          open={showScanConfirmDialog}
          onOpenChange={setShowScanConfirmDialog}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Scanned Key</AlertDialogTitle>
              <AlertDialogDescription>
                Do you want to use this scanned encryption key? This action may
                clear existing chat history for the contact.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setScannedKeyData(""); // Clear data if cancelled
                  setShowScanConfirmDialog(false);
                }}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (scannedKeyData) {
                    onScanAccept(scannedKeyData);
                  }
                  setShowScanConfirmDialog(false);
                  setScannedKeyData(""); // Clear data after action
                }}
              >
                Accept
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {showQRGenerator && (
        <Dialog open={showQRGenerator} onOpenChange={setShowQRGenerator}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Encryption Key</DialogTitle>
            </DialogHeader>
            <QRCodeGenerator
              data={generatedKeyData}
              title="New Encryption Key"
              description="Scan this QR code to share your new encryption key."
              onClose={() => {
                setShowQRGenerator(false);
                setGeneratedKeyData(""); // Clear data if cancelled
              }}
              onAccept={(keyFromGenerator) => {
                // Assuming QRCodeGenerator's onAccept provides the key
                onGeneratedKeyAccept(keyFromGenerator); // Use the key from generator
                setShowQRGenerator(false);
                setGeneratedKeyData(""); // Clear data after action
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default QRCodeActions;

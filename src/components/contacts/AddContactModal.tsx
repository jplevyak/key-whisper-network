import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useContacts } from "@/contexts/ContactsContext";
import { useToast } from "@/hooks/use-toast";
import ContactNameEdit from "./shared/ContactNameEdit";
import ContactImageUpload from "./shared/ContactImageUpload";
import QRCodeActions from "./shared/QRCodeActions";
import Haikunator from "haikunator";

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AddContactModal = ({ isOpen, onClose }: AddContactModalProps) => {
  const haikunator = new Haikunator();
  const [name, setName] = useState(""); // The committed/saved name
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [tempName, setTempName] = useState(""); // Temporary name while editing
  const [capturedImage, setCapturedImage] = useState<string>("");
  const [scannedKey, setScannedKey] = useState("");
  const [generatedKey, setGeneratedKey] = useState("");
  const [showCloseConfirmationAlert, setShowCloseConfirmationAlert] =
    useState(false);
  const { addContact, generateContactKey } = useContacts(); // generateContactKey is already here
  const { toast } = useToast();

  useEffect(() => {
    // Initialize name and tempName when dialog opens if name is empty
    if (isOpen && !name) {
      const initialHaiku = haikunator.haikunate();
      setName(initialHaiku);
      setTempName(initialHaiku); // Also set tempName initially
      setIsNameEditing(false); // Start in view mode
    } else if (isOpen) {
      // If reopening with an existing name, ensure tempName matches
      setTempName(name);
      setIsNameEditing(false);
    }
  }, [isOpen]); // Rerun when isOpen changes

  // --- Name Editing Handlers ---
  const handleToggleNameEdit = () => {
    if (!isNameEditing) {
      // Entering edit mode: copy current saved name to tempName
      setTempName(name);
    }
    // If leaving edit mode without saving, tempName is discarded implicitly
    setIsNameEditing(!isNameEditing);
  };

  const handleSaveName = () => {
    const trimmedName = tempName.trim();
    if (trimmedName === "") {
      toast({
        title: "Invalid Name",
        description: "Contact name cannot be empty.",
        variant: "destructive",
      });
      return false; // Indicate save failed
    }
    setName(trimmedName); // Commit the change
    setIsNameEditing(false); // Exit editing mode
    return true; // Indicate save succeeded
  };
  // --- End Name Editing Handlers ---

  // Function to ensure name is saved before proceeding
  const ensureNameIsSaved = (): boolean => {
    if (isNameEditing) {
      return handleSaveName(); // Attempt to save, return success/failure
    }
    return true; // Not editing, so proceed
  };

  // --- QRCodeActions Handlers for AddContactModal ---
  const handleModalScanAccept = (keyData: string) => {
    if (!ensureNameIsSaved()) return;
    setGeneratedKey(""); // Clear generated key if scanning
    setScannedKey(keyData);
  };

  const handleModalGenerateKeyRequest = async (): Promise<string> => {
    if (!ensureNameIsSaved()) return ""; // Save name first, return empty on failure
    const key = await generateContactKey(); // This comes from useContacts
    // The key is returned to QRCodeActions to be displayed in QRCodeGenerator.
    // We don't set generatedKey state here yet, only after user accepts it in QRCodeGenerator.
    return key;
  };

  const handleModalGeneratedKeyAccept = (keyData: string) => {
    // This is called when the user "Accepts" the generated key within the QRCodeGenerator dialog
    if (!ensureNameIsSaved()) return; // Name should ideally be saved by now
    setScannedKey(""); // Clear scanned key if a new one was generated and accepted
    setGeneratedKey(keyData);
  };
  // --- End QRCodeActions Handlers ---

  const handleCreateContact = async () => {
    // Ensure name is saved first
    if (!ensureNameIsSaved()) return;

    // Now use the potentially updated 'name' state
    if (!name) {
      // Check the committed name state
      toast({
        title: "Required Field", // Should ideally not happen if ensureNameIsSaved worked
        description: "Please enter a label for your contact",
        variant: "destructive",
      });
      return;
    }

    if (!scannedKey && !generatedKey) {
      toast({
        title: "Missing Key",
        description: "Please scan your contact's QR code or generate a key",
        variant: "destructive",
      });
      return;
    }

    const keyToUse = scannedKey || generatedKey;
    // Use capturedImage if available, otherwise pass an empty string or a default placeholder indicator
    const imageToUse = capturedImage || "";
    // Determine if the key was generated by the user or scanned
    const userGenerated = !!generatedKey; // True if generatedKey has a value, false otherwise
    const success = await addContact(name, imageToUse, keyToUse, userGenerated);
    if (success) {
      resetForm();
      onClose();
    }
  };

  const resetForm = () => {
    setName("");
    setTempName(""); // Reset temp name
    setIsNameEditing(false); // Reset editing state
    setScannedKey("");
    setGeneratedKey("");
    setCapturedImage("");
  };

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  // Correctly handle open/close state changes
  const handleAttemptClose = () => {
    const canCreateContact =
      !isNameEditing && !!name.trim() && (!!scannedKey || !!generatedKey);
    if (canCreateContact) {
      setShowCloseConfirmationAlert(true);
      // Prevent dialog from closing immediately by not calling onClose() yet
    } else {
      // If not attempting to create a contact or form is not in a savable state, close normally
      resetForm();
      onClose();
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleAttemptClose();
    }
    // If opening (open is true), the isOpen prop handles visibility.
    // No specific action needed here for opening via this callback.
  };

  const handleConfirmCloseDialog = () => {
    setShowCloseConfirmationAlert(false);
    resetForm();
    onClose();
  };

  const handleCreateContactFromAlert = async () => {
    setShowCloseConfirmationAlert(false);
    await handleCreateContact(); // This will call onClose on success
  };

  const isCreateButtonDisabled =
    isNameEditing || !name.trim() || (!scannedKey && !generatedKey);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md top-[10vh] translate-y-0 sm:top-[50%] sm:translate-y-[-50%]">
          <DialogHeader>
            <DialogTitle>Add New Contact</DialogTitle>
            <DialogDescription>
              Exchange encryption keys securely via QR codes
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <ContactNameEdit
              name={isNameEditing ? tempName : name} // Show tempName if editing, else saved name
              isEditing={isNameEditing}
              onNameChange={setTempName} // Update tempName directly
              onSave={handleSaveName}
              onEditToggle={handleToggleNameEdit}
              onClear={() => setTempName("")} // Pass the clear handler
            />

            <ContactImageUpload
              currentImage={capturedImage || "/placeholder.svg"}
              onImageCapture={setCapturedImage}
            />

            <QRCodeActions
              onScanAccept={handleModalScanAccept}
              onGenerateKeyRequest={handleModalGenerateKeyRequest}
              onGeneratedKeyAccept={handleModalGeneratedKeyAccept}
              // variant="inline" or "stacked" can be set if needed, defaults to "inline"
            />

            {(scannedKey || generatedKey) && (
              <div className="p-3 bg-success/20 text-success rounded-md text-sm">
                Key successfully {scannedKey ? "scanned" : "generated"}! Ready
                to create contact.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleAttemptClose}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateContact}
              // Disable if editing name OR if name is empty OR if no key is set
              disabled={isCreateButtonDisabled}
            >
              Create Contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showCloseConfirmationAlert && (
        <AlertDialog
          open={showCloseConfirmationAlert}
          onOpenChange={setShowCloseConfirmationAlert}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
              <AlertDialogDescription>
                You have unsaved information. Do you want to create the contact
                or discard the changes?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => setShowCloseConfirmationAlert(false)}
              >
                Keep Editing
              </AlertDialogCancel>
              <Button variant="outline" onClick={handleConfirmCloseDialog}>
                Discard Changes
              </Button>
              <AlertDialogAction onClick={handleCreateContactFromAlert}>
                Create Contact
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
};

export default AddContactModal;

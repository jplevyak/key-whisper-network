import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useContacts, Contact } from "@/contexts/ContactsContext";
import { useToast } from "@/hooks/use-toast";
import ContactNameEdit from "./shared/ContactNameEdit"; // Reusing for name input
import Haikunator from "haikunator";
import { Group } from "@/contexts/ContactsContext"; // Import Group type

interface AddGroupModalProps {
  isOpen: boolean;
  onClose: (createdGroup?: Group) => void; // Updated to pass Group object
  initialGroupName?: string;
  initialSelectedMemberIds?: string[];
  initialGroupId?: string; // Added initialGroupId
  // initialGroupContextId?: string; // Not directly used for creation logic yet, but can be passed
}

const AddGroupModal = ({
  isOpen,
  onClose,
  initialGroupName,
  initialSelectedMemberIds,
  initialGroupId, // Added initialGroupId
}: AddGroupModalProps) => {
  const haikunator = useMemo(() => new Haikunator(), []);
  const { listItems, addGroup } = useContacts();
  const { toast } = useToast();

  const [groupName, setGroupName] = useState(initialGroupName || "");
  const [isNameEditing, setIsNameEditing] = useState(!!initialGroupName); // Start in edit mode if name provided
  const [tempGroupName, setTempGroupName] = useState(initialGroupName || "");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(
    initialSelectedMemberIds || [],
  );

  const availableContacts = listItems.filter(
    (item) => item.itemType === "contact",
  ) as Contact[];

  useEffect(() => {
    if (isOpen) {
      const nameToSet =
        initialGroupName ||
        haikunator.haikunate({
          tokenChars: "0123456789",
          tokenLength: 4,
          delimiter: " ",
        });
      setGroupName(nameToSet);
      setTempGroupName(nameToSet);
      // If initialGroupName is provided, user might want to edit it or confirm it.
      // If not provided, it's a fresh haiku, so not necessarily in edit mode unless user clicks.
      // We will now default to not being in edit mode, allowing the user to explicitly edit.
      setIsNameEditing(false);
      setSelectedMemberIds(initialSelectedMemberIds || []);
    } else {
      // Reset when closing if not triggered by internal logic that already reset
      // This handles external closes like ESC key
      setGroupName("");
      setTempGroupName("");
      setIsNameEditing(false);
      setSelectedMemberIds([]);
    }
  }, [isOpen, initialGroupName, initialSelectedMemberIds, haikunator]);

  const handleToggleNameEdit = () => {
    if (!isNameEditing) {
      setTempGroupName(groupName);
    }
    setIsNameEditing(!isNameEditing);
  };

  const handleSaveName = () => {
    const trimmedName = tempGroupName.trim();
    if (trimmedName === "") {
      toast({
        title: "Invalid Name",
        description: "Group name cannot be empty.",
        variant: "destructive",
      });
      return false;
    }
    setGroupName(trimmedName);
    setIsNameEditing(false);
    return true;
  };

  const handleMemberSelection = (contactId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(contactId)
        ? prev.filter((id) => id !== contactId)
        : [...prev, contactId],
    );
  };

  const handleCreateGroup = async () => {
    if (!ensureNameIsSaved()) return;

    if (!groupName) {
      // Check committed name
      toast({
        title: "Required Field",
        description: "Please enter a name for your group.",
        variant: "destructive",
      });
      return;
    }
    if (selectedMemberIds.length === 0) {
      toast({
        title: "No Members Selected",
        description: "Please select at least one member for the group.",
        variant: "destructive",
      });
      return;
    }

    // For now, groups will use a default avatar. This can be expanded later.
    // const defaultGroupAvatar = '/icons/group-avatar-default.svg'; // Example path
    const newGroup = await addGroup(
      groupName,
      selectedMemberIds,
      undefined, // For avatar, keeping it undefined as per existing logic
      initialGroupId, // Pass initialGroupId
    );
    if (newGroup) {
      onClose(newGroup); // Pass the new group on successful creation
    } else {
      // Optionally, handle the case where group creation failed but modal shouldn't close,
      // or ensure onClose is called without args if it should still close.
      // For now, assuming failure means modal stays open or error is handled by addGroup's toast.
    }
  };

  const ensureNameIsSaved = (): boolean => {
    if (isNameEditing) {
      return handleSaveName();
    }
    return true;
  };

  // Removed explicit resetForm and combined its logic into the main useEffect for isOpen.

  const isCreateButtonDisabled =
    isNameEditing || !groupName.trim() || selectedMemberIds.length === 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose(); // Call without arguments for external close
          // Explicitly reset internal state on external close, as props might not change for next open
          setGroupName("");
          setTempGroupName("");
          setIsNameEditing(false);
          setSelectedMemberIds([]);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Group</DialogTitle>
          <DialogDescription>
            Name your group and select members.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <ContactNameEdit
            name={isNameEditing ? tempGroupName : groupName}
            isEditing={isNameEditing}
            onNameChange={setTempGroupName}
            onSave={handleSaveName}
            onEditToggle={handleToggleNameEdit}
            onClear={() => setTempGroupName("")}
          />

          <div className="space-y-2">
            <Label htmlFor="group-members">Group Members</Label>
            <ScrollArea className="h-[200px] w-full rounded-md border p-2">
              {availableContacts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No contacts available to add.
                </p>
              )}
              {availableContacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center space-x-3 p-2 hover:bg-muted/50 rounded-md"
                >
                  <Checkbox
                    id={`member-${contact.id}`}
                    checked={selectedMemberIds.includes(contact.id)}
                    onCheckedChange={() => handleMemberSelection(contact.id)}
                  />
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={contact.avatar} alt={contact.name} />
                    <AvatarFallback>
                      {contact.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <Label
                    htmlFor={`member-${contact.id}`}
                    className="flex-1 cursor-pointer"
                  >
                    {contact.name}
                  </Label>
                </div>
              ))}
            </ScrollArea>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreateGroup} disabled={isCreateButtonDisabled}>
            Create Group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddGroupModal;

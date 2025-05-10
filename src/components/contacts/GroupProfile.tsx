import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useContacts, Contact, Group } from '@/contexts/ContactsContext';
import { useMessages } from '@/contexts/MessagesContext';
import { useToast } from '@/hooks/use-toast';
import ContactNameEdit from './shared/ContactNameEdit'; // Reusing for name input
import { Separator } from '@/components/ui/separator';

interface GroupProfileProps {
  group: Group;
  isOpen: boolean;
  onClose: () => void;
}

const GroupProfile = ({ group, isOpen, onClose }: GroupProfileProps) => {
  const { listItems, updateGroup } = useContacts();
  const { messages } = useMessages();
  const { toast } = useToast();

  const [tempGroupName, setTempGroupName] = useState(group.name);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(group.memberIds);

  // Filter out non-contact items to get a list of all actual contacts
  const availableContacts = listItems.filter(item => item.itemType === 'contact') as Contact[];

  useEffect(() => {
    if (isOpen) {
      setTempGroupName(group.name);
      setSelectedMemberIds([...group.memberIds]); // Ensure it's a new array copy
      setIsNameEditing(false);
    }
  }, [isOpen, group]);

  const handleToggleNameEdit = () => {
    if (!isNameEditing) {
      setTempGroupName(group.name); // Reset temp name to current group name when starting edit
    }
    setIsNameEditing(!isNameEditing);
  };

  const handleSaveName = (): boolean => {
    const trimmedName = tempGroupName.trim();
    if (trimmedName === '') {
      toast({
        title: 'Invalid Name',
        description: 'Group name cannot be empty.',
        variant: 'destructive',
      });
      return false;
    }
    // The actual update will happen in handleSaveChanges
    setIsNameEditing(false);
    return true;
  };

  const handleMemberSelection = (contactId: string) => {
    setSelectedMemberIds(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  const handleSaveChanges = async () => {
    if (isNameEditing) {
      if (!handleSaveName()) return; // Ensure name is valid if editing
    }
    const finalName = tempGroupName.trim(); // Use the potentially edited name

    if (!finalName) {
      toast({
        title: 'Required Field',
        description: 'Group name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }
    if (selectedMemberIds.length === 0) {
      toast({
        title: 'No Members Selected',
        description: 'A group must have at least one member.',
        variant: 'destructive',
      });
      return;
    }

    if (!updateGroup) {
        toast({ title: 'Error', description: 'Update function not available.', variant: 'destructive' });
        return;
    }

    const success = await updateGroup(group.id, {
      name: finalName,
      memberIds: selectedMemberIds,
      // avatar: group.avatar, // Preserve avatar or add avatar editing later
    });

    if (success) {
      toast({ title: 'Group Updated', description: `${finalName} has been updated.` });
      onClose();
    } else {
      toast({ title: 'Update Failed', description: 'Could not update group details.', variant: 'destructive' });
    }
  };
  
  const resetAndClose = () => {
    // Reset state to original group details before closing
    setTempGroupName(group.name);
    setSelectedMemberIds([...group.memberIds]);
    setIsNameEditing(false);
    onClose();
  };

  const selectedMemberCount = selectedMemberIds.length;

  const groupMessages = messages[group.id] || [];
  const sentCount = groupMessages.filter(msg => msg.sent).length;
  const receivedCount = groupMessages.filter(msg => !msg.sent).length;
  const unreadCount = groupMessages.filter(msg => !msg.sent && !msg.read).length;

  const lastMessageTimestamp = groupMessages.length > 0
    ? groupMessages.reduce((latest, msg) => {
        return new Date(msg.timestamp) > new Date(latest) ? msg.timestamp : latest;
      }, groupMessages[0].timestamp)
    : null;

  const hasChanges = tempGroupName.trim() !== group.name ||
                     selectedMemberIds.length !== group.memberIds.length ||
                     !selectedMemberIds.every(id => group.memberIds.includes(id)) ||
                     !group.memberIds.every(id => selectedMemberIds.includes(id));


  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center space-x-3 mb-2">
            <Avatar className="h-12 w-12">
              <AvatarImage src={group.avatar} alt={group.name} />
              <AvatarFallback>{group.name.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <DialogTitle className="text-2xl">{isNameEditing ? "Edit Group Name" : group.name}</DialogTitle>
          </div>
        </DialogHeader>
        <Separator className="my-4" />
        <div className="space-y-4 py-1 max-h-[calc(60vh-50px)] overflow-y-auto"> {/* Adjusted max-h to account for stats */}
          <ContactNameEdit
            name={isNameEditing ? tempGroupName : group.name}
            isEditing={isNameEditing}
            onNameChange={setTempGroupName}
            onSave={handleSaveName} // Saves to temp state, actual update on main save
            onEditToggle={handleToggleNameEdit}
            onClear={() => setTempGroupName('')}
          />

          <div className="grid grid-cols-2 gap-4 bg-muted p-4 rounded-lg">
            <div>
              <div className="text-sm text-muted-foreground">Sent</div>
              <div className="text-2xl font-bold">{sentCount}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Received</div>
              <div className="text-2xl font-bold">{receivedCount}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Unread</div>
              <div className="text-2xl font-bold">{unreadCount}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Last Active</div>
              <div className="text-sm">
                {lastMessageTimestamp ? new Date(lastMessageTimestamp).toLocaleDateString() : 'Never'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="group-members" className="text-lg font-medium">
              Group Members ({selectedMemberCount})
            </Label>
            <ScrollArea className="h-[200px] w-full rounded-md border p-2">
              {availableContacts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No contacts available.</p>
              )}
              {availableContacts.map(contact => (
                <div key={contact.id} className="flex items-center space-x-3 p-2 hover:bg-muted/50 rounded-md">
                  <Checkbox
                    id={`profile-member-${contact.id}`}
                    checked={selectedMemberIds.includes(contact.id)}
                    onCheckedChange={() => handleMemberSelection(contact.id)}
                  />
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={contact.avatar} alt={contact.name} />
                    <AvatarFallback>{contact.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <Label htmlFor={`profile-member-${contact.id}`} className="flex-1 cursor-pointer">{contact.name}</Label>
                </div>
              ))}
            </ScrollArea>
          </div>
          {/* Removed old Statistics block */}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button onClick={handleSaveChanges} disabled={!hasChanges || isNameEditing || selectedMemberIds.length === 0}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GroupProfile;

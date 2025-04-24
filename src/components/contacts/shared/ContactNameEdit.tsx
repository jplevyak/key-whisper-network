
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pencil } from 'lucide-react';

interface ContactNameEditProps {
  name: string; // The current name (saved or temporary)
  isEditing: boolean;
  onNameChange: (newName: string) => void; // Update temporary name
  onSave: () => void; // Commit the name change
  onEditToggle: () => void; // Toggle editing mode
}

const ContactNameEdit = ({
  name,
  isEditing,
  onNameChange,
  onSave,
  onEditToggle,
}: ContactNameEditProps) => {
  return (
    <div className="space-y-2">
      <Label>Name</Label>
      {isEditing ? (
        <div className="flex space-x-2">
          <Input
            value={name} // Display the name being edited
            onChange={(e) => onNameChange(e.target.value)} // Update temporary name in parent
            className="flex-1"
            autoFocus // Focus input when editing starts
            onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }} // Save on Enter
          />
          <Button onClick={onSave}>Save</Button> {/* Call parent's save handler */}
        </div>
      ) : (
        <div className="flex items-center justify-between">
          {/* Display the saved name */}
          <span className="text-lg font-medium">{name || <span className="text-muted-foreground italic">Click pencil to edit...</span>}</span>
          <Button
            size="icon"
            variant="ghost"
            onClick={onEditToggle} // Call parent's toggle handler
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default ContactNameEdit;


import React from 'react';
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pencil, X } from 'lucide-react'; // Import X icon

interface ContactNameEditProps {
  name: string; // The current name (saved or temporary)
  isEditing: boolean;
  onNameChange: (newName: string) => void; // Update temporary name
  onSave: () => void; // Commit the name change
  onEditToggle: () => void; // Toggle editing mode
  onClear: () => void; // Add handler for clearing the input
}

const ContactNameEdit = ({
  name,
  isEditing,
  onNameChange,
  onSave,
  onEditToggle,
  onClear, // Destructure the new prop
}: ContactNameEditProps) => {
  return (
    <div className="space-y-2">
      <Label htmlFor="contact-name-input">Name</Label> {/* Add htmlFor for accessibility */}
      {isEditing ? (
        <div className="flex items-center space-x-2">
          {/* Wrap input and clear button for relative positioning */}
          <div className="relative flex-1">
            <Input
              id="contact-name-input" // Add id matching the label's htmlFor
              value={name} // Display the name being edited
              onChange={(e) => onNameChange(e.target.value)} // Update temporary name in parent
              className="pr-8" // Add padding to the right for the clear button
              autoFocus // Focus input when editing starts
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }} // Save on Enter
            />
            {/* Conditionally render clear button */}
            {name && (
              <Button
                type="button" // Prevent form submission if wrapped in a form
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={onClear} // Call the clear handler
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Clear name</span> {/* Screen reader text */}
              </Button>
            )}
          </div>
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

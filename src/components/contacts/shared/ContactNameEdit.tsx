
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pencil } from 'lucide-react';

interface ContactNameEditProps {
  initialName: string;
  onUpdateName: (newName: string) => void;
}

const ContactNameEdit = ({ initialName, onUpdateName }: ContactNameEditProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(initialName);

  const handleSubmit = () => {
    if (newName.trim() === '') return;
    onUpdateName(newName.trim());
    setIsEditing(false);
  };

  return (
    <div className="space-y-2">
      <Label>Name</Label>
      {isEditing ? (
        <div className="flex space-x-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1"
          />
          <Button onClick={handleSubmit}>Save</Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-lg font-medium">{initialName}</span>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default ContactNameEdit;
